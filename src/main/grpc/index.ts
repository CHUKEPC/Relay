/**
 * gRPC client engine (main process).
 *
 * Pure-JS stack: `@grpc/proto-loader` parses a user-supplied .proto into a
 * package definition, `@grpc/grpc-js` performs the call. No native modules, so
 * the cross-platform build stays green.
 *
 * Like the realtime engines, calls stream lifecycle/message events to the
 * renderer over a per-call IPC channel (`grpc:event:<connId>`) using the shared
 * `RealtimeEvent` shape, so the renderer can reuse the same message-log model.
 *
 * Supported method kinds: unary, server-streaming, client-streaming, bidi.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as grpc from '@grpc/grpc-js'
import type * as protoLoader from '@grpc/proto-loader'
import type * as descriptorNs from 'protobufjs/ext/descriptor'
import type { BrowserWindow, IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { makeId } from '@shared/id'
import type {
  GrpcInvokeSpec,
  GrpcMethodInfo,
  GrpcMethodKind,
  GrpcParseResult,
  GrpcReflectSpec,
  GrpcServiceInfo,
  KV,
  RealtimeEvent
} from '@shared/types'

type GetWindow = () => BrowserWindow | null

/**
 * The grpc stack is REQUIRED LAZILY, not imported at module scope: protobufjs
 * runs `Function(...)` codegen while its modules initialize, which crashes the
 * whole bundle when it is re-forked as a script/plugin sandbox child running
 * under `--disallow-code-generation-from-strings`. Deferring the require keeps
 * the sandbox role (which never touches gRPC) free of protobufjs entirely.
 */
const lazyRequire = createRequire(import.meta.url)

interface GrpcStack {
  grpc: typeof grpc
  protoLoader: typeof protoLoader
  descriptor: typeof descriptorNs
}

let grpcStack: GrpcStack | null = null
function rt(): GrpcStack {
  return (grpcStack ??= {
    grpc: lazyRequire('@grpc/grpc-js') as typeof grpc,
    protoLoader: lazyRequire('@grpc/proto-loader') as typeof protoLoader,
    descriptor: lazyRequire('protobufjs/ext/descriptor') as typeof descriptorNs
  })
}

interface LiveCall {
  /** client-/bidi-stream: write one message */
  write?: (message: string) => void
  /** client-/bidi-stream: half-close */
  end?: () => void
  cancel: () => void
}

const calls = new Map<string, LiveCall>()
/** Keep client channels alive for the duration of a call so we can close them. */
const clients = new Map<string, grpc.Client>()

const LOAD_OPTS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
}

function emitter(getWindow: GetWindow, connId: string) {
  const channel = `${IPC.grpc.event}:${connId}`
  return (event: RealtimeEvent): void => {
    try {
      getWindow()?.webContents.send(channel, event)
    } catch {
      /* window gone */
    }
  }
}

function msg(dir: 'in' | 'out' | 'system', data: string, kind: string): RealtimeEvent {
  return { type: 'message', message: { id: makeId('rt'), dir, data, at: Date.now(), kind } }
}

function methodKind(requestStream: boolean, responseStream: boolean): GrpcMethodKind {
  if (requestStream && responseStream) return 'bidi'
  if (requestStream) return 'client_stream'
  if (responseStream) return 'server_stream'
  return 'unary'
}

/** A proto-loader value is a service definition if all its entries look like RPC methods. */
function isServiceDefinition(v: unknown): v is protoLoader.ServiceDefinition {
  if (!v || typeof v !== 'object') return false
  const entries = Object.values(v as Record<string, unknown>)
  if (entries.length === 0) return false
  return entries.every((m) => !!m && typeof m === 'object' && 'path' in (m as object) && 'requestStream' in (m as object))
}

function typeName(t: unknown): string {
  const node = t as { type?: { name?: string } } | undefined
  return node?.type?.name ?? ''
}

/**
 * Load a .proto from raw text by staging it in a private temp dir (proto-loader
 * resolves imports relative to a file path). The dir is always cleaned up.
 */
function loadProto(proto: string): protoLoader.PackageDefinition {
  const dir = mkdtempSync(join(tmpdir(), 'relay-grpc-'))
  const file = join(dir, 'service.proto')
  try {
    writeFileSync(file, proto, 'utf8')
    return rt().protoLoader.loadSync(file, { ...LOAD_OPTS, includeDirs: [dir] })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/** Enumerate services/methods from a loaded package definition (no network). */
function enumerateServices(pkgDef: protoLoader.PackageDefinition): GrpcServiceInfo[] {
  const services: GrpcServiceInfo[] = []
  for (const [qualifiedName, def] of Object.entries(pkgDef)) {
    if (!isServiceDefinition(def)) continue
    const methods: GrpcMethodInfo[] = []
    for (const [name, m] of Object.entries(def)) {
      const md = m as protoLoader.MethodDefinition<object, object>
      methods.push({
        name,
        path: md.path,
        kind: methodKind(Boolean(md.requestStream), Boolean(md.responseStream)),
        requestType: typeName(md.requestType),
        responseType: typeName(md.responseType)
      })
    }
    methods.sort((a, b) => a.name.localeCompare(b.name))
    services.push({ name: qualifiedName, methods })
  }
  services.sort((a, b) => a.name.localeCompare(b.name))
  return services
}

/** Parse a .proto into its services and methods (no network). */
export function parseProto(proto: string): GrpcParseResult {
  if (!proto.trim()) return { services: [], error: 'Proto-файл пуст' }
  let pkgDef: protoLoader.PackageDefinition
  try {
    pkgDef = loadProto(proto)
  } catch (err) {
    return { services: [], error: err instanceof Error ? err.message : String(err) }
  }
  const services = enumerateServices(pkgDef)
  if (services.length === 0) return { services: [], error: 'В proto-файле не найдено ни одного service' }
  return { services }
}

function metadataFromKV(kv: KV[] | undefined): grpc.Metadata {
  const md = new (rt().grpc.Metadata)()
  for (const h of kv ?? []) {
    if (h && h.enabled !== false && h.key) md.add(h.key, h.value ?? '')
  }
  return md
}

/* ------------------------------------------------------------------
 * Server Reflection (grpc.reflection.v1alpha.ServerReflection)
 * ------------------------------------------------------------------ */

/**
 * Minimal v1alpha reflection proto (just the messages/fields we use). Embedded
 * so reflection works without the user supplying any .proto. The server may
 * speak v1 or v1alpha; v1alpha is the broadly-supported wire shape and v1 uses
 * the same field layout, so the request bytes are compatible in practice.
 */
const REFLECTION_PROTO = `syntax = "proto3";
package grpc.reflection.v1alpha;

service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse);
}

message ServerReflectionRequest {
  string host = 1;
  string file_by_filename = 3;
  string file_containing_symbol = 4;
  string list_services = 7;
}

message ExtensionRequest {
  string containing_type = 1;
  int32 extension_number = 2;
}

message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  FileDescriptorResponse file_descriptor_response = 4;
  ListServiceResponse list_services_response = 6;
  ErrorResponse error_response = 7;
}

message FileDescriptorResponse {
  repeated bytes file_descriptor_proto = 1;
}

message ListServiceResponse {
  repeated ServiceResponse service = 1;
}

message ServiceResponse {
  string name = 1;
}

message ErrorResponse {
  int32 error_code = 1;
  string error_message = 2;
}`

interface ReflectionListResponse {
  list_services_response?: { service?: { name?: string }[] }
  file_descriptor_response?: { file_descriptor_proto?: Buffer[] }
  error_response?: { error_code?: number; error_message?: string }
}

/** Build a bidi ServerReflectionInfo client against the target address. */
function reflectionClient(spec: TlsSpec, address: string): grpc.Client {
  const pkgDef = loadProto(REFLECTION_PROTO)
  const Ctor = resolveServiceCtor(pkgDef, 'grpc.reflection.v1alpha.ServerReflection')
  if (!Ctor) throw new Error('Не удалось загрузить reflection proto')
  return new Ctor(address, credentials(spec))
}

/** Either a loaded package definition or a structured error. */
interface ReflectPkg {
  pkgDef?: protoLoader.PackageDefinition
  error?: string
}

const REFLECT_TIMEOUT_MS = 15_000

/**
 * Discover a server's full descriptor set via Server Reflection and return it as
 * a proto-loader PackageDefinition.
 *
 * Flow: open the ServerReflectionInfo bidi stream, send `list_services`, then a
 * `file_containing_symbol` request per discovered service; collect the returned
 * serialized FileDescriptorProto bytes into a descriptor set and load it with
 * proto-loader. Always resolves (never throws) — callers get `{ pkgDef }` or
 * `{ error }`. Bounded by a per-call deadline plus a wall-clock guard so an
 * unreachable address resolves with an error rather than hanging.
 */
function reflectPackageDef(spec: TlsSpec & { address: string; metadata: KV[] }): Promise<ReflectPkg> {
  return new Promise<ReflectPkg>((resolve) => {
    let client: grpc.Client
    try {
      client = reflectionClient(spec, spec.address)
    } catch (err) {
      resolve({ error: err instanceof Error ? err.message : String(err) })
      return
    }

    const md = metadataFromKV(spec.metadata)
    const reflectFn = (client as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)
      .ServerReflectionInfo
    if (typeof reflectFn !== 'function') {
      try {
        client.close()
      } catch {
        /* ignore */
      }
      resolve({ error: 'Сервер не поддерживает reflection' })
      return
    }

    const callOpts: grpc.CallOptions = { deadline: new Date(Date.now() + REFLECT_TIMEOUT_MS) }
    let stream: grpc.ClientDuplexStream<object, ReflectionListResponse>
    try {
      stream = reflectFn.call(client, md, callOpts) as grpc.ClientDuplexStream<object, ReflectionListResponse>
    } catch (err) {
      try {
        client.close()
      } catch {
        /* ignore */
      }
      resolve({ error: err instanceof Error ? err.message : String(err) })
      return
    }

    // De-dupe duplicate FileDescriptorProto bytes across symbol responses.
    const seenFiles = new Set<string>()
    const fileProtos: Buffer[] = []
    let pendingSymbols = 0
    let listed = false
    let settled = false

    // Wall-clock guard: fires `finish` (declared just below; safe — the timer
    // resolves asynchronously) if neither the deadline nor a stream event settles
    // the call, so an unreachable address resolves with an error.
    const guard = setTimeout(() => finish({ error: 'Тайм-аут reflection' }), REFLECT_TIMEOUT_MS + 1_000)

    const finish = (result: ReflectPkg): void => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      try {
        stream.end()
      } catch {
        /* ignore */
      }
      try {
        client.close()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const buildResult = (): void => {
      if (fileProtos.length === 0) {
        finish({ error: 'Сервер не вернул дескрипторы' })
        return
      }
      try {
        const fileSet = { file: fileProtos.map((buf) => rt().descriptor.FileDescriptorProto.decode(buf)) }
        const pkgDef = rt().protoLoader.loadFileDescriptorSetFromObject(
          fileSet as Parameters<typeof protoLoader.loadFileDescriptorSetFromObject>[0],
          LOAD_OPTS
        )
        finish({ pkgDef })
      } catch (err) {
        finish({ error: err instanceof Error ? err.message : String(err) })
      }
    }

    const maybeDone = (): void => {
      if (listed && pendingSymbols === 0) buildResult()
    }

    stream.on('data', (resp: ReflectionListResponse) => {
      if (settled) return
      if (resp.error_response && resp.error_response.error_code) {
        finish({ error: resp.error_response.error_message || 'Ошибка reflection' })
        return
      }
      if (resp.list_services_response) {
        listed = true
        const names = (resp.list_services_response.service ?? [])
          .map((s) => s.name ?? '')
          .filter((n) => n && !n.startsWith('grpc.reflection.'))
        if (names.length === 0) {
          finish({ error: 'Сервер не объявил ни одного service' })
          return
        }
        pendingSymbols = names.length
        for (const name of names) stream.write({ file_containing_symbol: name })
        return
      }
      if (resp.file_descriptor_response) {
        for (const buf of resp.file_descriptor_response.file_descriptor_proto ?? []) {
          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
          const key = b.toString('base64')
          if (!seenFiles.has(key)) {
            seenFiles.add(key)
            fileProtos.push(b)
          }
        }
        if (pendingSymbols > 0) pendingSymbols -= 1
        maybeDone()
      }
    })

    stream.on('error', (err: grpc.ServiceError) => {
      finish({ error: `${rt().grpc.status[err.code] ?? err.code}: ${err.message}` })
    })

    stream.on('end', () => {
      if (!settled) buildResult()
    })

    // Kick off discovery.
    try {
      stream.write({ list_services: '*' })
    } catch (err) {
      finish({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}

/**
 * Discover services/methods from a live server via Server Reflection and return
 * the same `{ services, error }` shape as `parseProto`. Never throws.
 */
export async function reflectServices(spec: GrpcReflectSpec): Promise<GrpcParseResult> {
  const { pkgDef, error } = await reflectPackageDef(spec)
  if (error || !pkgDef) return { services: [], error: error ?? 'Reflection не вернул дескрипторы' }
  const services = enumerateServices(pkgDef)
  if (services.length === 0) return { services: [], error: 'Reflection не вернул ни одного service' }
  return { services }
}

/** Resolve a service constructor from the loaded package by qualified name. */
function resolveServiceCtor(pkgDef: protoLoader.PackageDefinition, service: string): grpc.ServiceClientConstructor | null {
  const root = rt().grpc.loadPackageDefinition(pkgDef) as Record<string, unknown>
  let node: unknown = root
  for (const part of service.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part]
    if (!node) return null
  }
  return typeof node === 'function' ? (node as grpc.ServiceClientConstructor) : null
}

function parseMessage(text: string): object {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed) as object
}

/** TLS-related fields shared by invoke and reflect specs. */
interface TlsSpec {
  plaintext?: boolean
  rejectUnauthorized?: boolean
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/** Read a PEM file into a Buffer, or null when no path / unreadable. */
function readPem(path: string | undefined): Buffer | null {
  if (!path || !path.trim()) return null
  return readFileSync(path)
}

/**
 * Build channel credentials, honouring plaintext (h2c), a custom CA, mTLS
 * client cert/key, and a relaxed hostname check when verification is disabled.
 * Throws if a configured PEM file cannot be read (surfaced to the caller).
 */
function credentials(spec: TlsSpec): grpc.ChannelCredentials {
  if (spec.plaintext) return rt().grpc.credentials.createInsecure()

  const ca = readPem(spec.caCertPath)
  const cert = readPem(spec.clientCertPath)
  const key = readPem(spec.clientKeyPath)
  const verifyOpts =
    spec.rejectUnauthorized === false
      ? // grpc-js cannot fully skip chain verification; we at least relax the
        // hostname check. Self-signed chains still require a proper CA in practice.
        { checkServerIdentity: () => undefined }
      : undefined

  // createSsl(rootCerts, privateKey, certChain, verifyOptions): a non-null
  // key+cert pair enables mTLS; a non-null CA pins a custom root.
  return rt().grpc.credentials.createSsl(ca, key, cert, verifyOpts)
}

/**
 * Invoke a gRPC method against an already-resolved package definition. Streams
 * open/message/close/error events to the renderer. Returns a LiveCall so
 * client-/bidi-streams can be fed and finished.
 */
function invoke(
  spec: GrpcInvokeSpec,
  pkgDef: protoLoader.PackageDefinition,
  emit: (e: RealtimeEvent) => void
): LiveCall {
  const Ctor = resolveServiceCtor(pkgDef, spec.service)
  if (!Ctor) {
    emit({ type: 'error', error: `Сервис не найден: ${spec.service}` })
    return { cancel: () => {} }
  }
  const methodDef = (Ctor.service as Record<string, protoLoader.MethodDefinition<object, object>>)[spec.method]
  if (!methodDef) {
    emit({ type: 'error', error: `Метод не найден: ${spec.method}` })
    return { cancel: () => {} }
  }

  let client: grpc.Client
  try {
    client = new Ctor(spec.address, credentials(spec))
  } catch (err) {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    return { cancel: () => {} }
  }
  clients.set(spec.connId, client)

  const md = metadataFromKV(spec.metadata)
  // Per-call deadline: an absolute Date `deadlineMs` from now (grpc-js accepts a
  // Date or absolute ms). Omitted when <= 0 so calls run without a timeout.
  const callOpts: grpc.CallOptions =
    spec.deadlineMs && spec.deadlineMs > 0 ? { deadline: new Date(Date.now() + spec.deadlineMs) } : {}
  const kind = methodKind(Boolean(methodDef.requestStream), Boolean(methodDef.responseStream))
  // grpc-js exposes the RPC on the client under its original name. Bind it to the
  // client — these methods rely on `this` being the client instance.
  const raw = (client as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[spec.method]
  if (typeof raw !== 'function') {
    emit({ type: 'error', error: `Метод недоступен на клиенте: ${spec.method}` })
    return { cancel: () => {} }
  }
  const fn = raw.bind(client)

  const finish = (): void => {
    try {
      client.close()
    } catch {
      /* ignore */
    }
    clients.delete(spec.connId)
    calls.delete(spec.connId)
  }

  const onResponse = (response: unknown): void => {
    let text: string
    try {
      text = JSON.stringify(response, null, 2)
    } catch {
      text = String(response)
    }
    emit(msg('in', text, 'message'))
  }

  const onStatus = (status: grpc.StatusObject): void => {
    const name = rt().grpc.status[status.code] ?? String(status.code)
    emit(msg('system', `status: ${name}${status.details ? ` — ${status.details}` : ''}`, 'status'))
  }

  // Settle the call exactly once: emit the terminal event (if any) and release
  // the client/channel. Guards against grpc-js emitting both 'error' and 'end'
  // (or a late event after cancel) from double-closing or clobbering status.
  let settled = false
  const settle = (terminal: RealtimeEvent | null): void => {
    if (settled) return
    settled = true
    if (terminal) emit(terminal)
    finish()
  }
  const errEvent = (err: grpc.ServiceError): RealtimeEvent => ({
    type: 'error',
    error: `${rt().grpc.status[err.code] ?? err.code}: ${err.message}`
  })

  emit({ type: 'open', protocol: kind })

  try {
    if (kind === 'unary') {
      emit(msg('out', spec.message, spec.method))
      const call = fn(parseMessage(spec.message), md, callOpts, (err: grpc.ServiceError | null, response: unknown) => {
        if (err) {
          settle(errEvent(err))
        } else {
          onResponse(response)
          settle({ type: 'close' })
        }
      }) as grpc.ClientUnaryCall
      return {
        cancel: () => {
          try {
            call.cancel()
          } catch {
            /* ignore */
          }
          settle(null)
        }
      }
    }

    if (kind === 'server_stream') {
      emit(msg('out', spec.message, spec.method))
      const call = fn(parseMessage(spec.message), md, callOpts) as grpc.ClientReadableStream<unknown>
      call.on('data', onResponse)
      call.on('error', (err: grpc.ServiceError) => settle(errEvent(err)))
      call.on('status', onStatus)
      call.on('end', () => settle({ type: 'close' }))
      return {
        cancel: () => {
          try {
            call.cancel()
          } catch {
            /* ignore */
          }
          settle(null)
        }
      }
    }

    // client_stream or bidi: we get a writable (and, for bidi, readable) stream.
    if (kind === 'client_stream') {
      const call = fn(md, callOpts, (err: grpc.ServiceError | null, response: unknown) => {
        if (err) {
          settle(errEvent(err))
        } else {
          onResponse(response)
          settle({ type: 'close' })
        }
      }) as grpc.ClientWritableStream<object>
      call.on('status', onStatus)
      call.on('error', (err: grpc.ServiceError) => settle(errEvent(err)))
      // Send the initial message if one was provided.
      if (spec.message.trim()) {
        emit(msg('out', spec.message, spec.method))
        call.write(parseMessage(spec.message))
      }
      return {
        write: (m: string) => {
          try {
            emit(msg('out', m, spec.method))
            call.write(parseMessage(m))
          } catch (err) {
            emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
          }
        },
        end: () => {
          try {
            call.end()
          } catch {
            /* ignore */
          }
        },
        cancel: () => {
          try {
            call.cancel()
          } catch {
            /* ignore */
          }
          settle(null)
        }
      }
    }

    // bidi
    const call = fn(md, callOpts) as grpc.ClientDuplexStream<object, unknown>
    call.on('data', onResponse)
    call.on('error', (err: grpc.ServiceError) => settle(errEvent(err)))
    call.on('status', onStatus)
    call.on('end', () => settle({ type: 'close' }))
    if (spec.message.trim()) {
      emit(msg('out', spec.message, spec.method))
      call.write(parseMessage(spec.message))
    }
    return {
      write: (m: string) => {
        try {
          emit(msg('out', m, spec.method))
          call.write(parseMessage(m))
        } catch (err) {
          emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      },
      end: () => {
        try {
          call.end()
        } catch {
          /* ignore */
        }
      },
      cancel: () => {
        try {
          call.cancel()
        } catch {
          /* ignore */
        }
        settle(null)
      }
    }
  } catch (err) {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    finish()
    return { cancel: () => {} }
  }
}

function cancelCall(connId: string): void {
  const c = calls.get(connId)
  if (c) {
    c.cancel()
    calls.delete(connId)
  }
  const client = clients.get(connId)
  if (client) {
    try {
      client.close()
    } catch {
      /* ignore */
    }
    clients.delete(connId)
  }
}

/**
 * Resolve the descriptor set for an invoke: from the pasted `.proto` (sync) or
 * by querying the server via Server Reflection. Returns `{ pkgDef }` or
 * `{ error }`; never throws.
 */
async function resolveInvokePackageDef(spec: GrpcInvokeSpec): Promise<ReflectPkg> {
  if (spec.useReflection || !spec.proto?.trim()) {
    return reflectPackageDef({
      address: spec.address,
      metadata: spec.metadata,
      plaintext: spec.plaintext,
      rejectUnauthorized: spec.rejectUnauthorized,
      caCertPath: spec.caCertPath,
      clientCertPath: spec.clientCertPath,
      clientKeyPath: spec.clientKeyPath
    })
  }
  try {
    return { pkgDef: loadProto(spec.proto) }
  } catch (err) {
    return { error: `Не удалось разобрать proto: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function registerGrpcHandlers(ipcMain: IpcMain, getWindow: GetWindow): void {
  ipcMain.handle(IPC.grpc.parse, async (_e, proto: string): Promise<GrpcParseResult> => parseProto(proto))

  ipcMain.handle(IPC.grpc.reflect, async (_e, spec: GrpcReflectSpec): Promise<GrpcParseResult> => reflectServices(spec))

  ipcMain.handle(IPC.grpc.invoke, async (_e, spec: GrpcInvokeSpec) => {
    cancelCall(spec.connId) // replace any prior call on this id
    const emit = emitter(getWindow, spec.connId)

    // Mark the call as in-flight immediately so a cancel during descriptor
    // resolution (reflection round-trip) is honoured.
    let aborted = false
    calls.set(spec.connId, {
      cancel: () => {
        aborted = true
      }
    })

    const { pkgDef, error } = await resolveInvokePackageDef(spec)
    if (aborted) return // cancelled while resolving descriptors
    if (error || !pkgDef) {
      emit({ type: 'error', error: error ?? 'Не удалось получить дескрипторы' })
      calls.delete(spec.connId)
      return
    }
    calls.set(spec.connId, invoke(spec, pkgDef, emit))
  })

  ipcMain.handle(IPC.grpc.send, async (_e, connId: string, message: string) => {
    calls.get(connId)?.write?.(message)
  })

  ipcMain.handle(IPC.grpc.end, async (_e, connId: string) => {
    calls.get(connId)?.end?.()
  })

  ipcMain.handle(IPC.grpc.cancel, async (_e, connId: string) => {
    cancelCall(connId)
  })
}

/** Cancel every live call (call on window close / app quit). */
export function abortAllGrpc(): void {
  for (const connId of [...calls.keys()]) cancelCall(connId)
}

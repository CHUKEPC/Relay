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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import type { BrowserWindow, IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { makeId } from '@shared/id'
import type {
  GrpcInvokeSpec,
  GrpcMethodInfo,
  GrpcMethodKind,
  GrpcParseResult,
  GrpcServiceInfo,
  KV,
  RealtimeEvent
} from '@shared/types'

type GetWindow = () => BrowserWindow | null

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
    return protoLoader.loadSync(file, { ...LOAD_OPTS, includeDirs: [dir] })
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
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
  if (services.length === 0) return { services: [], error: 'В proto-файле не найдено ни одного service' }
  return { services }
}

function metadataFromKV(kv: KV[] | undefined): grpc.Metadata {
  const md = new grpc.Metadata()
  for (const h of kv ?? []) {
    if (h && h.enabled !== false && h.key) md.add(h.key, h.value ?? '')
  }
  return md
}

/** Resolve a service constructor from the loaded package by qualified name. */
function resolveServiceCtor(pkgDef: protoLoader.PackageDefinition, service: string): grpc.ServiceClientConstructor | null {
  const root = grpc.loadPackageDefinition(pkgDef) as Record<string, unknown>
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

function credentials(spec: GrpcInvokeSpec): grpc.ChannelCredentials {
  if (spec.plaintext) return grpc.credentials.createInsecure()
  if (spec.rejectUnauthorized === false) {
    // grpc-js cannot fully skip chain verification; we can at least relax the
    // hostname check. Self-signed chains still require a proper CA in practice.
    return grpc.credentials.createSsl(null, null, null, {
      checkServerIdentity: () => undefined
    })
  }
  return grpc.credentials.createSsl()
}

/**
 * Invoke a gRPC method. Streams open/message/close/error events to the renderer.
 * Returns a LiveCall so client-/bidi-streams can be fed and finished.
 */
function invoke(spec: GrpcInvokeSpec, emit: (e: RealtimeEvent) => void): LiveCall {
  let pkgDef: protoLoader.PackageDefinition
  try {
    pkgDef = loadProto(spec.proto)
  } catch (err) {
    emit({ type: 'error', error: `Не удалось разобрать proto: ${err instanceof Error ? err.message : String(err)}` })
    return { cancel: () => {} }
  }

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
    const name = grpc.status[status.code] ?? String(status.code)
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
    error: `${grpc.status[err.code] ?? err.code}: ${err.message}`
  })

  emit({ type: 'open', protocol: kind })

  try {
    if (kind === 'unary') {
      emit(msg('out', spec.message, spec.method))
      const call = fn(parseMessage(spec.message), md, (err: grpc.ServiceError | null, response: unknown) => {
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
      const call = fn(parseMessage(spec.message), md) as grpc.ClientReadableStream<unknown>
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
      const call = fn(md, (err: grpc.ServiceError | null, response: unknown) => {
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
    const call = fn(md) as grpc.ClientDuplexStream<object, unknown>
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

export function registerGrpcHandlers(ipcMain: IpcMain, getWindow: GetWindow): void {
  ipcMain.handle(IPC.grpc.parse, async (_e, proto: string): Promise<GrpcParseResult> => parseProto(proto))

  ipcMain.handle(IPC.grpc.invoke, async (_e, spec: GrpcInvokeSpec) => {
    cancelCall(spec.connId) // replace any prior call on this id
    const emit = emitter(getWindow, spec.connId)
    calls.set(spec.connId, invoke(spec, emit))
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

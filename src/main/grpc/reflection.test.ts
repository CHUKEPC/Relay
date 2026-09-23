/**
 * gRPC Server Reflection tests — a fake ServerReflection service backed by
 * hand-built FileDescriptorProtos, so the descriptor-fetching logic (including
 * transitive dependencies) can be exercised offline.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { reflectServices } from './index'

const req = createRequire(import.meta.url)
const grpc = req('@grpc/grpc-js') as any
const protoLoader = req('@grpc/proto-loader') as any
const { FileDescriptorProto } = req('protobufjs/ext/descriptor') as any

/** Same wire shape the engine speaks (v1alpha), enough for a fake server. */
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

/** demo/common.proto — holds the request message only. */
const COMMON = Buffer.from(
  FileDescriptorProto.encode(
    FileDescriptorProto.fromObject({
      name: 'demo/common.proto',
      package: 'demo',
      syntax: 'proto3',
      messageType: [{ name: 'Ping', field: [{ name: 'text', number: 1, label: 1, type: 9, jsonName: 'text' }] }]
    })
  ).finish()
)

/** demo/main.proto — the service; its request type lives in demo/common.proto. */
const MAIN = Buffer.from(
  FileDescriptorProto.encode(
    FileDescriptorProto.fromObject({
      name: 'demo/main.proto',
      package: 'demo',
      syntax: 'proto3',
      dependency: ['demo/common.proto'],
      messageType: [{ name: 'Pong', field: [{ name: 'text', number: 1, label: 1, type: 9, jsonName: 'text' }] }],
      service: [{ name: 'Echo', method: [{ name: 'Do', inputType: '.demo.Ping', outputType: '.demo.Pong' }] }]
    })
  ).finish()
)

/** A single self-contained file (no imports). */
const STANDALONE = Buffer.from(
  FileDescriptorProto.encode(
    FileDescriptorProto.fromObject({
      name: 'solo/solo.proto',
      package: 'solo',
      syntax: 'proto3',
      messageType: [
        { name: 'In', field: [{ name: 'text', number: 1, label: 1, type: 9, jsonName: 'text' }] },
        { name: 'Out', field: [{ name: 'text', number: 1, label: 1, type: 9, jsonName: 'text' }] }
      ],
      service: [{ name: 'Solo', method: [{ name: 'Once', inputType: '.solo.In', outputType: '.solo.Out' }] }]
    })
  ).finish()
)

interface FakeOpts {
  /** services announced by list_services */
  services: string[]
  /** file descriptors returned per requested symbol */
  bySymbol: Record<string, Buffer[]>
  /** file descriptors returned per requested file name */
  byFilename?: Record<string, Buffer[]>
  /** reply to list_services with an error instead */
  listError?: string
}

interface FakeServer {
  address: string
  requests: string[]
  stop: () => void
}

let dir = ''
let reflectionProtoPath = ''
const running: FakeServer[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-reflect-test-'))
  reflectionProtoPath = join(dir, 'reflection.proto')
  writeFileSync(reflectionProtoPath, REFLECTION_PROTO, 'utf8')
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  for (const s of running.splice(0)) s.stop()
})

async function startFakeReflection(opts: FakeOpts): Promise<FakeServer> {
  const pkgDef = protoLoader.loadSync(reflectionProtoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })
  const pkg = grpc.loadPackageDefinition(pkgDef) as any
  const requests: string[] = []
  const server = new grpc.Server()
  server.addService(pkg.grpc.reflection.v1alpha.ServerReflection.service, {
    ServerReflectionInfo: (call: any) => {
      call.on('data', (r: any) => {
        if (r.list_services) {
          requests.push(`list:${r.list_services}`)
          if (opts.listError) {
            call.write({ error_response: { error_code: 12, error_message: opts.listError } })
            return
          }
          call.write({ list_services_response: { service: opts.services.map((name) => ({ name })) } })
          return
        }
        if (r.file_containing_symbol) {
          requests.push(`symbol:${r.file_containing_symbol}`)
          const files = opts.bySymbol[r.file_containing_symbol]
          if (!files) {
            call.write({ error_response: { error_code: 5, error_message: 'symbol not found' } })
            return
          }
          call.write({ file_descriptor_response: { file_descriptor_proto: files } })
          return
        }
        if (r.file_by_filename) {
          requests.push(`file:${r.file_by_filename}`)
          const files = opts.byFilename?.[r.file_by_filename]
          if (!files) {
            call.write({ error_response: { error_code: 5, error_message: 'file not found' } })
            return
          }
          call.write({ file_descriptor_response: { file_descriptor_proto: files } })
        }
      })
      call.on('end', () => call.end())
      call.on('error', () => {})
    }
  })
  const port: number = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err: Error | null, p: number) =>
      err ? reject(err) : resolve(p)
    )
  )
  const handle: FakeServer = { address: `127.0.0.1:${port}`, requests, stop: () => server.forceShutdown() }
  running.push(handle)
  return handle
}

describe('gRPC Server Reflection', () => {
  it('lists services from a self-contained descriptor', async () => {
    const fake = await startFakeReflection({ services: ['solo.Solo'], bySymbol: { 'solo.Solo': [STANDALONE] } })
    const res = await reflectServices({ address: fake.address, metadata: [], plaintext: true })
    expect(res.error).toBeUndefined()
    expect(res.services.map((s) => s.name)).toEqual(['solo.Solo'])
    expect(res.services[0].methods[0]).toMatchObject({ name: 'Once', kind: 'unary', path: '/solo.Solo/Once' })
  })

  it('fetches the transitive dependencies of a descriptor', async () => {
    const fake = await startFakeReflection({
      services: ['demo.Echo'],
      // A server that answers with just the file holding the symbol — the client
      // has to pull demo/common.proto itself or the descriptor cannot be loaded.
      bySymbol: { 'demo.Echo': [MAIN] },
      byFilename: { 'demo/common.proto': [COMMON] }
    })
    const res = await reflectServices({ address: fake.address, metadata: [], plaintext: true })
    expect(res.error).toBeUndefined()
    expect(res.services.map((s) => s.name)).toEqual(['demo.Echo'])
    expect(res.services[0].methods[0]).toMatchObject({ name: 'Do', requestType: 'Ping', responseType: 'Pong' })
    expect(fake.requests).toContain('file:demo/common.proto')
  })

  it('accepts a server that already bundles the dependencies', async () => {
    const fake = await startFakeReflection({ services: ['demo.Echo'], bySymbol: { 'demo.Echo': [MAIN, COMMON] } })
    const res = await reflectServices({ address: fake.address, metadata: [], plaintext: true })
    expect(res.error).toBeUndefined()
    expect(res.services.map((s) => s.name)).toEqual(['demo.Echo'])
    expect(fake.requests.filter((r) => r.startsWith('file:'))).toEqual([])
  })

  it('reports a reflection error response', async () => {
    const fake = await startFakeReflection({ services: [], bySymbol: {}, listError: 'reflection disabled' })
    const res = await reflectServices({ address: fake.address, metadata: [], plaintext: true })
    expect(res.services).toEqual([])
    expect(res.error).toContain('reflection disabled')
  })

  it('reports a server that does not implement reflection', async () => {
    const server = new grpc.Server()
    const port: number = await new Promise((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err: Error | null, p: number) =>
        err ? reject(err) : resolve(p)
      )
    )
    running.push({ address: `127.0.0.1:${port}`, requests: [], stop: () => server.forceShutdown() })
    const res = await reflectServices({ address: `127.0.0.1:${port}`, metadata: [], plaintext: true })
    expect(res.services).toEqual([])
    expect(res.error).toBeTruthy()
  })
})

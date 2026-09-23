/**
 * gRPC invoke tests — a real @grpc/grpc-js server on 127.0.0.1 with an
 * ephemeral port, driven through the registered IPC handlers.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import type { RealtimeEvent } from '@shared/types'
import { abortAllGrpc, registerGrpcHandlers } from './index'

const req = createRequire(import.meta.url)
const grpc = req('@grpc/grpc-js') as any
const protoLoader = req('@grpc/proto-loader') as any

const PROTO = `syntax = "proto3";
package helloworld;

message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc SlowHello (HelloRequest) returns (HelloReply);
  rpc LotsOfReplies (HelloRequest) returns (stream HelloReply);
  rpc LotsOfGreetings (stream HelloRequest) returns (HelloReply);
  rpc BidiHello (stream HelloRequest) returns (stream HelloReply);
  rpc Boom (HelloRequest) returns (HelloReply);
}
`

type Handler = (e: unknown, ...args: any[]) => Promise<unknown>

function fakeIpc(): { ipcMain: IpcMain; call: (channel: string, sender: unknown, ...args: any[]) => Promise<unknown> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (ch: string, h: Handler) => handlers.set(ch, h) } as unknown as IpcMain
  return {
    ipcMain,
    call: (channel, sender, ...args) => {
      const h = handlers.get(channel)
      if (!h) throw new Error(`no handler for ${channel}`)
      return h({ sender }, ...args)
    }
  }
}

interface Bus {
  sender: unknown
  events: RealtimeEvent[]
  wait: (pred: (e: RealtimeEvent) => boolean, ms?: number) => Promise<RealtimeEvent>
}

function makeBus(connId: string, id = 1): Bus {
  const channel = `${IPC.grpc.event}:${connId}`
  const events: RealtimeEvent[] = []
  const waiters: { pred: (e: RealtimeEvent) => boolean; resolve: (e: RealtimeEvent) => void; timer: NodeJS.Timeout }[] = []
  const sender = {
    id,
    isDestroyed: () => false,
    send: (ch: string, ev: RealtimeEvent) => {
      if (ch !== channel) return
      events.push(ev)
      for (const w of [...waiters]) {
        if (w.pred(ev)) {
          clearTimeout(w.timer)
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(ev)
        }
      }
    }
  }
  const wait = (pred: (e: RealtimeEvent) => boolean, ms = 8000): Promise<RealtimeEvent> =>
    new Promise((resolve, reject) => {
      const hit = events.find(pred)
      if (hit) return resolve(hit)
      const w = {
        pred,
        resolve,
        timer: setTimeout(() => {
          const i = waiters.findIndex((x) => x.pred === pred)
          if (i >= 0) waiters.splice(i, 1)
          reject(new Error(`timeout waiting for event. seen: ${JSON.stringify(events)}`))
        }, ms)
      }
      waiters.push(w)
    })
  return { sender, events, wait }
}

const isMsg = (e: RealtimeEvent): e is Extract<RealtimeEvent, { type: 'message' }> => e.type === 'message'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const inbound = (bus: Bus): string[] => bus.events.filter(isMsg).filter((e) => e.message.dir === 'in').map((e) => e.message.data)

/* ---------- test server ---------- */

let dir = ''
let server: any = null
let address = ''
const seen = { metadata: [] as string[], cancelled: [] as string[] }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'relay-grpc-test-'))
  const file = join(dir, 'hello.proto')
  writeFileSync(file, PROTO, 'utf8')
  const pkgDef = protoLoader.loadSync(file, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
  const pkg = grpc.loadPackageDefinition(pkgDef) as any

  server = new grpc.Server()
  server.addService(pkg.helloworld.Greeter.service, {
    SayHello: (call: any, cb: any) => {
      seen.metadata.push(String(call.metadata.get('x-relay')[0] ?? ''))
      cb(null, { message: `Hello ${call.request.name}` })
    },
    SlowHello: (call: any) => {
      call.on('cancelled', () => seen.cancelled.push('SlowHello'))
      // never responds — used for the deadline test
    },
    LotsOfReplies: (call: any) => {
      call.on('cancelled', () => seen.cancelled.push('LotsOfReplies'))
      let n = 0
      const timer = setInterval(() => {
        n += 1
        if (n > 3) {
          clearInterval(timer)
          call.end()
          return
        }
        call.write({ message: `reply ${n}` })
      }, 30)
    },
    LotsOfGreetings: (call: any, cb: any) => {
      const names: string[] = []
      call.on('data', (r: any) => names.push(r.name))
      call.on('end', () => cb(null, { message: `Hello ${names.join(', ')}` }))
    },
    BidiHello: (call: any) => {
      call.on('data', (r: any) => call.write({ message: `echo ${r.name}` }))
      call.on('end', () => call.end())
    },
    Boom: (_call: any, cb: any) => cb({ code: grpc.status.PERMISSION_DENIED, details: 'not allowed' })
  })

  const port: number = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err: Error | null, p: number) =>
      err ? reject(err) : resolve(p)
    )
  )
  address = `127.0.0.1:${port}`
})

afterAll(() => {
  if (server) server.forceShutdown()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  abortAllGrpc()
  seen.metadata.length = 0
  seen.cancelled.length = 0
})

function spec(connId: string, method: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connId,
    proto: PROTO,
    address,
    service: 'helloworld.Greeter',
    method,
    message,
    metadata: [{ key: 'x-relay', value: 'grpc', enabled: true }],
    plaintext: true,
    ...extra
  }
}

describe('gRPC invoke', () => {
  it('runs a unary call with metadata and closes', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g1')
    await call(IPC.grpc.invoke, bus.sender, spec('g1', 'SayHello', '{"name":"relay"}'))

    await bus.wait((e) => e.type === 'close')
    expect(seen.metadata).toEqual(['grpc'])
    expect(inbound(bus).join('')).toContain('Hello relay')
    expect(bus.events[0]).toMatchObject({ type: 'open', protocol: 'unary' })
  })

  it('streams server responses in order and reports the final status', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g2')
    await call(IPC.grpc.invoke, bus.sender, spec('g2', 'LotsOfReplies', '{"name":"relay"}'))

    await bus.wait((e) => e.type === 'close')
    const texts = inbound(bus).map((t) => JSON.parse(t).message)
    expect(texts).toEqual(['reply 1', 'reply 2', 'reply 3'])
    const status = bus.events.filter(isMsg).find((e) => e.message.kind === 'status')
    expect(status?.message.data).toContain('OK')
  })

  it('feeds a client-streaming call and half-closes it', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g3')
    await call(IPC.grpc.invoke, bus.sender, spec('g3', 'LotsOfGreetings', '{"name":"one"}'))
    await call(IPC.grpc.send, bus.sender, 'g3', '{"name":"two"}')
    await call(IPC.grpc.end, bus.sender, 'g3')

    await bus.wait((e) => e.type === 'close')
    expect(inbound(bus).join('')).toContain('Hello one, two')
  })

  it('echoes over a bidirectional stream', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g4')
    await call(IPC.grpc.invoke, bus.sender, spec('g4', 'BidiHello', '{"name":"one"}'))
    await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    await call(IPC.grpc.send, bus.sender, 'g4', '{"name":"two"}')
    await bus.wait((e) => isMsg(e) && e.message.dir === 'in' && e.message.data.includes('two'))
    await call(IPC.grpc.end, bus.sender, 'g4')

    await bus.wait((e) => e.type === 'close')
    expect(inbound(bus).map((t) => JSON.parse(t).message)).toEqual(['echo one', 'echo two'])
  })

  it('surfaces a non-OK status as an error', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g5')
    await call(IPC.grpc.invoke, bus.sender, spec('g5', 'Boom', '{"name":"relay"}'))

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toContain('PERMISSION_DENIED')
    expect(err.error).toContain('not allowed')
  })

  it('enforces the per-call deadline', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g6')
    await call(IPC.grpc.invoke, bus.sender, spec('g6', 'SlowHello', '{"name":"relay"}', { deadlineMs: 300 }))

    const err = (await bus.wait((e) => e.type === 'error', 5000)) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toContain('DEADLINE_EXCEEDED')
  })

  it('cancels an in-flight server stream', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g7')
    await call(IPC.grpc.invoke, bus.sender, spec('g7', 'LotsOfReplies', '{"name":"relay"}'))
    await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    await call(IPC.grpc.cancel, bus.sender, 'g7')
    const afterCancel = inbound(bus).length
    await sleep(300)
    expect(inbound(bus).length).toBe(afterCancel)
    expect(seen.cancelled.filter((m) => m === 'LotsOfReplies')).toEqual(['LotsOfReplies'])
  })

  it('reports an unknown method without touching the network', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g8')
    await call(IPC.grpc.invoke, bus.sender, spec('g8', 'NoSuchMethod', '{}'))
    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toBeTruthy()
  })

  it('reports invalid request JSON as an error event', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g9')
    await call(IPC.grpc.invoke, bus.sender, spec('g9', 'SayHello', '{not json}'))
    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toBeTruthy()
  })

  it('reports bad metadata as an error event instead of rejecting the IPC call', async () => {
    const { ipcMain, call } = fakeIpc()
    registerGrpcHandlers(ipcMain)
    const bus = makeBus('g10')
    await expect(
      call(IPC.grpc.invoke, bus.sender, spec('g10', 'SayHello', '{"name":"x"}', { metadata: [{ key: 'x-bin', value: 'oops' }] }))
    ).resolves.toBeUndefined()
    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toBeTruthy()
  })
})

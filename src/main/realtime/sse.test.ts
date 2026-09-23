/**
 * SSE engine tests — a real node:http server on 127.0.0.1 with an ephemeral
 * port, driven through the registered IPC handlers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import type { RealtimeEvent } from '@shared/types'
import { abortAllRealtime, registerRealtimeHandlers } from './index'

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
  const channel = `${IPC.realtime.event}:${connId}`
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

let server: Server | null = null
const openResponses: ServerResponse[] = []

function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      openResponses.push(res)
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })
}

function sseHead(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
}

afterEach(async () => {
  abortAllRealtime()
  for (const res of openResponses.splice(0)) {
    try {
      res.destroy()
    } catch {
      /* already gone */
    }
  }
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
  }
})

describe('realtime SSE', () => {
  it('parses multiline data, named events, comments and CRLF separators', async () => {
    const port = await start((_req, res) => {
      sseHead(res)
      res.write(': keep-alive comment\n\n')
      res.write('data: one\ndata: two\n\n')
      res.write('event: ping\r\ndata: {"a":1}\r\n\r\n')
      res.write('id: 42\ndata: with-id\n\n')
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s1')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's1', url: `http://127.0.0.1:${port}/`, headers: [] })

    await bus.wait((e) => isMsg(e) && e.message.data === 'with-id')
    const msgs = bus.events.filter(isMsg).map((e) => e.message)
    expect(msgs.map((m) => [m.kind, m.data])).toEqual([
      ['message', 'one\ntwo'],
      ['ping', '{"a":1}'],
      ['message', 'with-id']
    ])
  })

  it('decodes multi-byte UTF-8 split across network chunks', async () => {
    const payload = Buffer.from('data: привет мир\n\n', 'utf8')
    const port = await start(async (_req, res) => {
      sseHead(res)
      // Split in the middle of the first Cyrillic character.
      res.write(payload.subarray(0, 7))
      await sleep(60)
      res.write(payload.subarray(7))
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s2')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's2', url: `http://127.0.0.1:${port}/`, headers: [] })

    const ev = await bus.wait(isMsg)
    expect(isMsg(ev) && ev.message.data).toBe('привет мир')
  })

  it('forwards custom headers and resends Last-Event-ID with the retry delay', async () => {
    const seen: { headers: Record<string, unknown>; at: number }[] = []
    const port = await start((req, res) => {
      seen.push({ headers: req.headers, at: Date.now() })
      sseHead(res)
      if (seen.length === 1) {
        res.write('retry: 1200\nid: abc-1\ndata: first\n\n')
        res.end()
      } else {
        res.write('data: second\n\n')
      }
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s3')
    await call(IPC.realtime.sseConnect, bus.sender, {
      connId: 's3',
      url: `http://127.0.0.1:${port}/`,
      headers: [{ key: 'x-relay', value: 'sse', enabled: true }]
    })

    await bus.wait((e) => isMsg(e) && e.message.data === 'second', 10000)
    expect(seen).toHaveLength(2)
    expect(seen[0].headers['x-relay']).toBe('sse')
    expect(seen[0].headers.accept).toBe('text/event-stream')
    expect(seen[0].headers['last-event-id']).toBeUndefined()
    expect(seen[1].headers['last-event-id']).toBe('abc-1')
    // The engine clamps the reconnect delay to at least 1s; `retry: 1200` is honoured.
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(1100)
    const reconnecting = bus.events.find((e) => e.type === 'reconnecting')
    expect(reconnecting).toMatchObject({ type: 'reconnecting', delayMs: 1200 })
  })

  it('fails fast on a non-200 handshake and does not retry', async () => {
    let hits = 0
    const port = await start((_req, res) => {
      hits++
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('denied')
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s4')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's4', url: `http://127.0.0.1:${port}/`, headers: [] })

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toContain('401')
    await bus.wait((e) => e.type === 'close')
    await sleep(300)
    expect(hits).toBe(1)
  })

  it('stops reconnecting once the connection is closed from IPC', async () => {
    let hits = 0
    const port = await start((_req, res) => {
      hits++
      sseHead(res)
      res.write('data: tick\n\n')
      res.end()
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s5')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's5', url: `http://127.0.0.1:${port}/`, headers: [] })
    await bus.wait((e) => isMsg(e) && e.message.data === 'tick')
    await call(IPC.realtime.sseClose, bus.sender, 's5')
    await sleep(1500)
    expect(hits).toBe(1)
  })

  it('reports why a connection attempt failed before retrying', async () => {
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s7')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's7', url: `http://127.0.0.1:${port}/`, headers: [] })

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toMatch(/ECONNREFUSED|connect/i)
    await bus.wait((e) => e.type === 'reconnecting')
  })

  it('rejects a non-http(s) URL', async () => {
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('s6')
    await call(IPC.realtime.sseConnect, bus.sender, { connId: 's6', url: 'ws://127.0.0.1:1/', headers: [] })
    expect(bus.events[0]).toMatchObject({ type: 'error' })
  })
})

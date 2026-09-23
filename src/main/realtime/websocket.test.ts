/**
 * WebSocket engine tests — a real `ws` server on 127.0.0.1 with an ephemeral
 * port. The engine is driven through its registered IPC handlers so the test
 * covers the same surface the renderer uses.
 */
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import type { RealtimeEvent } from '@shared/types'
import { abortAllRealtime, abortRealtimeFor, registerRealtimeHandlers } from './index'

const req = createRequire(import.meta.url)
// `ws` ships no type declarations and is a transitive dep — require it untyped.
const { WebSocketServer } = req('ws') as { WebSocketServer: new (opts: unknown) => any }

/* ---------- tiny IPC harness ---------- */

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

/* ---------- servers ---------- */

let wss: any = null
let http: Server | null = null
let tcp: TcpServer | null = null
const tcpSockets: { destroy: () => void }[] = []

function startWsServer(opts: Record<string, unknown> = {}): Promise<{ port: number; server: any }> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1', ...opts })
    server.on('listening', () => resolve({ port: (server.address() as AddressInfo).port, server }))
  })
}

afterEach(async () => {
  abortAllRealtime()
  if (wss) {
    await new Promise<void>((r) => wss.close(() => r()))
    wss = null
  }
  if (http) {
    await new Promise<void>((r) => http!.close(() => r()))
    http = null
  }
  if (tcp) {
    for (const s of tcpSockets.splice(0)) s.destroy()
    await new Promise<void>((r) => tcp!.close(() => r()))
    tcp = null
  }
})

describe('realtime WebSocket', () => {
  it('forwards custom headers and negotiates a subprotocol', async () => {
    let seen: Record<string, string> = {}
    const started = await startWsServer({
      handleProtocols: (protocols: Set<string>) => (protocols.has('v2.relay') ? 'v2.relay' : false)
    })
    wss = started.server
    wss.on('connection', (sock: any, request: any) => {
      seen = request.headers
      sock.send('hello')
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c1')
    await call(IPC.realtime.wsConnect, bus.sender, {
      connId: 'c1',
      url: `ws://127.0.0.1:${started.port}/`,
      protocols: ['v1.relay', 'v2.relay'],
      headers: [
        { key: 'x-relay', value: 'yes', enabled: true },
        { key: 'x-off', value: 'no', enabled: false }
      ]
    })

    const open = await bus.wait((e) => e.type === 'open')
    expect(open).toMatchObject({ type: 'open', protocol: 'v2.relay' })
    expect(seen['x-relay']).toBe('yes')
    expect(seen['x-off']).toBeUndefined()
    expect(seen['sec-websocket-protocol']).toBe('v1.relay, v2.relay')

    const inbound = await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    expect(isMsg(inbound) && inbound.message.data).toBe('hello')
  })

  it('delivers binary frames as base64 with kind "binary" and keeps ordering', async () => {
    const started = await startWsServer()
    wss = started.server
    wss.on('connection', (sock: any) => {
      sock.send('first')
      sock.send(Buffer.from([0, 1, 254, 255]))
      sock.send('third')
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c2')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c2', url: `ws://127.0.0.1:${started.port}/`, headers: [] })

    await bus.wait((e) => isMsg(e) && e.message.data === 'third')
    const inbound = bus.events.filter(isMsg).map((e) => e.message)
    expect(inbound.map((m) => m.data)).toEqual(['first', Buffer.from([0, 1, 254, 255]).toString('base64'), 'third'])
    expect(inbound[1].kind).toBe('binary')
    expect(inbound[0].kind).toBe('text')
  })

  it('sends text frames and reports the server close code/reason', async () => {
    const started = await startWsServer()
    wss = started.server
    const received: string[] = []
    wss.on('connection', (sock: any) => {
      sock.on('message', (data: Buffer) => {
        received.push(data.toString('utf8'))
        sock.close(4001, 'bye now')
      })
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c3')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c3', url: `ws://127.0.0.1:${started.port}/`, headers: [] })
    await bus.wait((e) => e.type === 'open')
    await call(IPC.realtime.wsSend, bus.sender, 'c3', 'ping!')

    const close = await bus.wait((e) => e.type === 'close')
    expect(close).toMatchObject({ type: 'close', code: 4001, reason: 'bye now' })
    expect(received).toEqual(['ping!'])
  })

  it('reports the real reason when the handshake is not a 101', async () => {
    http = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('nope')
    })
    await new Promise<void>((r) => http!.listen(0, '127.0.0.1', r))
    const port = (http.address() as AddressInfo).port

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c4')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c4', url: `ws://127.0.0.1:${port}/`, headers: [] })

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).not.toBe('WebSocket connection error')
    expect(err.error.toLowerCase()).toContain('101')
  })

  it('reports the real reason when the TCP connection is refused', async () => {
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c5')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c5', url: `ws://127.0.0.1:${port}/`, headers: [] })

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).not.toBe('WebSocket connection error')
  })

  it('rejects a non-ws:// URL without opening a connection', async () => {
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c6')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c6', url: 'http://127.0.0.1:1/', headers: [] })
    expect(bus.events[0]).toMatchObject({ type: 'error' })
  })

  it('closes the socket from the IPC close handler', async () => {
    const started = await startWsServer()
    wss = started.server
    const closes: number[] = []
    wss.on('connection', (sock: any) => sock.on('close', (code: number) => closes.push(code)))

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c7')
    await call(IPC.realtime.wsConnect, bus.sender, { connId: 'c7', url: `ws://127.0.0.1:${started.port}/`, headers: [] })
    await bus.wait((e) => e.type === 'open')
    await call(IPC.realtime.wsClose, bus.sender, 'c7')
    await new Promise((r) => setTimeout(r, 300))
    expect(closes.length).toBe(1)
  })

  it('releases only the connections owned by a closed window', async () => {
    const started = await startWsServer()
    wss = started.server
    const live: any[] = []
    wss.on('connection', (sock: any) => {
      live.push(sock)
      sock.on('close', () => {
        sock.relayClosed = true
      })
    })

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const main = makeBus('own-main', 1)
    const pane = makeBus('own-pane', 2)
    await call(IPC.realtime.wsConnect, main.sender, { connId: 'own-main', url: `ws://127.0.0.1:${started.port}/`, headers: [] })
    await call(IPC.realtime.wsConnect, pane.sender, { connId: 'own-pane', url: `ws://127.0.0.1:${started.port}/`, headers: [] })
    await main.wait((e) => e.type === 'open')
    await pane.wait((e) => e.type === 'open')

    // The detached pane window (webContents id 2) goes away.
    abortRealtimeFor(2)
    await pane.wait((e) => e.type === 'close')
    await new Promise((r) => setTimeout(r, 200))
    expect(live).toHaveLength(2)
    expect(live.filter((s) => s.relayClosed)).toHaveLength(1)
    expect(main.events.some((e) => e.type === 'close')).toBe(false)
  })

  it('gives up on a handshake that never completes instead of hanging "connecting"', async () => {
    tcp = createTcpServer((sock) => {
      // Accept the TCP connection but never answer the upgrade request.
      tcpSockets.push(sock)
    })
    await new Promise<void>((r) => tcp!.listen(0, '127.0.0.1', r))
    const port = (tcp.address() as AddressInfo).port

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('c8')
    await call(IPC.realtime.wsConnect, bus.sender, {
      connId: 'c8',
      url: `ws://127.0.0.1:${port}/`,
      headers: [],
      handshakeTimeoutMs: 300
    })

    const err = (await bus.wait((e) => e.type === 'error', 5000)) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error.toLowerCase()).toContain('timed out')
  })
})

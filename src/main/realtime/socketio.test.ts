/**
 * Socket.IO engine tests — a minimal Engine.IO v4 / Socket.IO v5 server built on
 * the `ws` package (already installed as a transitive dependency), so the suite
 * stays offline and dependency-free.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import type { RealtimeEvent } from '@shared/types'
import { abortAllRealtime, registerRealtimeHandlers } from './index'

const req = createRequire(import.meta.url)
const { WebSocketServer } = req('ws') as { WebSocketServer: new (opts: unknown) => any }

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

/* ---------- minimal Socket.IO server ---------- */

interface SioServer {
  port: number
  /** upgrade request headers of every accepted connection */
  handshakes: Record<string, string>[]
  /** ["event", ...args] payloads received from the client */
  received: unknown[][]
  /** send an event to every connected client */
  emit: (event: string, ...args: unknown[]) => void
  /** socket.io DISCONNECT packets received */
  disconnects: number
  close: () => Promise<void>
}

function startSocketIo(opts: { rejectUpgrade?: boolean } = {}): Promise<SioServer> {
  const sockets = new Set<any>()
  const state = { handshakes: [] as Record<string, string>[], received: [] as unknown[][], disconnects: 0 }
  const server = new WebSocketServer({
    port: 0,
    host: '127.0.0.1',
    verifyClient: () => !opts.rejectUpgrade
  })

  server.on('connection', (sock: any, request: any) => {
    sockets.add(sock)
    state.handshakes.push(request.headers)
    // Engine.IO OPEN packet.
    sock.send(
      `0${JSON.stringify({ sid: 'eio-sid', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`
    )
    sock.on('message', (raw: Buffer) => {
      const text = raw.toString('utf8')
      if (text === '2') return sock.send('3') // engine.io ping -> pong
      if (text.startsWith('40')) return sock.send(`40${JSON.stringify({ sid: 'sio-sid' })}`) // namespace CONNECT
      if (text.startsWith('41')) {
        state.disconnects++
        return
      }
      if (text.startsWith('42')) state.received.push(JSON.parse(text.slice(2)) as unknown[])
    })
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => {})
  })

  return new Promise((resolve) => {
    server.on('listening', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        get handshakes() {
          return state.handshakes
        },
        get received() {
          return state.received
        },
        get disconnects() {
          return state.disconnects
        },
        emit: (event: string, ...args: unknown[]) => {
          for (const s of sockets) s.send(`42${JSON.stringify([event, ...args])}`)
        },
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.terminate()
            server.close(() => r())
          })
      })
    )
  })
}

let sio: SioServer | null = null

afterEach(async () => {
  abortAllRealtime()
  if (sio) {
    await sio.close()
    sio = null
  }
})

describe('realtime Socket.IO', () => {
  it('connects, forwards handshake headers and reports the socket id', async () => {
    sio = await startSocketIo()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io1')

    await call(IPC.realtime.socketioConnect, bus.sender, {
      connId: 'io1',
      url: `http://127.0.0.1:${sio.port}`,
      headers: [
        { key: 'x-relay', value: 'socketio', enabled: true },
        { key: 'x-skip', value: 'no', enabled: false }
      ]
    })

    const open = await bus.wait((e) => e.type === 'open')
    expect(open).toMatchObject({ type: 'open', protocol: 'sio-sid' })
    expect(sio.handshakes[0]['x-relay']).toBe('socketio')
    expect(sio.handshakes[0]['x-skip']).toBeUndefined()
  })

  it('emits JSON and plain-string payloads and logs inbound events by name', async () => {
    sio = await startSocketIo()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io2')

    await call(IPC.realtime.socketioConnect, bus.sender, { connId: 'io2', url: `http://127.0.0.1:${sio.port}`, headers: [] })
    await bus.wait((e) => e.type === 'open')

    await call(IPC.realtime.socketioEmit, bus.sender, 'io2', 'greet', '{"name":"relay"}')
    await call(IPC.realtime.socketioEmit, bus.sender, 'io2', 'plain', 'just text')
    await sleep(200)
    expect(sio.received).toEqual([
      ['greet', { name: 'relay' }],
      ['plain', 'just text']
    ])

    sio.emit('news', { headline: 'hello' })
    const inbound = await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    expect(isMsg(inbound) && inbound.message).toMatchObject({ kind: 'news', data: '{"headline":"hello"}' })
  })

  it('honours the listenEvents filter', async () => {
    sio = await startSocketIo()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io3')

    await call(IPC.realtime.socketioConnect, bus.sender, {
      connId: 'io3',
      url: `http://127.0.0.1:${sio.port}`,
      headers: [],
      listenEvents: ['wanted']
    })
    await bus.wait((e) => e.type === 'open')

    sio.emit('ignored', 'nope')
    sio.emit('wanted', 'yes')
    await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    await sleep(200)
    const inbound = bus.events.filter(isMsg).filter((e) => e.message.dir === 'in')
    expect(inbound.map((e) => e.message.kind)).toEqual(['wanted'])
  })

  it('sends a DISCONNECT packet when closed from IPC', async () => {
    sio = await startSocketIo()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io4')

    await call(IPC.realtime.socketioConnect, bus.sender, { connId: 'io4', url: `http://127.0.0.1:${sio.port}`, headers: [] })
    await bus.wait((e) => e.type === 'open')
    await call(IPC.realtime.socketioClose, bus.sender, 'io4')
    await sleep(300)
    expect(sio.disconnects).toBe(1)
  })

  it('reports a handshake rejection as an error', async () => {
    sio = await startSocketIo({ rejectUpgrade: true })
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io5')

    await call(IPC.realtime.socketioConnect, bus.sender, {
      connId: 'io5',
      url: `http://127.0.0.1:${sio.port}`,
      headers: [],
      reconnectionAttempts: 1,
      reconnectionDelay: 50
    })
    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toBeTruthy()
    await call(IPC.realtime.socketioClose, bus.sender, 'io5')
  })

  it('stops "reconnecting" with a terminal event when all retries are exhausted', async () => {
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('io6')
    await call(IPC.realtime.socketioConnect, bus.sender, {
      connId: 'io6',
      url: `http://127.0.0.1:${port}`,
      headers: [],
      reconnectionAttempts: 2,
      reconnectionDelay: 50
    })

    // After the last attempt the engine must say the connection is over instead
    // of leaving the panel on "Reconnecting…" forever.
    const done = await bus.wait((e) => e.type === 'close', 10000)
    expect(done.type).toBe('close')
    await call(IPC.realtime.socketioClose, bus.sender, 'io6')
  })
})

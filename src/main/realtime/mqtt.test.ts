/**
 * MQTT engine tests — a minimal in-process broker built on `mqtt-packet`
 * (already present as a dependency of `mqtt`), so the suite stays offline.
 */
import { createServer, type Socket } from 'node:net'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { IpcMain } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc-contract'
import type { RealtimeEvent } from '@shared/types'
import { abortAllRealtime, registerRealtimeHandlers } from './index'

const req = createRequire(import.meta.url)
const mqttPacket = req('mqtt-packet') as any

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

/* ---------- minimal MQTT 3.1.1 broker ---------- */

interface BrokerClient {
  socket: Socket
  subs: { topic: string; qos: number }[]
  will?: { topic: string; payload: Buffer; qos: number; retain: boolean }
  graceful: boolean
}

interface Broker {
  port: number
  connects: any[]
  subscribes: any[]
  publishes: any[]
  /** publishes the broker itself delivered, incl. Last-Will messages */
  delivered: any[]
  disconnects: number
  close: () => Promise<void>
}

function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true
    if (f[i] === '+') continue
    if (f[i] !== t[i]) return false
  }
  return f.length === t.length
}

function startBroker(): Promise<Broker> {
  const clients = new Set<BrokerClient>()
  const state = { connects: [] as any[], subscribes: [] as any[], publishes: [] as any[], delivered: [] as any[], disconnects: 0 }
  let messageId = 1

  const deliver = (topic: string, payload: Buffer, qos: number, retain: boolean): void => {
    state.delivered.push({ topic, payload: payload.toString('utf8'), qos, retain })
    for (const c of clients) {
      for (const s of c.subs) {
        if (!topicMatches(s.topic, topic)) continue
        const out = Math.min(qos, s.qos)
        c.socket.write(
          mqttPacket.generate({
            cmd: 'publish',
            topic,
            payload,
            qos: out,
            retain,
            dup: false,
            ...(out > 0 ? { messageId: messageId++ } : {})
          })
        )
        break
      }
    }
  }

  const server = createServer((socket) => {
    const client: BrokerClient = { socket, subs: [], graceful: false }
    clients.add(client)
    const parser = mqttPacket.parser({ protocolVersion: 4 })
    const send = (p: unknown): void => {
      socket.write(mqttPacket.generate(p))
    }
    parser.on('packet', (packet: any) => {
      switch (packet.cmd) {
        case 'connect':
          state.connects.push(packet)
          if (packet.will) client.will = packet.will
          send({ cmd: 'connack', returnCode: 0, sessionPresent: false })
          break
        case 'subscribe':
          state.subscribes.push(packet)
          client.subs.push(...packet.subscriptions)
          send({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map((s: any) => s.qos) })
          break
        case 'publish':
          state.publishes.push({ topic: packet.topic, payload: packet.payload.toString('utf8'), qos: packet.qos, retain: packet.retain })
          if (packet.qos === 1) send({ cmd: 'puback', messageId: packet.messageId })
          if (packet.qos === 2) send({ cmd: 'pubrec', messageId: packet.messageId })
          deliver(packet.topic, packet.payload, packet.qos, packet.retain)
          break
        case 'pubrel':
          send({ cmd: 'pubcomp', messageId: packet.messageId })
          break
        case 'pubrec':
          // Outbound QoS 2 delivery: the client acknowledged, release it.
          send({ cmd: 'pubrel', messageId: packet.messageId })
          break
        case 'pingreq':
          send({ cmd: 'pingresp' })
          break
        case 'disconnect':
          state.disconnects++
          client.graceful = true
          socket.end()
          break
        default:
          break
      }
    })
    parser.on('error', () => socket.destroy())
    socket.on('data', (d) => parser.parse(d))
    socket.on('error', () => {})
    socket.on('close', () => {
      clients.delete(client)
      // An ungraceful drop (no DISCONNECT packet) must publish the Last Will.
      if (!client.graceful && client.will) {
        const w = client.will
        deliver(w.topic, Buffer.isBuffer(w.payload) ? w.payload : Buffer.from(String(w.payload)), w.qos ?? 0, w.retain ?? false)
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        get connects() {
          return state.connects
        },
        get subscribes() {
          return state.subscribes
        },
        get publishes() {
          return state.publishes
        },
        get delivered() {
          return state.delivered
        },
        get disconnects() {
          return state.disconnects
        },
        close: () =>
          new Promise<void>((r) => {
            for (const c of clients) c.socket.destroy()
            server.close(() => r())
          })
      } as Broker)
    )
  })
}

let broker: Broker | null = null

afterEach(async () => {
  abortAllRealtime()
  await sleep(50)
  if (broker) {
    await broker.close()
    broker = null
  }
})

describe('realtime MQTT', () => {
  it('forwards credentials, Last-Will and the configured QoS', async () => {
    broker = await startBroker()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m1')

    await call(IPC.realtime.mqttConnect, bus.sender, {
      connId: 'm1',
      url: `mqtt://127.0.0.1:${broker.port}`,
      username: 'user1',
      password: 'secret',
      clientId: 'relay-test',
      subscribeTopics: ['relay/in'],
      qos: 1,
      lwt: { topic: 'relay/lwt', payload: 'gone', qos: 1, retain: true }
    })

    await bus.wait((e) => e.type === 'open')
    const connect = broker.connects[0]
    expect(connect.clientId).toBe('relay-test')
    expect(connect.username).toBe('user1')
    expect(String(connect.password)).toBe('secret')
    expect(connect.will.topic).toBe('relay/lwt')
    expect(String(connect.will.payload)).toBe('gone')
    expect(connect.will.qos).toBe(1)
    expect(connect.will.retain).toBe(true)

    await bus.wait((e) => isMsg(e) && e.message.data.includes('subscribed to relay/in'))
    expect(broker.subscribes[0].subscriptions[0]).toMatchObject({ topic: 'relay/in', qos: 1 })
  })

  it('publishes with the configured QoS and logs inbound messages under their topic', async () => {
    broker = await startBroker()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m2')

    await call(IPC.realtime.mqttConnect, bus.sender, {
      connId: 'm2',
      url: `mqtt://127.0.0.1:${broker.port}`,
      subscribeTopics: ['relay/echo'],
      qos: 2
    })
    await bus.wait((e) => e.type === 'open')
    await bus.wait((e) => isMsg(e) && e.message.data.includes('subscribed'))

    await call(IPC.realtime.mqttPublish, bus.sender, 'm2', 'relay/echo', 'hello broker')

    await bus.wait((e) => isMsg(e) && e.message.dir === 'in')
    expect(broker.publishes[0]).toMatchObject({ topic: 'relay/echo', payload: 'hello broker', qos: 2 })
    const out = bus.events.filter(isMsg).find((e) => e.message.dir === 'out')!
    expect(out.message).toMatchObject({ data: 'hello broker', kind: 'relay/echo' })
    const inbound = bus.events.filter(isMsg).find((e) => e.message.dir === 'in')!
    expect(inbound.message).toMatchObject({ data: 'hello broker', kind: 'relay/echo' })
  })

  it('subscribes to an extra topic on demand', async () => {
    broker = await startBroker()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m3')

    await call(IPC.realtime.mqttConnect, bus.sender, { connId: 'm3', url: `mqtt://127.0.0.1:${broker.port}` })
    await bus.wait((e) => e.type === 'open')
    await call(IPC.realtime.mqttSubscribe, bus.sender, 'm3', 'relay/later/#')
    await bus.wait((e) => isMsg(e) && e.message.data.includes('subscribed to relay/later/#'))
    expect(broker.subscribes[0].subscriptions[0]).toMatchObject({ topic: 'relay/later/#', qos: 0 })
  })

  it('disconnects gracefully so the broker does not fire the Last Will', async () => {
    broker = await startBroker()
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m4')

    await call(IPC.realtime.mqttConnect, bus.sender, {
      connId: 'm4',
      url: `mqtt://127.0.0.1:${broker.port}`,
      lwt: { topic: 'relay/lwt', payload: 'client died', qos: 0 }
    })
    await bus.wait((e) => e.type === 'open')

    await call(IPC.realtime.mqttClose, bus.sender, 'm4')
    await sleep(400)

    expect(broker.disconnects).toBe(1)
    expect(broker.delivered.filter((d) => d.topic === 'relay/lwt')).toEqual([])
  })

  it('surfaces a connection error for an unreachable broker', async () => {
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))

    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m5')
    await call(IPC.realtime.mqttConnect, bus.sender, { connId: 'm5', url: `mqtt://127.0.0.1:${port}` })

    const err = (await bus.wait((e) => e.type === 'error')) as Extract<RealtimeEvent, { type: 'error' }>
    expect(err.error).toMatch(/ECONNREFUSED|connect/i)
    await call(IPC.realtime.mqttClose, bus.sender, 'm5')
  })

  it('rejects a URL with an unsupported scheme', async () => {
    const { ipcMain, call } = fakeIpc()
    registerRealtimeHandlers(ipcMain)
    const bus = makeBus('m6')
    await call(IPC.realtime.mqttConnect, bus.sender, { connId: 'm6', url: 'http://127.0.0.1:1' })
    expect(bus.events[0]).toMatchObject({ type: 'error' })
  })
})

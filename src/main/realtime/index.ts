/**
 * Realtime clients (WebSocket + Server-Sent Events) for the request "modes".
 *
 * Both run in the main process and stream lifecycle/message events to the
 * renderer over a per-connection IPC channel (`realtime:event:<connId>`),
 * mirroring the AI streaming pattern. Each connection is tracked so it can be
 * closed individually or reaped on shutdown.
 *
 * This is an API client, so connecting to user-supplied ws(s)/http(s) URLs is by
 * design; we still restrict the URL scheme and honor the TLS-verification toggle.
 */
import { Agent, request as undiciRequest, WebSocket } from 'undici'
import type { Dispatcher } from 'undici'
import { io } from 'socket.io-client'
import mqtt from 'mqtt'
import type { BrowserWindow, IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { makeId } from '@shared/id'
import type {
  KV,
  MqttConnectSpec,
  RealtimeEvent,
  SocketIoConnectSpec,
  SseConnectSpec,
  WsConnectSpec
} from '@shared/types'

interface LiveConn {
  kind: 'ws' | 'sse' | 'socketio' | 'mqtt'
  /** ws text send */
  send?: (data: string) => void
  /** socket.io emit(event, data) */
  emit?: (event: string, data: string) => void
  /** mqtt publish(topic, payload) */
  publish?: (topic: string, payload: string) => void
  /** mqtt subscribe(topic) */
  subscribe?: (topic: string) => void
  close: () => void
}

const conns = new Map<string, LiveConn>()

type GetWindow = () => BrowserWindow | null

function emitter(getWindow: GetWindow, connId: string) {
  const channel = `${IPC.realtime.event}:${connId}`
  return (event: RealtimeEvent): void => {
    try {
      getWindow()?.webContents.send(channel, event)
    } catch {
      /* window gone */
    }
  }
}

function headersFromKV(kv: KV[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of kv ?? []) {
    if (h && h.enabled !== false && h.key) out[h.key] = h.value ?? ''
  }
  return out
}

function msg(dir: 'in' | 'out' | 'system', data: string, kind: string): RealtimeEvent {
  return { type: 'message', message: { id: makeId('rt'), dir, data, at: Date.now(), kind } }
}

/* ============================================================
 * WebSocket
 * ============================================================ */

function connectWebSocket(spec: WsConnectSpec, emit: (e: RealtimeEvent) => void): LiveConn {
  if (!/^wss?:\/\//i.test(spec.url)) {
    emit({ type: 'error', error: 'WebSocket URL must start with ws:// or wss://' })
    return { kind: 'ws', close: () => {} }
  }

  let dispatcher: Dispatcher | undefined
  if (spec.rejectUnauthorized === false) {
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  }

  let ws: WebSocket
  try {
    ws = new WebSocket(spec.url, {
      headers: headersFromKV(spec.headers),
      protocols: spec.protocols && spec.protocols.length ? spec.protocols : undefined,
      dispatcher
    } as never)
  } catch (err) {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    if (dispatcher) void dispatcher.close().catch(() => {})
    return { kind: 'ws', close: () => {} }
  }
  ws.binaryType = 'arraybuffer'

  let closed = false
  const cleanup = (): void => {
    if (dispatcher) {
      void dispatcher.close().catch(() => {})
      dispatcher = undefined
    }
  }

  ws.addEventListener('open', () => emit({ type: 'open', protocol: ws.protocol || undefined }))
  ws.addEventListener('message', (ev) => {
    const data: unknown = ev.data
    if (typeof data === 'string') {
      emit(msg('in', data, 'text'))
    } else if (data instanceof ArrayBuffer) {
      emit(msg('in', Buffer.from(data).toString('base64'), 'binary'))
    } else {
      emit(msg('in', String(data), 'text'))
    }
  })
  ws.addEventListener('error', () => {
    if (!closed) emit({ type: 'error', error: 'WebSocket connection error' })
    // A pre-handshake failure (DNS/TLS/refused) fires 'error' but NOT 'close',
    // so close the per-connection dispatcher here too or its Agent/sockets leak.
    cleanup()
  })
  ws.addEventListener('close', (ev) => {
    closed = true
    emit({ type: 'close', code: ev.code, reason: ev.reason })
    cleanup()
  })

  return {
    kind: 'ws',
    send: (data: string) => {
      try {
        ws.send(data)
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : 'Failed to send' })
      }
    },
    close: () => {
      closed = true
      try {
        ws.close()
      } catch {
        /* already closing */
      }
      cleanup()
    }
  }
}

/* ============================================================
 * Server-Sent Events
 * ============================================================ */

function connectSse(spec: SseConnectSpec, emit: (e: RealtimeEvent) => void): LiveConn {
  if (!/^https?:\/\//i.test(spec.url)) {
    emit({ type: 'error', error: 'SSE URL must start with http:// or https://' })
    return { kind: 'sse', close: () => {} }
  }

  const controller = new AbortController()
  let aborted = false
  let lastEventId = ''
  let retryMs = 3000
  let attempt = 0
  // Clamp the reconnect delay to [1s, 30s]: a `retry: 0` (or an instantly-ending
  // 200 stream) must not drive a tight loop, and a huge `retry:` value must not
  // overflow setTimeout (>2^31-1 ms fires almost immediately, re-creating the
  // tight loop from the other direction).
  const reconnectWait = (): number => Math.min(Math.max(retryMs, 1000), 30000)

  let dispatcher: Dispatcher | undefined
  if (spec.rejectUnauthorized === false) {
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  }

  // Parse a complete SSE block (separated by a blank line) into one event.
  const dispatchBlock = (raw: string): void => {
    if (!raw) return
    let eventType = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line === '' || line[0] === ':') continue // comment / keep-alive
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value[0] === ' ') value = value.slice(1)
      if (field === 'event') eventType = value
      else if (field === 'data') dataLines.push(value)
      else if (field === 'id') lastEventId = value
      else if (field === 'retry') {
        const n = Number(value)
        if (Number.isFinite(n) && n >= 0) retryMs = n
      }
    }
    if (dataLines.length === 0 && eventType === 'message') return
    emit(msg('in', dataLines.join('\n'), eventType))
  }

  const run = async (): Promise<void> => {
    while (!aborted) {
      try {
        const res = await undiciRequest(spec.url, {
          method: 'GET',
          headers: {
            ...headersFromKV(spec.headers),
            accept: 'text/event-stream',
            'cache-control': 'no-cache',
            ...(lastEventId ? { 'last-event-id': lastEventId } : {})
          },
          signal: controller.signal,
          dispatcher,
          maxRedirections: 5
        })

        if (res.statusCode !== 200) {
          await res.body.dump?.()
          emit({ type: 'error', error: `SSE handshake failed: HTTP ${res.statusCode}` })
          break
        }
        attempt = 0
        emit({ type: 'open' })

        let buf = ''
        for await (const chunk of res.body) {
          buf += chunk.toString('utf8')
          // SSE events are separated by a blank line (\n\n or \r\n\r\n).
          let sep = findSeparator(buf)
          while (sep) {
            dispatchBlock(buf.slice(0, sep.index).replace(/\r/g, ''))
            buf = buf.slice(sep.index + sep.len)
            sep = findSeparator(buf)
          }
        }
        // Stream ended cleanly → reconnect (EventSource semantics) unless closed.
        if (aborted) break
        attempt++
        emit({ type: 'reconnecting', attempt, delayMs: reconnectWait() })
        await delay(reconnectWait(), controller.signal)
      } catch (err) {
        if (aborted) break
        attempt++
        emit({ type: 'reconnecting', attempt, delayMs: reconnectWait() })
        try {
          await delay(reconnectWait(), controller.signal)
        } catch {
          break
        }
        void err
      }
    }
    if (dispatcher) {
      void dispatcher.close().catch(() => {})
      dispatcher = undefined
    }
    if (!aborted) emit({ type: 'close' })
  }

  void run()

  return {
    kind: 'sse',
    close: () => {
      aborted = true
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    }
  }
}

function findSeparator(buf: string): { index: number; len: number } | null {
  const a = buf.indexOf('\n\n')
  const b = buf.indexOf('\r\n\r\n')
  if (a === -1 && b === -1) return null
  if (b === -1 || (a !== -1 && a < b)) return { index: a, len: 2 }
  return { index: b, len: 4 }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/* ============================================================
 * Socket.IO
 * ============================================================ */

/** Best-effort JSON parse for emitted/received payloads (falls back to string). */
function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

function stringifyArgs(args: unknown[]): string {
  const v = args.length <= 1 ? args[0] : args
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function connectSocketIo(spec: SocketIoConnectSpec, emit: (e: RealtimeEvent) => void): LiveConn {
  if (!/^(https?|wss?):\/\//i.test(spec.url)) {
    emit({ type: 'error', error: 'Socket.IO URL must start with http(s):// or ws(s)://' })
    return { kind: 'socketio', close: () => {} }
  }
  let socket: ReturnType<typeof io>
  try {
    socket = io(spec.url, {
      transports: ['websocket', 'polling'],
      extraHeaders: headersFromKV(spec.headers),
      rejectUnauthorized: spec.rejectUnauthorized !== false,
      reconnection: true,
      // Bound the retries — socket.io defaults reconnectionAttempts to Infinity.
      reconnectionAttempts: 10,
      forceNew: true
    })
  } catch (err) {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    return { kind: 'socketio', close: () => {} }
  }

  socket.on('connect', () => emit({ type: 'open', protocol: socket.id }))
  socket.on('disconnect', (reason: string) => emit({ type: 'close', reason }))
  socket.on('connect_error', (err: Error) => emit({ type: 'error', error: err?.message ?? 'connect_error' }))
  socket.io.on('reconnect_attempt', (attempt: number) => emit({ type: 'reconnecting', attempt, delayMs: 0 }))

  const listen = spec.listenEvents?.filter(Boolean) ?? []
  if (listen.length) {
    for (const ev of listen) socket.on(ev, (...args: unknown[]) => emit(msg('in', stringifyArgs(args), ev)))
  } else {
    socket.onAny((ev: string, ...args: unknown[]) => emit(msg('in', stringifyArgs(args), ev)))
  }

  return {
    kind: 'socketio',
    emit: (event: string, data: string) => {
      try {
        socket.emit(event, tryJson(data))
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : 'emit failed' })
      }
    },
    close: () => {
      try {
        socket.close()
      } catch {
        /* ignore */
      }
    }
  }
}

/* ============================================================
 * MQTT
 * ============================================================ */

function connectMqtt(spec: MqttConnectSpec, emit: (e: RealtimeEvent) => void): LiveConn {
  if (!/^(mqtts?|wss?|tcp):\/\//i.test(spec.url)) {
    emit({ type: 'error', error: 'MQTT URL must start with mqtt(s)://, ws(s):// or tcp://' })
    return { kind: 'mqtt', close: () => {} }
  }
  // Clamp to a valid MQTT QoS (0/1/2); default 0 when unset/invalid.
  const qos: 0 | 1 | 2 = spec.qos === 1 || spec.qos === 2 ? spec.qos : 0

  // Build the Last-Will-and-Testament option only when a topic is provided.
  const will =
    spec.lwt && spec.lwt.topic
      ? {
          topic: spec.lwt.topic,
          payload: spec.lwt.payload ?? '',
          qos: (spec.lwt.qos === 1 || spec.lwt.qos === 2 ? spec.lwt.qos : 0) as 0 | 1 | 2,
          retain: spec.lwt.retain === true
        }
      : undefined

  let client: ReturnType<typeof mqtt.connect>
  try {
    client = mqtt.connect(spec.url, {
      username: spec.username || undefined,
      password: spec.password || undefined,
      clientId: spec.clientId || undefined,
      rejectUnauthorized: spec.rejectUnauthorized !== false,
      reconnectPeriod: 3000,
      connectTimeout: 15000,
      will
    })
  } catch (err) {
    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    return { kind: 'mqtt', close: () => {} }
  }

  client.on('connect', () => {
    emit({ type: 'open' })
    for (const t of spec.subscribeTopics?.filter(Boolean) ?? []) {
      client.subscribe(t, { qos }, (err) =>
        emit(msg('system', err ? `subscribe ${t} failed: ${err.message}` : `subscribed to ${t} (QoS ${qos})`, 'system'))
      )
    }
  })
  client.on('message', (topic: string, payload: Buffer) => emit(msg('in', payload.toString('utf8'), topic)))
  client.on('error', (err: Error) => emit({ type: 'error', error: err?.message ?? 'mqtt error' }))
  client.on('reconnect', () => emit({ type: 'reconnecting', attempt: 0, delayMs: 3000 }))
  client.on('close', () => emit({ type: 'close' }))

  return {
    kind: 'mqtt',
    publish: (topic: string, payload: string) => {
      try {
        client.publish(topic, payload, { qos })
        emit(msg('out', payload, topic))
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : 'publish failed' })
      }
    },
    subscribe: (topic: string) => {
      try {
        client.subscribe(topic, { qos }, (err) =>
          emit(msg('system', err ? `subscribe ${topic} failed: ${err.message}` : `subscribed to ${topic} (QoS ${qos})`, 'system'))
        )
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : 'subscribe failed' })
      }
    },
    close: () => {
      try {
        client.end(true)
      } catch {
        /* ignore */
      }
    }
  }
}

/* ============================================================
 * IPC wiring
 * ============================================================ */

function closeConn(connId: string): void {
  const c = conns.get(connId)
  if (c) {
    c.close()
    conns.delete(connId)
  }
}

export function registerRealtimeHandlers(ipcMain: IpcMain, getWindow: GetWindow): void {
  ipcMain.handle(IPC.realtime.wsConnect, async (_e, spec: WsConnectSpec) => {
    closeConn(spec.connId) // replace any prior connection on this id
    const emit = emitter(getWindow, spec.connId)
    conns.set(spec.connId, connectWebSocket(spec, emit))
  })

  ipcMain.handle(IPC.realtime.wsSend, async (_e, connId: string, data: string) => {
    conns.get(connId)?.send?.(data)
  })

  ipcMain.handle(IPC.realtime.wsClose, async (_e, connId: string) => {
    closeConn(connId)
  })

  ipcMain.handle(IPC.realtime.sseConnect, async (_e, spec: SseConnectSpec) => {
    closeConn(spec.connId)
    const emit = emitter(getWindow, spec.connId)
    conns.set(spec.connId, connectSse(spec, emit))
  })

  ipcMain.handle(IPC.realtime.sseClose, async (_e, connId: string) => {
    closeConn(connId)
  })

  ipcMain.handle(IPC.realtime.socketioConnect, async (_e, spec: SocketIoConnectSpec) => {
    closeConn(spec.connId)
    conns.set(spec.connId, connectSocketIo(spec, emitter(getWindow, spec.connId)))
  })
  ipcMain.handle(IPC.realtime.socketioEmit, async (_e, connId: string, event: string, data: string) => {
    conns.get(connId)?.emit?.(event, data)
  })
  ipcMain.handle(IPC.realtime.socketioClose, async (_e, connId: string) => {
    closeConn(connId)
  })

  ipcMain.handle(IPC.realtime.mqttConnect, async (_e, spec: MqttConnectSpec) => {
    closeConn(spec.connId)
    conns.set(spec.connId, connectMqtt(spec, emitter(getWindow, spec.connId)))
  })
  ipcMain.handle(IPC.realtime.mqttPublish, async (_e, connId: string, topic: string, payload: string) => {
    conns.get(connId)?.publish?.(topic, payload)
  })
  ipcMain.handle(IPC.realtime.mqttSubscribe, async (_e, connId: string, topic: string) => {
    conns.get(connId)?.subscribe?.(topic)
  })
  ipcMain.handle(IPC.realtime.mqttClose, async (_e, connId: string) => {
    closeConn(connId)
  })
}

/** Close every live connection (call on window close / app quit). */
export function abortAllRealtime(): void {
  for (const c of conns.values()) {
    try {
      c.close()
    } catch {
      /* ignore */
    }
  }
  conns.clear()
}

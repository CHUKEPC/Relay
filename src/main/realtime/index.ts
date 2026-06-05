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
import type { BrowserWindow, IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { makeId } from '@shared/id'
import type { KV, RealtimeEvent, SseConnectSpec, WsConnectSpec } from '@shared/types'

interface LiveConn {
  kind: 'ws' | 'sse'
  send?: (data: string) => void
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

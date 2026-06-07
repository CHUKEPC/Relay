import { create } from 'zustand'
import type { KV, RealtimeEvent, RealtimeMessage } from '@shared/types'
import { makeId } from '@shared/id'

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
/** Connection kinds handled by the realtime panel. */
export type RtKind = 'websocket' | 'sse' | 'socketio' | 'mqtt'

export interface TabRealtime {
  status: RealtimeStatus
  kind?: RtKind
  connId?: string
  url?: string
  messages: RealtimeMessage[]
  error?: string
}

const EMPTY: TabRealtime = { status: 'idle', messages: [] }
/** Cap the in-memory log so a chatty stream can't grow unbounded. */
const MAX_MESSAGES = 2000

/** Per-tab unsubscribe handles for the IPC event listeners (kept out of state). */
const subs = new Map<string, () => void>()

export interface ConnectOpts {
  kind: RtKind
  url: string
  headers: KV[]
  rejectUnauthorized: boolean
}

interface RealtimeState {
  byTab: Record<string, TabRealtime>
  get: (tabId: string) => TabRealtime
  connect: (tabId: string, opts: ConnectOpts) => void
  disconnect: (tabId: string) => void
  disconnectAll: () => void
  /** WebSocket: send a text frame. */
  send: (tabId: string, data: string) => void
  /** Socket.IO: emit an event. */
  emit: (tabId: string, event: string, data: string) => void
  /** MQTT: publish to a topic. */
  publish: (tabId: string, topic: string, payload: string) => void
  /** MQTT: subscribe to a topic. */
  subscribe: (tabId: string, topic: string) => void
  clear: (tabId: string) => void
}

function sys(text: string): RealtimeMessage {
  return { id: makeId('rt'), dir: 'system', data: text, at: Date.now(), kind: 'system' }
}

export const useRealtime = create<RealtimeState>((set, get) => {
  const patch = (tabId: string, p: Partial<TabRealtime>): void =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? EMPTY), ...p } } }))

  const append = (tabId: string, msg: RealtimeMessage): void =>
    set((s) => {
      const cur = s.byTab[tabId] ?? EMPTY
      const messages = [...cur.messages, msg]
      if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES)
      return { byTab: { ...s.byTab, [tabId]: { ...cur, messages } } }
    })

  const onEvent = (tabId: string, ev: RealtimeEvent): void => {
    switch (ev.type) {
      case 'open':
        patch(tabId, { status: 'open', error: undefined })
        append(tabId, sys(ev.protocol ? `Connected (${ev.protocol})` : 'Connected'))
        break
      case 'message':
        append(tabId, ev.message)
        break
      case 'close':
        patch(tabId, { status: 'closed' })
        append(tabId, sys(`Closed${ev.code ? ` (code ${ev.code})` : ''}${ev.reason ? `: ${ev.reason}` : ''}`))
        break
      case 'error':
        patch(tabId, { status: 'error', error: ev.error })
        append(tabId, sys(`Error: ${ev.error}`))
        break
      case 'reconnecting':
        append(tabId, sys(`Reconnecting (attempt ${ev.attempt}, in ${ev.delayMs} ms)…`))
        break
    }
  }

  const fail = (tabId: string, err: unknown): void =>
    onEvent(tabId, { type: 'error', error: err instanceof Error ? err.message : String(err) })

  return {
    byTab: {},
    get: (tabId) => get().byTab[tabId] ?? EMPTY,

    connect: (tabId, opts) => {
      get().disconnect(tabId)
      const connId = makeId('rtc')
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: { status: 'connecting', kind: opts.kind, connId, url: opts.url, messages: [sys(`Connecting to ${opts.url}…`)] }
        }
      }))
      const unsub = window.api.onRealtime(connId, (ev) => onEvent(tabId, ev))
      subs.set(tabId, unsub)
      const ru = opts.rejectUnauthorized
      const guard = (p: Promise<void>): void => void p.catch((err) => fail(tabId, err))
      switch (opts.kind) {
        case 'websocket':
          guard(window.api.wsConnect({ connId, url: opts.url, headers: opts.headers, rejectUnauthorized: ru }))
          break
        case 'sse':
          guard(window.api.sseConnect({ connId, url: opts.url, headers: opts.headers, rejectUnauthorized: ru }))
          break
        case 'socketio':
          guard(window.api.socketioConnect({ connId, url: opts.url, headers: opts.headers, rejectUnauthorized: ru }))
          break
        case 'mqtt':
          guard(window.api.mqttConnect({ connId, url: opts.url, rejectUnauthorized: ru }))
          break
      }
    },

    disconnect: (tabId) => {
      const cur = get().byTab[tabId]
      const connId = cur?.connId
      const unsub = subs.get(tabId)
      if (unsub) {
        unsub()
        subs.delete(tabId)
      }
      if (connId) {
        const close =
          cur?.kind === 'sse'
            ? window.api.sseClose
            : cur?.kind === 'socketio'
              ? window.api.socketioClose
              : cur?.kind === 'mqtt'
                ? window.api.mqttClose
                : window.api.wsClose
        void close(connId).catch(() => {})
      }
      // Reset to 'closed' from ANY active/errored state (incl. 'error', where
      // socket.io/mqtt may still be retrying) so the button returns to "Connect".
      if (cur && cur.status !== 'idle' && cur.status !== 'closed') {
        patch(tabId, { status: 'closed' })
      }
    },

    disconnectAll: () => {
      for (const tabId of Object.keys(get().byTab)) get().disconnect(tabId)
      set({ byTab: {} })
    },

    send: (tabId, data) => {
      const cur = get().byTab[tabId]
      if (!cur || cur.status !== 'open' || !cur.connId || cur.kind !== 'websocket') return
      void window.api.wsSend(cur.connId, data).catch(() => {})
      append(tabId, { id: makeId('rt'), dir: 'out', data, at: Date.now(), kind: 'text' })
    },

    emit: (tabId, event, data) => {
      const cur = get().byTab[tabId]
      if (!cur || cur.status !== 'open' || !cur.connId || cur.kind !== 'socketio') return
      void window.api.socketioEmit(cur.connId, event, data).catch(() => {})
      append(tabId, { id: makeId('rt'), dir: 'out', data, at: Date.now(), kind: event })
    },

    publish: (tabId, topic, payload) => {
      const cur = get().byTab[tabId]
      if (!cur || cur.status !== 'open' || !cur.connId || cur.kind !== 'mqtt') return
      // The main MQTT engine echoes published messages into the log, so don't
      // append here to avoid duplicates.
      void window.api.mqttPublish(cur.connId, topic, payload).catch(() => {})
    },

    subscribe: (tabId, topic) => {
      const cur = get().byTab[tabId]
      if (!cur || cur.status !== 'open' || !cur.connId || cur.kind !== 'mqtt') return
      void window.api.mqttSubscribe(cur.connId, topic).catch(() => {})
    },

    clear: (tabId) => patch(tabId, { messages: [] })
  }
})

import { create } from 'zustand'
import type { KV, RealtimeEvent, RealtimeKind, RealtimeMessage } from '@shared/types'
import { makeId } from '@shared/id'

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface TabRealtime {
  status: RealtimeStatus
  kind?: RealtimeKind
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
  kind: RealtimeKind
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
  send: (tabId: string, data: string) => void
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
        append(tabId, sys(ev.protocol ? `Connected (protocol: ${ev.protocol})` : 'Connected'))
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

  return {
    byTab: {},
    get: (tabId) => get().byTab[tabId] ?? EMPTY,

    connect: (tabId, opts) => {
      // Tear down any existing connection on this tab first.
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
      if (opts.kind === 'websocket') {
        void window.api
          .wsConnect({ connId, url: opts.url, headers: opts.headers, rejectUnauthorized: opts.rejectUnauthorized })
          .catch((err) => onEvent(tabId, { type: 'error', error: err instanceof Error ? err.message : String(err) }))
      } else {
        void window.api
          .sseConnect({ connId, url: opts.url, headers: opts.headers, rejectUnauthorized: opts.rejectUnauthorized })
          .catch((err) => onEvent(tabId, { type: 'error', error: err instanceof Error ? err.message : String(err) }))
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
        if (cur?.kind === 'sse') void window.api.sseClose(connId).catch(() => {})
        else void window.api.wsClose(connId).catch(() => {})
      }
      if (cur && (cur.status === 'open' || cur.status === 'connecting')) {
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

    clear: (tabId) => patch(tabId, { messages: [] })
  }
})

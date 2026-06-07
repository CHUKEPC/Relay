import { create } from 'zustand'
import type {
  GrpcMethodKind,
  GrpcReflectSpec,
  GrpcServiceInfo,
  KV,
  RealtimeEvent,
  RealtimeMessage
} from '@shared/types'
import { makeId } from '@shared/id'

export type GrpcStatus = 'idle' | 'running' | 'done' | 'error'

export interface TabGrpc {
  status: GrpcStatus
  connId?: string
  messages: RealtimeMessage[]
  error?: string
  /** streaming kind of the active call — drives the Send/Finish composer */
  callKind?: GrpcMethodKind
}

const EMPTY: TabGrpc = { status: 'idle', messages: [] }
const MAX_MESSAGES = 2000

/** Per-tab unsubscribe handles for the IPC event listeners (kept out of state). */
const subs = new Map<string, () => void>()

export interface GrpcInvokeArgs {
  proto: string
  address: string
  service: string
  method: string
  message: string
  metadata: KV[]
  plaintext: boolean
  rejectUnauthorized: boolean
  callKind: GrpcMethodKind
  /** discover descriptors via Server Reflection instead of `proto` */
  useReflection?: boolean
  /** per-call deadline in milliseconds (0/undefined = none) */
  deadlineMs?: number
  /** mTLS PEM paths (read in main only) */
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/** Result of a Server Reflection discovery: services or a structured error. */
export interface GrpcReflectResult {
  services: GrpcServiceInfo[]
  error?: string
}

interface GrpcState {
  byTab: Record<string, TabGrpc>
  get: (tabId: string) => TabGrpc
  invoke: (tabId: string, args: GrpcInvokeArgs) => void
  /** Discover services via Server Reflection. Resolves with services or an error. */
  reflect: (spec: GrpcReflectSpec) => Promise<GrpcReflectResult>
  send: (tabId: string, message: string) => void
  end: (tabId: string) => void
  cancel: (tabId: string) => void
  clear: (tabId: string) => void
}

function sys(text: string): RealtimeMessage {
  return { id: makeId('rt'), dir: 'system', data: text, at: Date.now(), kind: 'system' }
}

export const useGrpc = create<GrpcState>((set, get) => {
  const patch = (tabId: string, p: Partial<TabGrpc>): void =>
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
        patch(tabId, { status: 'running', error: undefined })
        append(tabId, sys(`Вызов запущен (${ev.protocol ?? 'unary'})`))
        break
      case 'message':
        append(tabId, ev.message)
        break
      case 'close':
        patch(tabId, { status: 'done' })
        append(tabId, sys('Вызов завершён'))
        break
      case 'error':
        patch(tabId, { status: 'error', error: ev.error })
        append(tabId, sys(`Ошибка: ${ev.error}`))
        break
      case 'reconnecting':
        break
    }
  }

  const teardown = (tabId: string): void => {
    const unsub = subs.get(tabId)
    if (unsub) {
      unsub()
      subs.delete(tabId)
    }
  }

  return {
    byTab: {},
    get: (tabId) => get().byTab[tabId] ?? EMPTY,

    invoke: (tabId, args) => {
      get().cancel(tabId)
      const connId = makeId('grpcc')
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            status: 'running',
            connId,
            callKind: args.callKind,
            messages: [sys(`${args.service}/${args.method} → ${args.address}`)]
          }
        }
      }))
      const unsub = window.api.onGrpc(connId, (ev) => onEvent(tabId, ev))
      subs.set(tabId, unsub)
      window.api
        .grpcInvoke({
          connId,
          proto: args.proto,
          address: args.address,
          service: args.service,
          method: args.method,
          message: args.message,
          metadata: args.metadata,
          plaintext: args.plaintext,
          rejectUnauthorized: args.rejectUnauthorized,
          useReflection: args.useReflection,
          deadlineMs: args.deadlineMs,
          caCertPath: args.caCertPath,
          clientCertPath: args.clientCertPath,
          clientKeyPath: args.clientKeyPath
        })
        .catch((err) => onEvent(tabId, { type: 'error', error: err instanceof Error ? err.message : String(err) }))
    },

    reflect: async (spec) => {
      try {
        const res = await window.api.grpcReflect(spec)
        return { services: res.services, error: res.error }
      } catch (err) {
        return { services: [], error: err instanceof Error ? err.message : String(err) }
      }
    },

    send: (tabId, message) => {
      const cur = get().byTab[tabId]
      if (!cur || cur.status !== 'running' || !cur.connId) return
      void window.api.grpcSend(cur.connId, message).catch(() => {})
    },

    end: (tabId) => {
      const cur = get().byTab[tabId]
      if (!cur || !cur.connId) return
      void window.api.grpcEnd(cur.connId).catch(() => {})
    },

    cancel: (tabId) => {
      const cur = get().byTab[tabId]
      teardown(tabId)
      if (cur?.connId) void window.api.grpcCancel(cur.connId).catch(() => {})
      if (cur && cur.status === 'running') patch(tabId, { status: 'done' })
    },

    clear: (tabId) => patch(tabId, { messages: [] })
  }
})

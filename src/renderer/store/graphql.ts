import { create } from 'zustand'
import type { GraphqlSchema } from '@shared/types'

export type GraphqlSchemaStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface GraphqlSchemaEntry {
  status: GraphqlSchemaStatus
  schema?: GraphqlSchema
  error?: string
}

const EMPTY: GraphqlSchemaEntry = { status: 'idle' }

interface GraphqlState {
  /** Introspected schema per request id (so each request remembers its schema). */
  byRequest: Record<string, GraphqlSchemaEntry>
  get: (requestId: string) => GraphqlSchemaEntry
  /** Run introspection for a request against the given (interpolated) url + headers. */
  introspect: (requestId: string, url: string, headers: { key: string; value: string }[], rejectUnauthorized: boolean) => Promise<void>
}

export const useGraphqlSchema = create<GraphqlState>((set, store) => ({
  byRequest: {},
  get: (requestId) => store().byRequest[requestId] ?? EMPTY,
  introspect: async (requestId, url, headers, rejectUnauthorized) => {
    set((s) => ({ byRequest: { ...s.byRequest, [requestId]: { status: 'loading' } } }))
    try {
      const res = await window.api.graphqlIntrospect(url, headers, rejectUnauthorized)
      if (res.ok && res.schema) {
        set((s) => ({ byRequest: { ...s.byRequest, [requestId]: { status: 'ready', schema: res.schema } } }))
      } else {
        set((s) => ({
          byRequest: { ...s.byRequest, [requestId]: { status: 'error', error: res.error ?? 'Не удалось получить схему' } }
        }))
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      set((s) => ({ byRequest: { ...s.byRequest, [requestId]: { status: 'error', error } } }))
    }
  }
}))

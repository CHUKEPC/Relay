import { create } from 'zustand'
import type { ResponseResult, ScriptTestResult, ScriptConsoleLine } from '@shared/types'

export type ResponseStatus = 'empty' | 'loading' | 'done' | 'error'

export interface TabResponse {
  status: ResponseStatus
  result?: ResponseResult
  requestId?: string
  testResults?: ScriptTestResult[]
  consoleLines?: ScriptConsoleLine[]
}

interface ResponseState {
  byTab: Record<string, TabResponse>
  get: (tabId: string) => TabResponse
  setLoading: (tabId: string, requestId: string) => void
  setResult: (tabId: string, requestId: string, result: ResponseResult) => void
  setTests: (tabId: string, requestId: string, tests: ScriptTestResult[], logs: ScriptConsoleLine[]) => void
  setEmpty: (tabId: string) => void
}

const EMPTY: TabResponse = { status: 'empty' }

/** A late result is stale if a newer request has since claimed this tab. */
function isStale(cur: TabResponse | undefined, requestId: string): boolean {
  return !!cur?.requestId && cur.requestId !== requestId
}

export const useResponse = create<ResponseState>((set, get) => ({
  byTab: {},
  get: (tabId) => get().byTab[tabId] ?? EMPTY,
  setLoading: (tabId, requestId) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: 'loading', requestId } } })),
  setResult: (tabId, requestId, result) =>
    set((s) => {
      if (isStale(s.byTab[tabId], requestId)) return s
      return { byTab: { ...s.byTab, [tabId]: { status: result.error ? 'error' : 'done', result, requestId } } }
    }),
  setTests: (tabId, requestId, tests, logs) =>
    set((s) => {
      if (isStale(s.byTab[tabId], requestId)) return s
      return { byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? EMPTY), testResults: tests, consoleLines: logs } } }
    }),
  setEmpty: (tabId) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: 'empty' } } }))
}))

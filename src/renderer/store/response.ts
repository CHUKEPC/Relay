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
  setResult: (tabId: string, result: ResponseResult) => void
  setTests: (tabId: string, tests: ScriptTestResult[], logs: ScriptConsoleLine[]) => void
  setEmpty: (tabId: string) => void
}

const EMPTY: TabResponse = { status: 'empty' }

export const useResponse = create<ResponseState>((set, get) => ({
  byTab: {},
  get: (tabId) => get().byTab[tabId] ?? EMPTY,
  setLoading: (tabId, requestId) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: 'loading', requestId } } })),
  setResult: (tabId, result) =>
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: { status: result.error ? 'error' : 'done', result } }
    })),
  setTests: (tabId, tests, logs) =>
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? EMPTY), testResults: tests, consoleLines: logs } } })),
  setEmpty: (tabId) => set((s) => ({ byTab: { ...s.byTab, [tabId]: { status: 'empty' } } }))
}))

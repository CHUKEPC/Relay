import { create } from 'zustand'

export type RequestSubTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'examples'

interface RequestUiState {
  /** Selected builder sub-tab per request tab, so undo can reveal the changed area. */
  subTab: Record<string, RequestSubTab>
  setSubTab: (tabId: string, sub: RequestSubTab) => void
}

export const useRequestUi = create<RequestUiState>((set) => ({
  subTab: {},
  setSubTab: (tabId, sub) => set((s) => ({ subTab: { ...s.subTab, [tabId]: sub } }))
}))

import { create } from 'zustand'

export type RequestSubTab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'examples'

/**
 * How a tab's response panel was left: the selected response tab, the body
 * view and the filter. The panel is rebuilt whenever its tab is shown again,
 * so this lives outside it — switching tabs and back restores it as it was.
 */
export interface RespViewState {
  tab: string
  bodyView: string
  search: string
}

const RESP_VIEW_DEFAULT: RespViewState = { tab: 'body', bodyView: 'pretty', search: '' }

interface RequestUiState {
  /** Selected builder sub-tab per request tab, so undo can reveal the changed area. */
  subTab: Record<string, RequestSubTab>
  setSubTab: (tabId: string, sub: RequestSubTab) => void
  /** Response panel state per request tab. */
  respView: Record<string, RespViewState>
  setRespView: (tabId: string, patch: Partial<RespViewState>) => void
  /** Forget a closed tab. */
  forgetTab: (tabId: string) => void
}

export const useRequestUi = create<RequestUiState>((set) => ({
  subTab: {},
  setSubTab: (tabId, sub) => set((s) => ({ subTab: { ...s.subTab, [tabId]: sub } })),
  respView: {},
  setRespView: (tabId, patch) =>
    set((s) => ({ respView: { ...s.respView, [tabId]: { ...RESP_VIEW_DEFAULT, ...s.respView[tabId], ...patch } } })),
  forgetTab: (tabId) =>
    set((s) => {
      if (!(tabId in s.subTab) && !(tabId in s.respView)) return s
      const { [tabId]: _sub, ...subTab } = s.subTab
      const { [tabId]: _view, ...respView } = s.respView
      return { subTab, respView }
    })
}))

/** The response panel state of a tab, defaults filled in. */
export function respViewOf(state: Pick<RequestUiState, 'respView'>, tabId: string): RespViewState {
  return state.respView[tabId] ?? RESP_VIEW_DEFAULT
}

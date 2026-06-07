import { create } from 'zustand'
import type { RequestModel, TabModel, TabsDoc } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { emptyTabs } from './defaults'
import { emptyRequest } from './collections'
import { useRealtime } from './realtime'
import { useGrpc } from './grpc'
import { useResponse } from './response'
import { persist } from './persist'

interface TabsState {
  doc: TabsDoc
  hydrate: (doc: TabsDoc) => void
  activeTab: () => TabModel | null
  activeRequest: () => RequestModel | null
  setActive: (id: string) => void
  openSaved: (request: RequestModel, savedRequestId: string) => void
  openNew: (request?: RequestModel) => string
  closeTab: (id: string) => void
  patchActive: (patch: Partial<RequestModel>) => void
  patchTab: (tabId: string, patch: Partial<RequestModel>) => void
  markSaved: (tabId: string, savedRequestId: string) => void
}

export const useTabs = create<TabsState>((set, get) => {
  const commit = (next: Partial<TabsDoc>) => {
    const doc = { ...get().doc, ...next, version: STORAGE_VERSION }
    set({ doc })
    persist('tabs', doc)
  }

  return {
    doc: emptyTabs(),
    hydrate: (doc) => set({ doc: { ...doc, version: STORAGE_VERSION } }),

    activeTab: () => {
      const { tabs, activeTabId } = get().doc
      return tabs.find((t) => t.id === activeTabId) ?? null
    },
    activeRequest: () => get().activeTab()?.request ?? null,

    setActive: (id) => commit({ activeTabId: id }),

    openSaved: (request, savedRequestId) => {
      const existing = get().doc.tabs.find((t) => t.savedRequestId === savedRequestId)
      if (existing) {
        commit({ activeTabId: existing.id })
        return
      }
      const tab: TabModel = { id: makeId('tab'), request: structuredClone(request), savedRequestId, dirty: false }
      commit({ tabs: [...get().doc.tabs, tab], activeTabId: tab.id })
    },

    openNew: (request) => {
      const tab: TabModel = {
        id: makeId('tab'),
        request: request ? structuredClone(request) : emptyRequest(),
        savedRequestId: null,
        dirty: !!request
      }
      commit({ tabs: [...get().doc.tabs, tab], activeTabId: tab.id })
      return tab.id
    },

    closeTab: (id) => {
      // Tear down any live WebSocket/SSE connection + drop volatile per-tab state
      // so closing a realtime tab doesn't leak a socket/IPC listener.
      useRealtime.getState().disconnect(id)
      useGrpc.getState().cancel(id)
      useResponse.setState((s) => {
        if (!(id in s.byTab)) return s
        const { [id]: _drop, ...rest } = s.byTab
        return { byTab: rest }
      })
      const prev = get().doc.tabs
      const idx = prev.findIndex((t) => t.id === id)
      const tabs = prev.filter((t) => t.id !== id)
      let activeTabId = get().doc.activeTabId
      if (activeTabId === id) {
        // Activate the neighbour: the tab that shifts into the closed slot, else
        // the one to its left — not always the last tab.
        activeTabId = tabs.length ? (tabs[idx] ?? tabs[idx - 1] ?? tabs[tabs.length - 1]).id : null
      }
      commit({ tabs, activeTabId })
    },

    patchActive: (patch) => {
      const id = get().doc.activeTabId
      if (id) get().patchTab(id, patch)
    },

    patchTab: (tabId, patch) => {
      const tabs = get().doc.tabs.map((t) =>
        t.id === tabId ? { ...t, request: { ...t.request, ...patch }, dirty: true } : t
      )
      commit({ tabs })
    },

    markSaved: (tabId, savedRequestId) => {
      const tabs = get().doc.tabs.map((t) => (t.id === tabId ? { ...t, savedRequestId, dirty: false } : t))
      commit({ tabs })
    }
  }
})

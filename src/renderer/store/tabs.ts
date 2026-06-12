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
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closeToLeft: (id: string) => void
  closeAll: () => void
  duplicateTab: (id: string) => void
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

  // Tear down any live WebSocket/SSE connection + drop volatile per-tab state
  // so closing a realtime tab doesn't leak a socket/IPC listener. Must run for
  // EVERY closed tab, including bulk closes (close others/right/left/all).
  const teardownTab = (id: string) => {
    useRealtime.getState().disconnect(id)
    useGrpc.getState().cancel(id)
    useResponse.setState((s) => {
      if (!(id in s.byTab)) return s
      const { [id]: _drop, ...rest } = s.byTab
      return { byTab: rest }
    })
  }

  // Shared bulk-close: tear down every dropped tab, keep the rest, and land the
  // active tab on the anchor when the previously-active tab was closed.
  const closeWhere = (anchorId: string, drop: (t: TabModel, idx: number) => boolean) => {
    const prev = get().doc.tabs
    if (!prev.some((t) => t.id === anchorId)) return
    const kept = prev.filter((t, i) => !drop(t, i))
    if (kept.length === prev.length) return
    prev.forEach((t, i) => {
      if (drop(t, i)) teardownTab(t.id)
    })
    let activeTabId = get().doc.activeTabId
    if (!kept.some((t) => t.id === activeTabId)) activeTabId = anchorId
    commit({ tabs: kept, activeTabId })
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
      teardownTab(id)
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

    closeOthers: (id) => closeWhere(id, (t) => t.id !== id),

    closeToRight: (id) => {
      const idx = get().doc.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return
      closeWhere(id, (_t, i) => i > idx)
    },

    closeToLeft: (id) => {
      const idx = get().doc.tabs.findIndex((t) => t.id === id)
      if (idx <= 0) return
      closeWhere(id, (_t, i) => i < idx)
    },

    closeAll: () => {
      for (const t of get().doc.tabs) teardownTab(t.id)
      commit({ tabs: [], activeTabId: null })
    },

    duplicateTab: (id) => {
      const prev = get().doc.tabs
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return
      const request = structuredClone(prev[idx].request)
      request.id = makeId('req')
      // Regenerate nested ids so the copy doesn't alias the original's items
      // (prefixes match the creators in lib/examples.ts / RealtimePanel.tsx).
      request.examples = request.examples?.map((ex) => ({ ...ex, id: makeId('ex') }))
      request.messageTemplates = request.messageTemplates?.map((t) => ({ ...t, id: makeId('mt') }))
      // The copy is an unsaved draft: not bound to a collection request, dirty.
      const tab: TabModel = { id: makeId('tab'), request, savedRequestId: null, dirty: true }
      commit({ tabs: [...prev.slice(0, idx + 1), tab, ...prev.slice(idx + 1)], activeTabId: tab.id })
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

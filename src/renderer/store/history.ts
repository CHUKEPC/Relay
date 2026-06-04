import { create } from 'zustand'
import type { HistoryDoc, HistoryEntry } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { emptyHistory } from './defaults'
import { persist } from './persist'

interface HistoryState {
  doc: HistoryDoc
  hydrate: (doc: HistoryDoc) => void
  add: (entry: HistoryEntry, maxHistory: number) => void
  clear: () => void
}

export const useHistory = create<HistoryState>((set, get) => ({
  doc: emptyHistory(),
  hydrate: (doc) => set({ doc: { ...doc, version: STORAGE_VERSION } }),
  add: (entry, maxHistory) => {
    // Respect maxHistory === 0 (history disabled) instead of forcing a floor of 1.
    const entries = [entry, ...get().doc.entries].slice(0, Math.max(0, maxHistory))
    const doc = { version: STORAGE_VERSION, entries }
    set({ doc })
    persist('history', doc)
  },
  clear: () => {
    const doc = { version: STORAGE_VERSION, entries: [] }
    set({ doc })
    persist('history', doc)
  }
}))

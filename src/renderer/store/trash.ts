import { create } from 'zustand'
import type { TrashDoc, TrashEntry } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { defaultTrash } from '@shared/defaults'
import { persist } from './persist'

/** Deleted items stay restorable this long, then they are gone for good. */
export const TRASH_RETENTION_DAYS = 30
const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
/** Oldest entries fall out past this many, so the document stays small. */
const MAX_ENTRIES = 300

interface TrashState {
  doc: TrashDoc
  hydrate: (doc: TrashDoc) => void
  /** Newest first. */
  add: (entry: TrashEntry) => void
  remove: (id: string) => void
  clear: () => void
}

/** Entries still within the retention window, newest first, capped. */
export function keepFresh(entries: TrashEntry[], now = Date.now()): TrashEntry[] {
  return entries
    .filter((e) => now - e.deletedAt < RETENTION_MS)
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_ENTRIES)
}

export const useTrash = create<TrashState>((set, get) => {
  const commit = (entries: TrashEntry[]) => {
    const doc = { version: STORAGE_VERSION, entries }
    set({ doc })
    persist('trash', doc)
  }

  return {
    doc: defaultTrash(),
    hydrate: (doc) => {
      const entries = keepFresh(Array.isArray(doc?.entries) ? doc.entries : [])
      set({ doc: { version: STORAGE_VERSION, entries } })
      // Expired entries are dropped on disk too, not only on screen.
      if (entries.length !== (doc?.entries?.length ?? 0)) persist('trash', { version: STORAGE_VERSION, entries })
    },
    add: (entry) => commit(keepFresh([entry, ...get().doc.entries])),
    remove: (id) => commit(get().doc.entries.filter((e) => e.id !== id)),
    clear: () => commit([])
  }
})

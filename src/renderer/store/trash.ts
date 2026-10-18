import { create } from 'zustand'
import type { TrashDoc, TrashEntry } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { defaultTrash } from '@shared/defaults'
import { persist } from './persist'
import { useSettings } from './settings'

/** Deleted items stay restorable this long unless the settings say otherwise. */
export const DEFAULT_TRASH_DAYS = 30
/** Periods offered in the settings, in days; 0 keeps items until the trash is emptied. */
export const TRASH_DAYS_CHOICES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 0] as const
const DAY_MS = 24 * 60 * 60 * 1000
/** Oldest entries fall out past this many, so the document stays small. */
const MAX_ENTRIES = 300

/** The retention period from the settings, in days; 0 = no time limit. */
export function trashRetentionDays(): number {
  const days = useSettings.getState().settings.trashRetentionDays
  return typeof days === 'number' && Number.isFinite(days) && days >= 0 ? Math.round(days) : DEFAULT_TRASH_DAYS
}

interface TrashState {
  doc: TrashDoc
  hydrate: (doc: TrashDoc) => void
  /** Newest first. */
  add: (entry: TrashEntry) => void
  remove: (id: string) => void
  clear: () => void
  /** Drop what has outlived the retention period now; returns how many went. */
  prune: () => number
}

/** Entries still within the retention period (0 = any age), newest first, capped. */
export function keepFresh(entries: TrashEntry[], now = Date.now(), days = trashRetentionDays()): TrashEntry[] {
  return entries
    .filter((e) => days === 0 || now - e.deletedAt < days * DAY_MS)
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
    clear: () => commit([]),
    prune: () => {
      const before = get().doc.entries
      const kept = keepFresh(before)
      if (kept.length !== before.length) commit(kept)
      return before.length - kept.length
    }
  }
})

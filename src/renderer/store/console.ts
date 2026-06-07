import { create } from 'zustand'
import { makeId } from '@shared/id'

/** Hard cap on retained log entries; oldest are dropped past this. */
const MAX_ENTRIES = 200

/** One sent request, captured for the request console (Postman-style log). */
export interface ConsoleEntry {
  id: string
  at: number
  method: string
  url: string
  status: number // 0 for a transport error (no response)
  ok: boolean
  timeMs: number
  sizeBytes: number
  requestHeaders: [string, string][]
  responseHeaders: [string, string][]
  requestBody?: string
  responseBody?: string
  error?: string
}

interface ConsoleState {
  entries: ConsoleEntry[]
  open: boolean
  /** Append a captured request; assigns id/at and caps to the last MAX_ENTRIES. */
  add: (e: Omit<ConsoleEntry, 'id' | 'at'>) => void
  clear: () => void
  setOpen: (v: boolean) => void
  toggle: () => void
}

export const useConsole = create<ConsoleState>((set) => ({
  entries: [],
  open: false,
  add: (e) =>
    set((s) => {
      const entry: ConsoleEntry = { ...e, id: makeId('log'), at: Date.now() }
      // Keep insertion order (oldest first); the panel renders newest-first.
      const next = [...s.entries, entry]
      return { entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next }
    }),
  clear: () => set({ entries: [] }),
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open }))
}))

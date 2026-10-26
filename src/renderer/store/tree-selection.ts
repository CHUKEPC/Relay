/**
 * The sidebar selection: which collections, folders and requests are ticked,
 * and which bulk dialog (duplicate / move) is open for them. Not persisted —
 * a selection belongs to the moment.
 */
import { create } from 'zustand'
import { useCollections } from './collections'
import { toggleTick } from '../lib/tree-select'
import type { CollectionNode } from '@shared/types'

export type BulkDialog = { kind: 'duplicate' | 'move'; ids: string[] } | null

interface TreeSelectionState {
  /** rows show checkboxes; a click on a row ticks it */
  active: boolean
  /** ticked ids; a ticked container covers what is inside it */
  ids: string[]
  dialog: BulkDialog
  setActive: (on: boolean) => void
  toggle: (id: string) => void
  setIds: (ids: string[]) => void
  clear: () => void
  openDialog: (kind: 'duplicate' | 'move', ids: string[]) => void
  closeDialog: () => void
}

const roots = (): CollectionNode[] => useCollections.getState().doc.collections

export const useTreeSelection = create<TreeSelectionState>((set, get) => ({
  active: false,
  ids: [],
  dialog: null,

  setActive: (on) => set(on ? { active: true } : { active: false, ids: [] }),
  toggle: (id) => set({ active: true, ids: toggleTick(roots(), get().ids, id) }),
  setIds: (ids) => set({ active: true, ids }),
  clear: () => set({ ids: [] }),
  openDialog: (kind, ids) => set({ dialog: { kind, ids } }),
  closeDialog: () => set({ dialog: null })
}))

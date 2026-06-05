import { create } from 'zustand'
import type { WorkspaceMeta } from '@shared/types'
import { flushPersistAndWait } from './persist'
import { reloadWorkspace } from './bootstrap'

interface WorkspacesState {
  workspaces: WorkspaceMeta[]
  activeId: string
  busy: boolean
  load: () => Promise<void>
  switchTo: (id: string) => Promise<void>
  create: (name: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  activeId: '',
  busy: false,

  load: async () => {
    const { workspaces, activeId } = await window.api.workspaceList()
    set({ workspaces, activeId })
  },

  switchTo: async (id) => {
    if (id === get().activeId || get().busy) return
    set({ busy: true })
    try {
      // Persist the outgoing workspace's edits, THEN re-point main, THEN reload.
      await flushPersistAndWait()
      await window.api.workspaceSwitch(id)
      set({ activeId: id })
      await reloadWorkspace()
    } finally {
      set({ busy: false })
    }
  },

  create: async (name) => {
    if (get().busy) return
    set({ busy: true })
    try {
      const meta = await window.api.workspaceCreate(name)
      await flushPersistAndWait()
      await window.api.workspaceSwitch(meta.id)
      await get().load()
      set({ activeId: meta.id })
      await reloadWorkspace()
    } finally {
      set({ busy: false })
    }
  },

  rename: async (id, name) => {
    await window.api.workspaceRename(id, name)
    await get().load()
  },

  remove: async (id) => {
    if (get().busy) return
    set({ busy: true })
    try {
      const wasActive = get().activeId === id
      await window.api.workspaceDelete(id)
      await get().load()
      // Main auto-switches to another workspace if the active one was deleted.
      if (wasActive) await reloadWorkspace()
    } finally {
      set({ busy: false })
    }
  }
}))

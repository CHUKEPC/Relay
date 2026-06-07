import { create } from 'zustand'

export type SideTab = 'collections' | 'history' | 'env'
export type SettingsSection = 'providers' | 'appearance' | 'general' | 'network' | 'shortcuts'
export type Layout = 'split-v' | 'split-h'

interface UiState {
  sideTab: SideTab
  sidebarCollapsed: boolean
  aiOpen: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection
  paletteOpen: boolean
  saveDialogOpen: boolean
  respPct: number
  layout: Layout
  toast: { id: number; message: string; kind: 'ok' | 'error' } | null
  setSideTab: (t: SideTab) => void
  toggleSidebar: () => void
  setAiOpen: (v: boolean) => void
  toggleAi: () => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  setPaletteOpen: (v: boolean) => void
  togglePalette: () => void
  setSaveDialogOpen: (v: boolean) => void
  setRespPct: (p: number) => void
  toggleLayout: () => void
  showToast: (message: string, kind?: 'ok' | 'error') => void
}

let toastSeq = 0

export const useUi = create<UiState>((set) => ({
  sideTab: 'collections',
  sidebarCollapsed: false,
  aiOpen: true,
  settingsOpen: false,
  settingsSection: 'providers',
  paletteOpen: false,
  saveDialogOpen: false,
  respPct: 46,
  layout: 'split-v',
  toast: null,
  setSideTab: (t) => set({ sideTab: t }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setAiOpen: (v) => set({ aiOpen: v }),
  toggleAi: () => set((s) => ({ aiOpen: !s.aiOpen })),
  openSettings: (section) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
  closeSettings: () => set({ settingsOpen: false }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setSaveDialogOpen: (v) => set({ saveDialogOpen: v }),
  setRespPct: (p) => set({ respPct: Math.max(18, Math.min(82, p)) }),
  toggleLayout: () => set((s) => ({ layout: s.layout === 'split-v' ? 'split-h' : 'split-v' })),
  showToast: (message, kind = 'ok') => {
    const id = ++toastSeq
    set({ toast: { id, message, kind } })
    window.setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : {}))
    }, 2400)
  }
}))

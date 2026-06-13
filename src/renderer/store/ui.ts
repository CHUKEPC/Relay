import { create } from 'zustand'
import { clamp } from '@renderer/lib/math'

export type SideTab = 'collections' | 'history' | 'env'
export type SettingsSection =
  | 'providers'
  | 'appearance'
  | 'plugins'
  | 'general'
  | 'network'
  | 'data'
  | 'shortcuts'
  | 'help'
  | 'about'
export type Layout = 'split-v' | 'split-h'
export type ConsoleDock = 'bottom' | 'left' | 'right' | 'float'

export interface ConsoleFloatRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PanesState {
  count: 1 | 2 | 3 | 4
  /** tab ids shown in panes 2..count; null = empty pane */
  extraTabIds: (string | null)[]
}

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
  sidebarWidth: number
  aiWidth: number
  consoleDock: ConsoleDock
  consoleSize: number
  consoleFloat: ConsoleFloatRect
  panes: PanesState
  importOpen: boolean
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
  setSidebarWidth: (px: number) => void
  setAiWidth: (px: number) => void
  setConsoleDock: (d: ConsoleDock) => void
  setConsoleSize: (px: number) => void
  setConsoleFloat: (rect: ConsoleFloatRect) => void
  setPaneCount: (c: 1 | 2 | 3 | 4) => void
  setPaneTab: (index: number, tabId: string | null) => void
  setImportOpen: (v: boolean) => void
}

let toastSeq = 0

/* ---------- persisted layout prefs (localStorage) ---------- */

const UI_PREFS_KEY = 'relay.uiPrefs'

interface UiPrefs {
  sidebarWidth: number
  aiWidth: number
  consoleDock: ConsoleDock
  consoleSize: number
  consoleFloat: ConsoleFloatRect
}

function loadUiPrefs(): Partial<UiPrefs> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveUiPrefs(s: UiState): void {
  if (typeof localStorage === 'undefined') return
  try {
    const prefs: UiPrefs = {
      sidebarWidth: s.sidebarWidth,
      aiWidth: s.aiWidth,
      consoleDock: s.consoleDock,
      consoleSize: s.consoleSize,
      consoleFloat: s.consoleFloat
    }
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // quota / privacy mode — layout prefs are non-critical
  }
}

const prefs = loadUiPrefs()
const DOCKS: ConsoleDock[] = ['bottom', 'left', 'right', 'float']

function initialFloat(): ConsoleFloatRect {
  const f = prefs.consoleFloat
  if (f && typeof f.x === 'number' && typeof f.y === 'number' && typeof f.w === 'number' && typeof f.h === 'number') {
    // Re-clamp persisted coords: a rect saved on a larger monitor (or corrupted
    // by hand) must not strand the window off-screen — keep the header grabbable
    // (same 120px/38px margins the float drag handler enforces).
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const w = clamp(f.w, 380, Math.max(380, vw))
    const h = clamp(f.h, 240, Math.max(240, vh))
    return {
      x: clamp(f.x, 120 - w, Math.max(0, vw - 120)),
      y: clamp(f.y, 0, Math.max(0, vh - 38)),
      w,
      h
    }
  }
  return { x: 80, y: 80, w: 720, h: 420 }
}

export const useUi = create<UiState>((set, get) => {
  // Debounced: drag handles call the setters on every mousemove — one trailing
  // localStorage write per drag is enough.
  let prefsTimer: ReturnType<typeof setTimeout> | null = null
  const persistPrefs = (): void => {
    if (prefsTimer) clearTimeout(prefsTimer)
    prefsTimer = setTimeout(() => {
      prefsTimer = null
      saveUiPrefs(get())
    }, 250)
  }
  return {
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
    sidebarWidth: typeof prefs.sidebarWidth === 'number' ? clamp(prefs.sidebarWidth, 200, 460) : 270,
    aiWidth: typeof prefs.aiWidth === 'number' ? clamp(prefs.aiWidth, 300, 640) : 384,
    consoleDock: prefs.consoleDock && DOCKS.includes(prefs.consoleDock) ? prefs.consoleDock : 'bottom',
    consoleSize: typeof prefs.consoleSize === 'number' ? clamp(prefs.consoleSize, 160, 800) : 340,
    consoleFloat: initialFloat(),
    panes: { count: 1, extraTabIds: [] },
    importOpen: false,
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
    },
    setSidebarWidth: (px) => {
      set({ sidebarWidth: clamp(px, 200, 460) })
      persistPrefs()
    },
    setAiWidth: (px) => {
      set({ aiWidth: clamp(px, 300, 640) })
      persistPrefs()
    },
    setConsoleDock: (d) => {
      set({ consoleDock: d })
      persistPrefs()
    },
    setConsoleSize: (px) => {
      set({ consoleSize: clamp(px, 160, 800) })
      persistPrefs()
    },
    setConsoleFloat: (rect) => {
      set({ consoleFloat: rect })
      persistPrefs()
    },
    setPaneCount: (c) =>
      set((s) => {
        // Keep existing assignments, pad with null up to c-1 extra panes, truncate when shrinking.
        const extra = s.panes.extraTabIds.slice(0, c - 1)
        while (extra.length < c - 1) extra.push(null)
        return { panes: { count: c, extraTabIds: extra } }
      }),
    setPaneTab: (index, tabId) => {
      // Guard against out-of-range slots (panes 2..count map to indices 0..count-2);
      // a stray index would create a sparse array inconsistent with `count`.
      if (index < 0 || index >= get().panes.count - 1) return
      set((s) => {
        const extra = s.panes.extraTabIds.slice()
        extra[index] = tabId
        return { panes: { ...s.panes, extraTabIds: extra } }
      })
    },
    setImportOpen: (v) => set({ importOpen: v })
  }
})

import { create } from 'zustand'
import { STORAGE_VERSION } from '@shared/constants'
import { parseThemeFile, type PackTheme, type UserThemesDoc } from '@shared/pack-data'
import { persist } from './persist'

/** Keeping the list short keeps the Appearance section readable. */
const MAX_THEMES = 60

interface UserThemesState {
  themes: PackTheme[]
  hydrate: (doc: UserThemesDoc | null) => void
  /**
   * Add every valid theme from a file's text. Returns what happened so the UI
   * can say it plainly: how many were added, how many replaced a theme with the
   * same id, and why nothing was added when that is the case.
   */
  addFromText: (text: string, fallbackName: string) => { added: number; replaced: number; error?: string }
  remove: (id: string) => void
}

function save(themes: PackTheme[]): void {
  persist('userThemes', { version: STORAGE_VERSION, themes })
}

export const useUserThemes = create<UserThemesState>((set, get) => ({
  themes: [],

  hydrate: (doc) => set({ themes: doc?.themes ?? [] }),

  addFromText: (text, fallbackName) => {
    const { themes: incoming, error } = parseThemeFile(text, fallbackName)
    if (error) return { added: 0, replaced: 0, error }

    const current = get().themes
    const byId = new Map(current.map((t) => [t.id, t]))
    let added = 0
    let replaced = 0
    for (const theme of incoming) {
      if (byId.has(theme.id)) replaced++
      else added++
      byId.set(theme.id, theme)
    }
    const themes = [...byId.values()].slice(0, MAX_THEMES)
    set({ themes })
    save(themes)
    return { added, replaced }
  },

  remove: (id) => {
    const themes = get().themes.filter((t) => t.id !== id)
    set({ themes })
    save(themes)
  }
}))

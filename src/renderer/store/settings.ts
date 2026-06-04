import { create } from 'zustand'
import type { SettingsDoc } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { defaultSettingsDoc } from './defaults'
import { persist } from './persist'

type ThemeChoice = SettingsDoc['theme']

interface SettingsState {
  settings: SettingsDoc
  resolvedTheme: 'light' | 'dark'
  hydrate: (doc: SettingsDoc) => void
  setTheme: (theme: ThemeChoice) => void
  setAccentHue: (hue: number) => void
  update: (patch: Partial<SettingsDoc>) => void
}

function systemPrefersDark(): boolean {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

function applyTheme(choice: ThemeChoice, accentHue: number): 'light' | 'dark' {
  const resolved = resolveTheme(choice)
  document.documentElement.setAttribute('data-theme', resolved)
  document.body.classList.add('theming')
  window.setTimeout(() => document.body.classList.remove('theming'), 400)
  applyAccent(accentHue)
  return resolved
}

function applyAccent(hue: number): void {
  const root = document.documentElement.style
  root.setProperty('--accent', `oklch(0.62 0.19 ${hue})`)
  root.setProperty('--accent-hover', `oklch(0.66 0.19 ${hue})`)
  root.setProperty('--accent-press', `oklch(0.57 0.19 ${hue})`)
  root.setProperty('--accent-soft', `oklch(0.62 0.19 ${hue} / 0.12)`)
  root.setProperty('--accent-soft-2', `oklch(0.62 0.19 ${hue} / 0.18)`)
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettingsDoc(),
  resolvedTheme: 'dark',

  hydrate: (doc) => {
    const resolved = applyTheme(doc.theme, doc.accentHue)
    set({ settings: { ...doc, version: STORAGE_VERSION }, resolvedTheme: resolved })
  },

  setTheme: (theme) => {
    const settings = { ...get().settings, theme }
    const resolved = applyTheme(theme, settings.accentHue)
    set({ settings, resolvedTheme: resolved })
    persist('settings', settings)
  },

  setAccentHue: (hue) => {
    const settings = { ...get().settings, accentHue: hue }
    applyAccent(hue)
    set({ settings })
    persist('settings', settings)
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    if (patch.theme || patch.accentHue != null) {
      const resolved = applyTheme(settings.theme, settings.accentHue)
      set({ resolvedTheme: resolved })
    }
    persist('settings', settings)
  }
}))

/** Re-apply theme when the OS theme changes and we're in 'system' mode. */
export function watchSystemTheme(): void {
  window.api.onNativeThemeChange(() => {
    const { settings, hydrate } = useSettings.getState()
    if (settings.theme === 'system') hydrate(settings)
  })
}

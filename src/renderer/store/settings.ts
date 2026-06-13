import { create } from 'zustand'
import type { CustomTheme, SettingsDoc, ThemePreset } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { defaultSettingsDoc } from './defaults'
import { persist } from './persist'
import '@renderer/styles/feat-themes.css'

type ThemeChoice = SettingsDoc['theme']

interface SettingsState {
  settings: SettingsDoc
  resolvedTheme: 'light' | 'dark'
  hydrate: (doc: SettingsDoc) => void
  setTheme: (theme: ThemeChoice) => void
  setAccentHue: (hue: number) => void
  setAccentColor: (hex: string | null) => void
  setThemePreset: (preset: ThemePreset) => void
  setCustomTheme: (theme: CustomTheme | null) => void
  update: (patch: Partial<SettingsDoc>) => void
}

function systemPrefersDark(): boolean {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

function applyAccentHue(hue: number): void {
  const root = document.documentElement.style
  root.setProperty('--accent', `oklch(0.62 0.19 ${hue})`)
  root.setProperty('--accent-hover', `oklch(0.66 0.19 ${hue})`)
  root.setProperty('--accent-press', `oklch(0.57 0.19 ${hue})`)
  root.setProperty('--accent-soft', `oklch(0.62 0.19 ${hue} / 0.12)`)
  root.setProperty('--accent-soft-2', `oklch(0.62 0.19 ${hue} / 0.18)`)
}

function applyAccentColor(hex: string): void {
  const root = document.documentElement.style
  root.setProperty('--accent', hex)
  root.setProperty('--accent-hover', `color-mix(in oklab, ${hex}, white 10%)`)
  root.setProperty('--accent-press', `color-mix(in oklab, ${hex}, black 10%)`)
  root.setProperty('--accent-soft', `color-mix(in oklab, ${hex} 12%, transparent)`)
  root.setProperty('--accent-soft-2', `color-mix(in oklab, ${hex} 18%, transparent)`)
}

/* Inline custom-theme vars we set on <html>, tracked so switching away
 * from the 'custom' preset removes every override we added. */
let appliedCustomKeys: string[] = []

function clearCustomVars(): void {
  const root = document.documentElement.style
  for (const key of appliedCustomKeys) root.removeProperty(key)
  appliedCustomKeys = []
}

function applyCustomVars(vars: Record<string, string>): void {
  clearCustomVars()
  const root = document.documentElement.style
  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('--') || !value) continue
    root.setProperty(key, value)
    appliedCustomKeys.push(key)
  }
}

/** Apply the full appearance (theme base, preset attr, accent, custom vars). */
function applyAppearance(doc: SettingsDoc): 'light' | 'dark' {
  const custom = doc.themePreset === 'custom' ? doc.customTheme : null
  const resolved = custom ? custom.base : resolveTheme(doc.theme)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  if (doc.themePreset === 'relay') root.removeAttribute('data-preset')
  else root.setAttribute('data-preset', doc.themePreset)
  // Accent first, custom vars LAST: a custom theme (e.g. a plugin theme) that
  // defines --accent* must win over the derived accent, not be clobbered by it.
  if (doc.accentColor) applyAccentColor(doc.accentColor)
  else applyAccentHue(doc.accentHue)
  if (custom) applyCustomVars(custom.vars)
  else clearCustomVars()
  document.body.classList.add('theming')
  window.setTimeout(() => document.body.classList.remove('theming'), 400)
  return resolved
}

/** Built-in preset accents; 'relay' returns to the hue-derived accent. */
const PRESET_ACCENT: Partial<Record<ThemePreset, string | null>> = {
  relay: null,
  postman: '#ff6c37',
  insomnia: '#7400e1'
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettingsDoc(),
  resolvedTheme: 'dark',

  hydrate: (doc) => {
    // Merge over defaults so a settings.json from an older version that lacks newer
    // keys doesn't yield `undefined` (which flips controlled inputs to uncontrolled).
    const merged = { ...defaultSettingsDoc(), ...doc, version: STORAGE_VERSION }
    const resolved = applyAppearance(merged)
    set({ settings: merged, resolvedTheme: resolved })
  },

  setTheme: (theme) => {
    const settings = { ...get().settings, theme }
    const resolved = applyAppearance(settings)
    set({ settings, resolvedTheme: resolved })
    persist('settings', settings)
  },

  setAccentHue: (hue) => {
    // Picking a hue swatch always clears the custom RGB accent so the two stay consistent.
    const settings = { ...get().settings, accentHue: hue, accentColor: null }
    applyAccentHue(hue)
    set({ settings })
    persist('settings', settings)
  },

  setAccentColor: (hex) => {
    const settings = { ...get().settings, accentColor: hex }
    if (hex) applyAccentColor(hex)
    else applyAccentHue(settings.accentHue)
    set({ settings })
    persist('settings', settings)
  },

  setThemePreset: (preset) => {
    const settings = { ...get().settings, themePreset: preset }
    if (preset in PRESET_ACCENT) settings.accentColor = PRESET_ACCENT[preset] ?? null
    const resolved = applyAppearance(settings)
    set({ settings, resolvedTheme: resolved })
    persist('settings', settings)
  },

  setCustomTheme: (theme) => {
    const settings = { ...get().settings, customTheme: theme }
    const resolved = applyAppearance(settings)
    set({ settings, resolvedTheme: resolved })
    persist('settings', settings)
  },

  update: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    if (
      patch.theme ||
      patch.accentHue != null ||
      patch.accentColor !== undefined ||
      patch.themePreset ||
      patch.customTheme !== undefined
    ) {
      const resolved = applyAppearance(settings)
      set({ resolvedTheme: resolved })
    }
    persist('settings', settings)
  }
}))

/** Re-apply theme when the OS theme changes and we're in 'system' mode. */
let unwatchTheme: (() => void) | null = null
export function watchSystemTheme(): () => void {
  // Drop any previous listener so repeated calls (HMR / re-bootstrap) don't stack.
  if (unwatchTheme) unwatchTheme()
  unwatchTheme = window.api.onNativeThemeChange(() => {
    const { settings, hydrate } = useSettings.getState()
    if (settings.theme === 'system') hydrate(settings)
  })
  return unwatchTheme
}

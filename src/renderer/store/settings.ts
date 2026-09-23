import { create } from 'zustand'
import type { CustomTheme, SettingsDoc, ThemePreset } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { themeVariant, USER_THEME_PACK, type PackTheme } from '@shared/pack-data'
import { defaultSettingsDoc } from './defaults'
import { persist } from './persist'
import { onPackThemes } from './features'
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
  /** Use a theme from an enabled theme pack. */
  setPackTheme: (theme: PackTheme) => void
  setCustomTheme: (theme: CustomTheme | null) => void
  update: (patch: Partial<SettingsDoc>) => void
}

/**
 * Low-power mode is a whole-document switch: the stylesheet keys off this
 * attribute, and so does the editor (plain instead of Monaco). It is applied
 * once at hydrate — flipping the setting only takes effect after a restart,
 * because the GPU decision is made before the window exists.
 */
function applyLowPower(on: boolean): void {
  document.documentElement.toggleAttribute('data-low-power', on)
}

/** True when this window started in low-power mode. */
export function lowPowerActive(): boolean {
  return document.documentElement.hasAttribute('data-low-power')
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

/** Palette of the selected pack theme for the current UI mode, if one is selected. */
function packPalette(doc: SettingsDoc): { mode: 'light' | 'dark'; vars: Record<string, string> } | null {
  if (doc.themePreset !== 'pack' || !doc.packThemeData) return null
  return themeVariant(doc.packThemeData, resolveTheme(doc.theme))
}

/** Apply the full appearance (theme base, preset attr, accent, custom vars). */
function applyAppearance(doc: SettingsDoc): 'light' | 'dark' {
  const custom = doc.themePreset === 'custom' ? doc.customTheme : null
  const pack = custom ? null : packPalette(doc)
  // A pack theme without a variant for the chosen mode keeps its own base.
  const resolved = custom ? custom.base : pack ? pack.mode : resolveTheme(doc.theme)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  // 'postman' / 'insomnia' are pre-1.2 values; their palettes now come from the
  // theme pack, so they render as the Relay look until migrated.
  if (doc.themePreset === 'custom' || (doc.themePreset === 'pack' && pack)) root.setAttribute('data-preset', doc.themePreset)
  else root.removeAttribute('data-preset')
  // Accent first, custom vars LAST: a custom theme (e.g. a plugin theme) that
  // defines --accent* must win over the derived accent, not be clobbered by it.
  if (doc.accentColor) applyAccentColor(doc.accentColor)
  else applyAccentHue(doc.accentHue)
  if (custom) applyCustomVars(custom.vars)
  else if (pack) applyCustomVars(pack.vars)
  else clearCustomVars()
  document.body.classList.add('theming')
  window.setTimeout(() => document.body.classList.remove('theming'), 400)
  // Code editors re-derive their colours from the tokens just applied.
  window.dispatchEvent(new Event('relay:appearance'))
  return resolved
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettingsDoc(),
  resolvedTheme: 'dark',

  hydrate: (doc) => {
    // Merge over defaults so a settings.json from an older version that lacks newer
    // keys doesn't yield `undefined` (which flips controlled inputs to uncontrolled).
    const merged = { ...defaultSettingsDoc(), ...doc, version: STORAGE_VERSION }
    // 1.2 called it «Экономить видеопамять»; 1.3 turns that into low-power mode.
    if (doc.lowPowerMode === undefined && doc.disableHardwareAcceleration === true) merged.lowPowerMode = true
    delete merged.disableHardwareAcceleration
    applyLowPower(merged.lowPowerMode)
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
    // Back to the Relay look also means back to its hue-derived accent.
    if (preset === 'relay') settings.accentColor = null
    const resolved = applyAppearance(settings)
    set({ settings, resolvedTheme: resolved })
    persist('settings', settings)
  },

  setPackTheme: (theme) => {
    const settings: SettingsDoc = {
      ...get().settings,
      themePreset: 'pack',
      packTheme: theme.id,
      packThemeData: theme,
      accentColor: theme.accent ?? null
    }
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
      patch.customTheme !== undefined ||
      patch.packThemeData !== undefined
    ) {
      const resolved = applyAppearance(settings)
      set({ resolvedTheme: resolved })
    }
    persist('settings', settings)
  }
}))

/**
 * Keep a pack theme in step with its pack: refresh the stored copy when the
 * pack file changed, and fall back to the Relay look when the pack (or the
 * theme in it) is gone — a switched-off pack must leave no trace.
 */
onPackThemes((themes) => {
  const { settings } = useSettings.getState()
  if (settings.themePreset !== 'pack') return
  // A theme the user loaded from a file lives in its own store and is not
  // affected by which packs are enabled.
  if (settings.packTheme?.startsWith(`${USER_THEME_PACK}/`)) return
  const theme = themes.find((t) => t.id === settings.packTheme)
  if (!theme) {
    useSettings.getState().update({ themePreset: 'relay', packTheme: null, packThemeData: null, accentColor: null })
    return
  }
  if (JSON.stringify(theme) !== JSON.stringify(settings.packThemeData)) {
    useSettings.getState().update({ packThemeData: theme })
  }
})

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

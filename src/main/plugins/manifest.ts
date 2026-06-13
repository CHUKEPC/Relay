/**
 * Pure `plugin.json` validation — no Electron/fs concerns so it stays
 * unit-testable. Validation is strict and fail-closed: anything off-spec yields
 * an error string and the plugin can never be enabled (docs/PLUGINS.md §3.1).
 */
import { PLUGIN_API_VERSION } from '@shared/types'
import type {
  PluginButtonContribution,
  PluginCommandContribution,
  PluginConfigField,
  PluginEventName,
  PluginManifest,
  PluginPanelContribution,
  PluginPermission,
  PluginThemeContribution
} from '@shared/types'

export const MANIFEST_FILE = 'plugin.json'
export const MANIFEST_MAX_BYTES = 64 * 1024
export const MAIN_MAX_BYTES = 512 * 1024

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]{1,40})?$/
/** plain file name, no path separators (and the regex admits no `/` or `\`) */
const MAIN_RE = /^[a-zA-Z0-9][\w.-]{0,80}\.js$/
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]{0,253})(:\d{1,5})?$/i

const BUTTON_LOCATIONS = new Set(['response-toolbar', 'titlebar', 'sidebar'])
const PANEL_LOCATIONS = new Set(['response-tab'])
const EVENT_NAMES = new Set(['response', 'request', 'workspace', 'collection'])
/** 'string' lives in the plugins doc; 'secret' is safeStorage-backed. */
const CONFIG_TYPES = new Set(['string', 'secret'])

/**
 * Allowlist grammar for plugin theme CSS values. Theme vars feed
 * `style.setProperty` in the renderer, so an arbitrary value could smuggle
 * `url(...)` beacons or spoof chrome the moment a component renders. Only
 * color-shaped and simple numeric values pass; everything else is dropped.
 */
const CSS_HEX_RE = /^#[0-9a-f]{3,8}$/i
const CSS_COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(\s*[\d.,%\s/+-]*\)$/i
const CSS_KEYWORD_RE = /^[a-z][a-z-]{0,30}$/i
const CSS_LENGTH_RE = /^-?\d+(\.\d+)?(px|rem|em|%)?$/

export function isSafeCssValue(value: string): boolean {
  const s = value.trim()
  if (!s || s.length > 200) return false
  return CSS_HEX_RE.test(s) || CSS_COLOR_FN_RE.test(s) || CSS_KEYWORD_RE.test(s) || CSS_LENGTH_RE.test(s)
}

const MAX_BUTTONS = 10
const MAX_PANELS = 10
const MAX_COMMANDS = 20
const MAX_THEMES = 10
const MAX_THEME_VARS = 60
const MAX_CONFIG_FIELDS = 20
const MAX_PERMISSIONS = 30
const MAX_I18N_LOCALES = 10
const MAX_I18N_KEYS = 200

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > max) return null
  return s
}

function optString(v: unknown, max: number): string | undefined {
  if (v === undefined) return undefined
  return asString(v, max) ?? undefined
}

const SIMPLE_PERMISSIONS = new Set([
  'net',
  'request:read',
  'response:read',
  'request:write',
  'storage',
  'clipboard',
  'history:read'
])

export function isValidPermission(p: unknown): p is PluginPermission {
  if (typeof p !== 'string') return false
  if (SIMPLE_PERMISSIONS.has(p)) return true
  if (p.startsWith('net:')) {
    const host = p.slice('net:'.length)
    return host.length > 0 && host.length <= 260 && HOST_RE.test(host)
  }
  return false
}

/** A user-supplied net host pattern for the per-host grant editor / allowlist. */
export function isValidNetHost(host: unknown): boolean {
  return typeof host === 'string' && host.length > 0 && host.length <= 260 && HOST_RE.test(host)
}

function parseButtons(v: unknown): PluginButtonContribution[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'contributes.buttons must be an array'
  if (v.length > MAX_BUTTONS) return `too many buttons (max ${MAX_BUTTONS})`
  const out: PluginButtonContribution[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!isRecord(raw)) return 'each button must be an object'
    const id = asString(raw.id, 64)
    const label = asString(raw.label, 40)
    const location = asString(raw.location, 40)
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return 'button id must be a lowercase slug'
    if (seen.has(id)) return `duplicate button id "${id}"`
    seen.add(id)
    if (!label) return `button "${id}" needs a label (≤ 40 chars)`
    if (!location || !BUTTON_LOCATIONS.has(location)) {
      return `button "${id}" has unknown location (supported: ${[...BUTTON_LOCATIONS].join(', ')})`
    }
    out.push({
      id,
      label,
      location: location as PluginButtonContribution['location'],
      icon: optString(raw.icon, 40),
      tooltip: optString(raw.tooltip, 200)
    })
  }
  return out
}

function parsePanels(v: unknown): PluginPanelContribution[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'contributes.panels must be an array'
  if (v.length > MAX_PANELS) return `too many panels (max ${MAX_PANELS})`
  const out: PluginPanelContribution[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!isRecord(raw)) return 'each panel must be an object'
    const id = asString(raw.id, 64)
    const label = asString(raw.label, 40)
    const location = asString(raw.location, 40)
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return 'panel id must be a lowercase slug'
    if (seen.has(id)) return `duplicate panel id "${id}"`
    seen.add(id)
    if (!label) return `panel "${id}" needs a label (≤ 40 chars)`
    if (!location || !PANEL_LOCATIONS.has(location)) {
      return `panel "${id}" has unknown location (supported: ${[...PANEL_LOCATIONS].join(', ')})`
    }
    out.push({
      id,
      label,
      location: location as PluginPanelContribution['location'],
      icon: optString(raw.icon, 40),
      interactive: raw.interactive === true
    })
  }
  return out
}

function parseCommands(v: unknown): PluginCommandContribution[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'contributes.commands must be an array'
  if (v.length > MAX_COMMANDS) return `too many commands (max ${MAX_COMMANDS})`
  const out: PluginCommandContribution[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!isRecord(raw)) return 'each command must be an object'
    const id = asString(raw.id, 64)
    const title = asString(raw.title, 80)
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return 'command id must be a lowercase slug'
    if (seen.has(id)) return `duplicate command id "${id}"`
    seen.add(id)
    if (!title) return `command "${id}" needs a title (≤ 80 chars)`
    out.push({ id, title, icon: optString(raw.icon, 40) })
  }
  return out
}

function parseI18n(v: unknown): Record<string, Record<string, string>> | string | undefined {
  if (v === undefined) return undefined
  if (!isRecord(v)) return 'i18n must be an object of { locale: { key: value } }'
  if (Object.keys(v).length > MAX_I18N_LOCALES) return `too many i18n locales (max ${MAX_I18N_LOCALES})`
  const out: Record<string, Record<string, string>> = {}
  for (const [locale, table] of Object.entries(v)) {
    if (!/^[a-z]{2}(-[a-z]{2})?$/i.test(locale) || !isRecord(table)) continue
    const entries = Object.entries(table).slice(0, MAX_I18N_KEYS)
    const clean: Record<string, string> = {}
    for (const [k, val] of entries) {
      if (typeof val === 'string' && val.length <= 500) clean[k] = val
    }
    out[locale.toLowerCase()] = clean
  }
  return out
}

function parseThemes(v: unknown): PluginThemeContribution[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'contributes.themes must be an array'
  if (v.length > MAX_THEMES) return `too many themes (max ${MAX_THEMES})`
  const out: PluginThemeContribution[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!isRecord(raw)) return 'each theme must be an object'
    const id = asString(raw.id, 64)
    const label = asString(raw.label, 40)
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return 'theme id must be a lowercase slug'
    if (seen.has(id)) return `duplicate theme id "${id}"`
    seen.add(id)
    if (!label) return `theme "${id}" needs a label (≤ 40 chars)`
    if (raw.base !== 'light' && raw.base !== 'dark') return `theme "${id}" base must be 'light' or 'dark'`
    if (!isRecord(raw.vars)) return `theme "${id}" needs a vars object`
    const entries = Object.entries(raw.vars)
    if (entries.length > MAX_THEME_VARS) return `theme "${id}" has too many vars (max ${MAX_THEME_VARS})`
    const vars: Record<string, string> = {}
    for (const [key, value] of entries) {
      // Same key rule as the manual custom-theme editor ('--' custom properties
      // only) PLUS a value allowlist: untrusted values must look like colors or
      // plain numbers, never url()/expressions (CSS exfiltration / UI spoofing).
      if (!key.startsWith('--') || key.length > 64) continue
      if (typeof value !== 'string' || !isSafeCssValue(value)) continue
      vars[key] = value.trim()
    }
    out.push({ id, label, base: raw.base, vars })
  }
  return out
}

function parseEvents(v: unknown): PluginEventName[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'contributes.events must be an array'
  const out = new Set<PluginEventName>()
  for (const raw of v) {
    if (typeof raw !== 'string' || !EVENT_NAMES.has(raw)) {
      return `unknown event "${String(raw)}" (supported: ${[...EVENT_NAMES].join(', ')})`
    }
    out.add(raw as PluginEventName)
  }
  return [...out]
}

function parseConfig(v: unknown): PluginConfigField[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'config must be an array'
  if (v.length > MAX_CONFIG_FIELDS) return `too many config fields (max ${MAX_CONFIG_FIELDS})`
  const out: PluginConfigField[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!isRecord(raw)) return 'each config field must be an object'
    const key = asString(raw.key, 64)
    const label = asString(raw.label, 60)
    if (!key || !/^[a-zA-Z][\w-]{0,63}$/.test(key)) return 'config key must be an identifier'
    if (seen.has(key)) return `duplicate config key "${key}"`
    seen.add(key)
    if (!label) return `config "${key}" needs a label (≤ 60 chars)`
    const type = raw.type === undefined ? 'string' : raw.type
    if (typeof type !== 'string' || !CONFIG_TYPES.has(type)) return `config "${key}" has unknown type`
    out.push({
      key,
      label,
      type: type as PluginConfigField['type'],
      placeholder: optString(raw.placeholder, 200),
      description: optString(raw.description, 300)
    })
  }
  return out
}

/**
 * Parse + validate a raw plugin.json. `folderName` must equal the manifest id —
 * that binding is what prevents one plugin from impersonating another.
 */
export function parseManifest(raw: string, folderName: string): ManifestResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err) {
    return { ok: false, error: `plugin.json is not valid JSON: ${(err as Error).message}` }
  }
  if (!isRecord(data)) return { ok: false, error: 'plugin.json must be a JSON object' }

  const id = asString(data.id, 64)
  if (!id || !ID_RE.test(id)) return { ok: false, error: 'id must match ^[a-z0-9][a-z0-9-]{1,63}$' }
  if (id !== folderName) {
    return { ok: false, error: `id "${id}" must equal the plugin folder name "${folderName}"` }
  }

  const name = asString(data.name, 100)
  if (!name) return { ok: false, error: 'name is required (≤ 100 chars)' }

  const version = asString(data.version, 60)
  if (!version || !VERSION_RE.test(version)) return { ok: false, error: 'version must be x.y.z' }

  let apiVersion = 1
  if (data.apiVersion !== undefined) {
    if (typeof data.apiVersion !== 'number' || !Number.isInteger(data.apiVersion) || data.apiVersion < 1) {
      return { ok: false, error: 'apiVersion must be a positive integer' }
    }
    if (data.apiVersion > PLUGIN_API_VERSION) {
      return { ok: false, error: `apiVersion ${data.apiVersion} is newer than this app supports (${PLUGIN_API_VERSION}) — update Relay` }
    }
    apiVersion = data.apiVersion
  }

  let main: string | undefined
  if (data.main !== undefined) {
    const m = asString(data.main, 90)
    if (!m || !MAIN_RE.test(m) || m.includes('..')) {
      return { ok: false, error: 'main must be a plain .js file name inside the plugin folder' }
    }
    main = m
  }

  const permissions: PluginPermission[] = []
  if (data.permissions !== undefined) {
    if (!Array.isArray(data.permissions)) return { ok: false, error: 'permissions must be an array' }
    if (data.permissions.length > MAX_PERMISSIONS) {
      return { ok: false, error: `too many permissions (max ${MAX_PERMISSIONS})` }
    }
    for (const p of data.permissions) {
      if (!isValidPermission(p)) return { ok: false, error: `unknown permission "${String(p)}"` }
      if (!permissions.includes(p)) permissions.push(p)
    }
  }

  const contributesRaw = data.contributes === undefined ? {} : data.contributes
  if (!isRecord(contributesRaw)) return { ok: false, error: 'contributes must be an object' }
  const buttons = parseButtons(contributesRaw.buttons)
  if (typeof buttons === 'string') return { ok: false, error: buttons }
  const panels = parsePanels(contributesRaw.panels)
  if (typeof panels === 'string') return { ok: false, error: panels }
  const commands = parseCommands(contributesRaw.commands)
  if (typeof commands === 'string') return { ok: false, error: commands }
  const themes = parseThemes(contributesRaw.themes)
  if (typeof themes === 'string') return { ok: false, error: themes }
  const events = parseEvents(contributesRaw.events)
  if (typeof events === 'string') return { ok: false, error: events }

  const config = parseConfig(data.config)
  if (typeof config === 'string') return { ok: false, error: config }

  const i18n = parseI18n(data.i18n)
  if (typeof i18n === 'string') return { ok: false, error: i18n }

  // A `request`-event handler that mutates the request needs request:write.
  if (events.includes('request') && !permissions.includes('request:write')) {
    return { ok: false, error: "the 'request' event requires the 'request:write' permission" }
  }

  const manifest: PluginManifest = {
    id,
    name,
    version,
    apiVersion,
    description: optString(data.description, 500),
    author: optString(data.author, 100),
    main,
    permissions,
    contributes: { buttons, panels, commands, themes, events },
    config,
    i18n
  }
  // Resolve %key% label placeholders against the chosen locale (default 'ru').
  return { ok: true, manifest: localizeManifest(manifest, DEFAULT_LOCALE) }
}

/** App display locale used to resolve plugin `%key%` label placeholders. */
export const DEFAULT_LOCALE = 'ru'

/** Replace `%key%`-style placeholders in user-facing labels with the i18n value
 *  for `locale` (falling back to the placeholder text). Pure + idempotent. */
export function localizeManifest(m: PluginManifest, locale: string): PluginManifest {
  const table = m.i18n?.[locale.toLowerCase()] ?? m.i18n?.[locale.slice(0, 2).toLowerCase()]
  if (!table) return m
  const t = (s: string | undefined): string | undefined => {
    if (!s) return s
    const match = /^%([\w.-]+)%$/.exec(s)
    return match && table[match[1]] !== undefined ? table[match[1]] : s
  }
  return {
    ...m,
    description: t(m.description),
    contributes: {
      ...m.contributes,
      buttons: m.contributes.buttons?.map((b) => ({ ...b, label: t(b.label) ?? b.label, tooltip: t(b.tooltip) })),
      panels: m.contributes.panels?.map((p) => ({ ...p, label: t(p.label) ?? p.label })),
      commands: m.contributes.commands?.map((c) => ({ ...c, title: t(c.title) ?? c.title })),
      themes: m.contributes.themes?.map((th) => ({ ...th, label: t(th.label) ?? th.label }))
    },
    config: m.config.map((f) => ({ ...f, label: t(f.label) ?? f.label, description: t(f.description) }))
  }
}

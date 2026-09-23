/**
 * Data files carried by feature packs (`plugins/<id>/…`).
 *
 * A pack stays declarative: besides `plugin.json` it may ship plain JSON that
 * the app reads and validates — script snippets (`snippets.json`, capability
 * `snippets`) and colour themes (`themes.json`, capability `themes.extra`).
 * Nothing in these files is executed. Theme values end up in
 * `style.setProperty`, so they go through the same colour/number allowlist as
 * user-plugin themes: anything shaped like `url(...)` is dropped.
 *
 * Pure module — no Node/DOM — shared by the main-process reader and tests.
 */

export type SnippetPhase = 'pre' | 'test' | 'both'

export interface PackSnippet {
  id: string
  label: string
  /** which script the snippet belongs to; 'both' shows in either editor */
  phase: SnippetPhase
  code: string
  /** optional group heading in the snippets panel */
  group?: string
}

export type ThemeMode = 'dark' | 'light'

export interface PackTheme {
  /** `<packId>/<themeId>` — unique across packs */
  id: string
  name: string
  description?: string
  /** accent colour; drives the derived --accent-* tokens */
  accent?: string
  /** CSS custom properties per UI mode; at least one mode is present */
  variants: Partial<Record<ThemeMode, Record<string, string>>>
}

/**
 * Themes the user loaded from a file themselves (Settings → Appearance →
 * «Мои темы»). Same shape a theme pack ships, stored app-level so every
 * workspace sees them; their ids are prefixed with `user/`.
 */
export interface UserThemesDoc {
  version: number
  themes: PackTheme[]
}

/** Id prefix of a theme loaded from a file rather than from a pack. */
export const USER_THEME_PACK = 'user'

export const SNIPPETS_FILE = 'snippets.json'
export const THEMES_FILE = 'themes.json'
export const PACK_DATA_MAX_BYTES = 1024 * 1024

const MAX_SNIPPETS = 300
const MAX_SNIPPET_CODE = 20_000
const MAX_THEMES = 40
const MAX_THEME_VARS = 80
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const CSS_HEX_RE = /^#[0-9a-f]{3,8}$/i
const CSS_COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(\s*[\d.,%\s/+-]*\)$/i
const CSS_KEYWORD_RE = /^[a-z][a-z-]{0,30}$/i
const CSS_LENGTH_RE = /^-?\d+(\.\d+)?(px|rem|em|%)?$/

/**
 * Theme values are applied with `style.setProperty`, so an arbitrary value
 * could smuggle `url(...)` beacons or spoof chrome. Only colour-shaped and
 * simple numeric values pass.
 */
export function isSafeCssValue(value: string): boolean {
  const s = value.trim()
  if (!s || s.length > 200) return false
  return CSS_HEX_RE.test(s) || CSS_COLOR_FN_RE.test(s) || CSS_KEYWORD_RE.test(s) || CSS_LENGTH_RE.test(s)
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v : null)

/** Accepts `[...]` or `{ "snippets": [...] }`; invalid entries are skipped, not fatal. */
export function parseSnippets(raw: unknown): PackSnippet[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.snippets) ? raw.snippets : []
  const out: PackSnippet[] = []
  const seen = new Set<string>()
  for (const item of list.slice(0, MAX_SNIPPETS)) {
    if (!isRecord(item)) continue
    const id = str(item.id, 64)
    const label = str(item.label, 120)
    const code = typeof item.code === 'string' && item.code.length <= MAX_SNIPPET_CODE ? item.code : null
    const phase = item.phase === 'pre' || item.phase === 'test' || item.phase === 'both' ? item.phase : null
    if (!id || !SLUG_RE.test(id) || seen.has(id) || !label || !code || !phase) continue
    seen.add(id)
    const group = str(item.group, 60) ?? undefined
    out.push({ id, label, phase, code: code.endsWith('\n') ? code : code + '\n', group })
  }
  return out
}

function parseVars(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null
  const vars: Record<string, string> = {}
  let n = 0
  for (const [key, value] of Object.entries(raw)) {
    if (n >= MAX_THEME_VARS) break
    if (!key.startsWith('--') || key.length > 64 || !/^--[a-z0-9-]+$/i.test(key)) continue
    if (typeof value !== 'string' || !isSafeCssValue(value)) continue
    vars[key] = value.trim()
    n++
  }
  return n ? vars : null
}

/** Accepts `[...]` or `{ "themes": [...] }`; ids are namespaced with the pack id. */
export function parseThemes(raw: unknown, packId: string): PackTheme[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.themes) ? raw.themes : []
  const out: PackTheme[] = []
  const seen = new Set<string>()
  for (const item of list.slice(0, MAX_THEMES)) {
    if (!isRecord(item)) continue
    const id = str(item.id, 64)
    const name = str(item.name, 40)
    if (!id || !SLUG_RE.test(id) || seen.has(id) || !name) continue
    const variants: PackTheme['variants'] = {}
    if (isRecord(item.variants)) {
      const dark = parseVars(item.variants.dark)
      const light = parseVars(item.variants.light)
      if (dark) variants.dark = dark
      if (light) variants.light = light
    }
    if (!variants.dark && !variants.light) continue
    seen.add(id)
    const accent = typeof item.accent === 'string' && isSafeCssValue(item.accent) ? item.accent.trim() : undefined
    const description = str(item.description, 200) ?? undefined
    out.push({ id: `${packId}/${id}`, name, description, accent, variants })
  }
  return out
}

/**
 * The palette a theme uses for a UI mode: the matching variant when the theme
 * has one, otherwise its only variant (a dark-only theme stays dark).
 */
export function themeVariant(theme: PackTheme, mode: ThemeMode): { mode: ThemeMode; vars: Record<string, string> } {
  const own = theme.variants[mode]
  if (own) return { mode, vars: own }
  const other: ThemeMode = mode === 'dark' ? 'light' : 'dark'
  return { mode: other, vars: theme.variants[other] ?? {} }
}

/** Why a theme file produced nothing. */
export type ThemeFileError = 'too-large' | 'not-json' | 'no-themes'

/** A theme file bigger than this is not a theme file. */
export const THEME_FILE_MAX_BYTES = 512 * 1024

/**
 * Read a theme file the user picked: one theme, a list of themes, or the
 * `{ "themes": [...] }` wrapper a pack uses — all three are accepted, and every
 * value goes through the same allowlist bundled packs do. A theme without a
 * name borrows `fallbackName` (the file's own name) instead of being dropped.
 */
export function parseThemeFile(text: string, fallbackName: string): { themes: PackTheme[]; error?: ThemeFileError } {
  if (text.length > THEME_FILE_MAX_BYTES) return { themes: [], error: 'too-large' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { themes: [], error: 'not-json' }
  }
  const single = isRecord(raw) && !Array.isArray(raw) && !('themes' in raw)
  const list: unknown[] = single ? [raw] : Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.themes) ? raw.themes : []
  const named = list.map((item) => (isRecord(item) && !item.name ? { ...item, name: fallbackName } : item))
  const themes = parseThemes(named, USER_THEME_PACK)
  return themes.length ? { themes } : { themes: [], error: 'no-themes' }
}

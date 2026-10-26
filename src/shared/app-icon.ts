/**
 * The app icon: a description the renderer draws on a canvas — a shape filled
 * with a gradient and a glyph (or a letter) on top — or a picture the user
 * chose. Built-in presets live here; icon packs (`plugins/<id>/icons.json`,
 * capability `icons.extra`) and «Мои иконки» files use the same shape, and
 * every colour goes through the theme colour allowlist.
 *
 * Pure module — no Node/DOM — shared by the main-process pack reader, the
 * renderer and tests.
 */
import { isSafeCssValue } from './pack-data'

export const ICON_SHAPES = ['squircle', 'circle', 'square', 'hexagon'] as const
export type IconShape = (typeof ICON_SHAPES)[number]

/** Glyph paths on a 20×20 grid; `fill` glyphs are filled, the rest are stroked. */
export const ICON_GLYPHS: Record<string, { d: string; fill?: boolean }> = {
  bolt: { d: 'M11 2.5 4 11h5l-1 6.5L15 9h-5l1-6.5Z', fill: true },
  send: { d: 'M3.5 10 17 3.5 13 17l-3-5-6.5-2Z', fill: true },
  star: { d: 'M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5L10 14.2l-4.5 2.4.9-5-3.6-3.5 5-.7L10 2.8Z', fill: true },
  braces: {
    d: 'M7 3.5c-1.5 0-2 .8-2 2v2.3c0 1-.6 1.7-1.5 2.2.9.5 1.5 1.2 1.5 2.2v2.3c0 1.2.5 2 2 2M13 3.5c1.5 0 2 .8 2 2v2.3c0 1 .6 1.7 1.5 2.2-.9.5-1.5 1.2-1.5 2.2v2.3c0 1.2-.5 2-2 2'
  },
  code: { d: 'M7 6l-4 4 4 4M13 6l4 4-4 4M11.5 4l-3 12' },
  terminal: { d: 'M4.5 6l4 4-4 4M10.5 14.5h5' },
  arrows: { d: 'M4 7h11.5M12.5 4l3 3-3 3M16 13H4.5M7.5 10l-3 3 3 3' },
  globe: { d: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM2.5 10h15M10 2.5c2 2 3 4.6 3 7.5s-1 5.5-3 7.5c-2-2-3-4.6-3-7.5s1-5.5 3-7.5Z' },
  pulse: { d: 'M2.5 10h3.5l2-5 4 10 2-5h3.5' },
  plug: { d: 'M7 2.5v4M13 2.5v4M5 6.5h10v3a5 5 0 0 1-10 0v-3ZM10 14.5v3' },
  cube: { d: 'M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5ZM3.2 6 10 9.5 16.8 6M10 9.5V17' },
  flask: { d: 'M8 2.5h4M8.5 2.5v5L4 15.2a1.5 1.5 0 0 0 1.3 2.3h9.4a1.5 1.5 0 0 0 1.3-2.3L11.5 7.5v-5M6 12.5h8' },
  rocket: {
    d: 'M11.6 3.3c2.5-.9 4.4-.7 5.1 0s.9 2.6 0 5.1c-.7 2-2.2 3.8-4.2 5.2L9.6 15.6 4.4 10.4l2-2.9c1.4-2 3.2-3.5 5.2-4.2ZM12.5 8.9a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM6 14l-2.5 2.5'
  },
  link: {
    d: 'M8.5 11.5a2.5 2.5 0 0 0 3.6.1l2.4-2.4a2.55 2.55 0 0 0-3.6-3.6l-1.1 1.1M11.5 8.5a2.5 2.5 0 0 0-3.6-.1l-2.4 2.4a2.55 2.55 0 0 0 3.6 3.6l1.1-1.1'
  },
  /** a letter or two instead of a picture (`letter`) */
  letter: { d: '' }
}
export type IconGlyph = keyof typeof ICON_GLYPHS

export interface AppIconDef {
  /** 'relay' and the other built-in ids, `<packId>/<id>` for a pack, `user/<id>` for a file */
  id: string
  name: string
  description?: string
  shape: IconShape
  /** gradient stops from the top-left to the bottom-right corner (1–3 colours) */
  background: string[]
  glyph: IconGlyph
  glyphColor: string
  /** glyph 'letter': one or two characters */
  letter?: string
  /** a picture the user chose instead of a drawing: `data:image/png;base64,…`, already 256×256 */
  image?: string
}

/** The icon the app ships with; picking it puts the original icon back. */
export const DEFAULT_APP_ICON = 'relay'

/** Id of the icon built in the editor («Создать свою»). */
export const CUSTOM_APP_ICON = 'custom'

/** Id prefix of an icon loaded from a file rather than from a pack. */
export const USER_ICON_PACK = 'user'

const preset = (id: string, name: string, background: string[], glyphColor = '#ffffff', glyph: IconGlyph = 'bolt', shape: IconShape = 'squircle'): AppIconDef => ({
  id,
  name,
  shape,
  background,
  glyph,
  glyphColor
})

/** Presets built into the app: the Relay bolt in a few colours. */
export const ICON_PRESETS: AppIconDef[] = [
  preset('relay', 'Relay', ['#5a8dff', '#3e70e6']),
  preset('midnight', 'Полночь', ['#30333f', '#15161d'], '#7aa2ff'),
  preset('light', 'Светлая', ['#ffffff', '#e6e9f1'], '#3e70e6'),
  preset('sunset', 'Закат', ['#ff9a4d', '#e8467c']),
  preset('forest', 'Лес', ['#3fd08f', '#1b8a72']),
  preset('grape', 'Виноград', ['#ae82ff', '#6a3fd8']),
  preset('ruby', 'Рубин', ['#ff6470', '#c42d4a']),
  preset('amber', 'Янтарь', ['#ffd257', '#f08a24'], '#3b2608'),
  preset('graphite', 'Графит', ['#8c91a0', '#474b56'])
]

const MAX_ICONS = 60
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** letters and digits of any script, one or two of them */
const LETTER_RE = /^[\p{L}\p{N}]{1,2}$/u
/** a picture is kept as a PNG data URL; ~256×256 PNGs stay far below this */
export const ICON_IMAGE_MAX = 400 * 1024
const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)
const color = (v: unknown): string | null => (typeof v === 'string' && isSafeCssValue(v) ? v.trim() : null)

/** A PNG data URL of sane size — the only kind of picture an icon may carry. */
export function isIconImage(v: unknown): v is string {
  return typeof v === 'string' && v.length <= ICON_IMAGE_MAX && PNG_DATA_URL_RE.test(v)
}

/**
 * One icon from pack or file data, or null when it is not usable. Unknown
 * shapes and glyphs fall back to the Relay ones rather than dropping the icon;
 * a colour outside the allowlist does drop it.
 */
export function parseIcon(item: unknown, idPrefix: string): AppIconDef | null {
  if (!isRecord(item)) return null
  const id = str(item.id, 64)
  const name = str(item.name, 40)
  if (!id || !SLUG_RE.test(id) || !name) return null
  const description = str(item.description, 200) ?? undefined
  const shape = (ICON_SHAPES as readonly string[]).includes(item.shape as string) ? (item.shape as IconShape) : 'squircle'
  if (item.image !== undefined) {
    if (!isIconImage(item.image)) return null
    return { id: `${idPrefix}/${id}`, name, description, shape, background: [], glyph: 'bolt', glyphColor: '#ffffff', image: item.image }
  }
  const rawBg = Array.isArray(item.background) ? item.background : typeof item.background === 'string' ? [item.background] : []
  const background = rawBg.slice(0, 3).map(color)
  if (!background.length || background.some((c) => !c)) return null
  const glyphColor = item.glyphColor === undefined ? '#ffffff' : color(item.glyphColor)
  if (!glyphColor) return null
  const glyph = typeof item.glyph === 'string' && item.glyph in ICON_GLYPHS ? (item.glyph as IconGlyph) : 'bolt'
  let letter: string | undefined
  if (glyph === 'letter') {
    letter = typeof item.letter === 'string' && LETTER_RE.test(item.letter.trim()) ? item.letter.trim() : undefined
    if (!letter) return null
  }
  return { id: `${idPrefix}/${id}`, name, description, shape, background: background as string[], glyph, glyphColor, letter }
}

/** Accepts `[...]` or `{ "icons": [...] }`; invalid entries are skipped, not fatal. */
export function parseIcons(raw: unknown, packId: string): AppIconDef[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.icons) ? raw.icons : []
  const out: AppIconDef[] = []
  const seen = new Set<string>()
  for (const item of list.slice(0, MAX_ICONS)) {
    const icon = parseIcon(item, packId)
    if (!icon || seen.has(icon.id)) continue
    seen.add(icon.id)
    out.push(icon)
  }
  return out
}

export type IconFileError = 'too-large' | 'not-json' | 'no-icons'

/** An icon description file bigger than this is not one. */
export const ICON_FILE_MAX_BYTES = 512 * 1024

/**
 * An icon description file the user picked: one icon, a list, or the pack's
 * `{ "icons": [...] }` — the same rules as a pack. An icon without a name or
 * an id borrows the file's name.
 */
export function parseIconFile(text: string, fallbackName: string): { icons: AppIconDef[]; error?: IconFileError } {
  if (text.length > ICON_FILE_MAX_BYTES) return { icons: [], error: 'too-large' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { icons: [], error: 'not-json' }
  }
  const single = isRecord(raw) && !('icons' in raw)
  const list: unknown[] = single ? [raw] : Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.icons) ? raw.icons : []
  const slug = slugOf(fallbackName)
  const named = list.map((item, i) =>
    isRecord(item) ? { ...item, name: item.name || fallbackName, id: item.id || (list.length > 1 ? `${slug}-${i + 1}` : slug) } : item
  )
  const icons = parseIcons(named, USER_ICON_PACK)
  return icons.length ? { icons } : { icons: [], error: 'no-icons' }
}

/** A file name turned into an id: «My Icon.json» → `my-icon`. */
export function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'icon'
}

/** «Мои иконки»: icons added from files, app-level like the user's themes. */
export interface UserIconsDoc {
  version: number
  icons: AppIconDef[]
}

/** The built-in, pack or user icon with this id, if it is (still) there. */
export function findIcon(id: string, ...lists: AppIconDef[][]): AppIconDef | null {
  for (const list of [ICON_PRESETS, ...lists]) {
    const hit = list.find((i) => i.id === id)
    if (hit) return hit
  }
  return null
}

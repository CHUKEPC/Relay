import { create } from 'zustand'
import { STORAGE_VERSION } from '@shared/constants'
import { isIconImage, parseIconFile, slugOf, USER_ICON_PACK, type AppIconDef, type UserIconsDoc } from '@shared/app-icon'
import { persist } from './persist'

/** Keeping the list short keeps the Appearance section readable. */
const MAX_ICONS = 40

interface UserIconsState {
  icons: AppIconDef[]
  hydrate: (doc: UserIconsDoc | null) => void
  /**
   * Add every valid icon from an icon description file (JSON). Returns how
   * many were added and replaced, or why nothing was added.
   */
  addFromText: (text: string, fallbackName: string) => { added: number; replaced: number; error?: string; first?: AppIconDef }
  /** Add a picture (already a 256×256 PNG data URL) under the file's name. */
  addImage: (png: string, name: string) => AppIconDef | null
  remove: (id: string) => void
}

function save(icons: AppIconDef[]): void {
  persist('userIcons', { version: STORAGE_VERSION, icons })
}

export const useUserIcons = create<UserIconsState>((set, get) => ({
  icons: [],

  hydrate: (doc) => set({ icons: (doc?.icons ?? []).filter((i) => !i.image || isIconImage(i.image)) }),

  addFromText: (text, fallbackName) => {
    const { icons: incoming, error } = parseIconFile(text, fallbackName)
    if (error) return { added: 0, replaced: 0, error }
    const byId = new Map(get().icons.map((i) => [i.id, i]))
    let added = 0
    let replaced = 0
    for (const icon of incoming) {
      if (byId.has(icon.id)) replaced++
      else added++
      byId.set(icon.id, icon)
    }
    const icons = [...byId.values()].slice(0, MAX_ICONS)
    set({ icons })
    save(icons)
    return { added, replaced, first: incoming[0] }
  },

  addImage: (png, name) => {
    if (!isIconImage(png)) return null
    const taken = new Set(get().icons.map((i) => i.id))
    const base = `${USER_ICON_PACK}/${slugOf(name)}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    const icon: AppIconDef = {
      id,
      name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Icon',
      shape: 'squircle',
      background: [],
      glyph: 'bolt',
      glyphColor: '#ffffff',
      image: png
    }
    const icons = [...get().icons, icon].slice(-MAX_ICONS)
    set({ icons })
    save(icons)
    return icon
  },

  remove: (id) => {
    const icons = get().icons.filter((i) => i.id !== id)
    set({ icons })
    save(icons)
  }
}))

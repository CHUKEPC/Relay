/**
 * Which optional features this installation has.
 *
 * The base app ships HTTP only; every other protocol, the AI assistant, the
 * advanced auth schemes, extra UI languages and more than four panes come from
 * the capability packs in the `plugins/` folder. Components ask this store
 * instead of importing feature code unconditionally, so a disabled pack leaves
 * no trace in the UI.
 */
import { create } from 'zustand'
import type { Capability, FeaturePluginInfo } from '@shared/features'
import type { PackSnippet, PackTheme } from '@shared/pack-data'
import { usePanes } from './panes'

interface FeaturesState {
  plugins: FeaturePluginInfo[]
  caps: Set<Capability>
  loaded: boolean
  /** data of the enabled snippet / theme packs (re-read when the pack set changes) */
  snippets: PackSnippet[]
  themes: PackTheme[]
  setPlugins: (list: FeaturePluginInfo[]) => void
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  load: () => Promise<void>
}

const capsOf = (list: FeaturePluginInfo[]): Set<Capability> => {
  const set = new Set<Capability>()
  for (const p of list) if (p.enabled && !p.error) for (const c of p.capabilities) set.add(c)
  return set
}

/** Pane ceiling follows the «Дополнительные панели» pack. */
const PLUGIN_MAX_PANES = 16
const CORE_MAX_PANES = 4

export const useFeatures = create<FeaturesState>((set, get) => ({
  plugins: [],
  caps: new Set(),
  loaded: false,
  snippets: [],
  themes: [],

  setPlugins: (list) => {
    const caps = capsOf(list)
    set({ plugins: list, caps, loaded: true })
    usePanes.getState().setMaxPanes(caps.has('panes.extra') ? PLUGIN_MAX_PANES : CORE_MAX_PANES)
    void loadPackData(caps)
  },

  setEnabled: async (id, enabled) => {
    get().setPlugins(await window.api.featuresSetEnabled(id, enabled))
  },

  load: async () => {
    try {
      get().setPlugins(await window.api.featuresList())
    } catch {
      // No packs reachable — the base app still works, just without extras.
      set({ loaded: true })
    }
  }
}))

/**
 * Snippets and themes live in pack data files; they are re-read whenever the
 * enabled set changes (a pack added, removed or updated on disk).
 */
async function loadPackData(caps: Set<Capability>): Promise<void> {
  try {
    const [snippets, themes] = await Promise.all([
      caps.has('snippets') ? window.api.featuresSnippets() : Promise.resolve([]),
      caps.has('themes.extra') ? window.api.featuresThemes() : Promise.resolve([])
    ])
    useFeatures.setState({ snippets, themes })
    for (const cb of packDataListeners) cb(themes)
  } catch {
    useFeatures.setState({ snippets: [], themes: [] })
  }
}

/** Notified after pack themes are (re)read — the appearance store syncs from it. */
const packDataListeners = new Set<(themes: PackTheme[]) => void>()
export function onPackThemes(cb: (themes: PackTheme[]) => void): () => void {
  packDataListeners.add(cb)
  return () => packDataListeners.delete(cb)
}

/** Subscribe once to enable/disable changes made in another window. */
export function wireFeatures(): () => void {
  return window.api.onFeaturesChanged((list) => useFeatures.getState().setPlugins(list))
}

/** Hook: does this installation have `cap`? */
export function useCap(cap: Capability): boolean {
  return useFeatures((s) => s.caps.has(cap))
}

/** Non-reactive read, for stores and event handlers. */
export function hasCap(cap: Capability): boolean {
  return useFeatures.getState().caps.has(cap)
}

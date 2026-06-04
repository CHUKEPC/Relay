import { useSettings, watchSystemTheme } from './settings'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useHistory } from './history'
import { useTabs } from './tabs'
import { useAi } from './ai'
import { flushPersist } from './persist'
import {
  defaultSettingsDoc,
  emptyCollections,
  emptyEnvironments,
  emptyGlobals,
  emptyHistory,
  emptyProviders,
  emptyTabs
} from './defaults'

let unloadWired = false

/** Load all persisted documents from main and hydrate the stores. */
export async function bootstrap(): Promise<void> {
  const [collections, environments, globals, history, tabs, settings, providers] = await Promise.all([
    window.api.storageLoad('collections'),
    window.api.storageLoad('environments'),
    window.api.storageLoad('globals'),
    window.api.storageLoad('history'),
    window.api.storageLoad('tabs'),
    window.api.storageLoad('settings'),
    window.api.storageLoad('providers')
  ])

  useSettings.getState().hydrate(settings ?? defaultSettingsDoc())
  useCollections.getState().hydrate(collections ?? emptyCollections())
  useEnvironments.getState().hydrate(environments ?? emptyEnvironments(), globals ?? emptyGlobals())
  useHistory.getState().hydrate(history ?? emptyHistory())
  useTabs.getState().hydrate(tabs ?? emptyTabs())
  useAi.getState().hydrateProviders(providers ?? emptyProviders())

  // Reflect stored hasKey against the actual secret store (keys may have been
  // cleared out-of-band); keep the UI honest.
  for (const p of useAi.getState().providers.providers) {
    if (p.apiKeyRef) {
      const has = await window.api.secretsHas(p.apiKeyRef)
      if (has !== !!p.hasKey) useAi.getState().updateProvider(p.id, { hasKey: has })
    }
  }

  if (!useTabs.getState().doc.tabs.length) useTabs.getState().openNew()

  watchSystemTheme()

  // Flush any debounced writes before the window unloads so the last edit (made
  // within the debounce window) isn't lost on quit.
  if (!unloadWired) {
    unloadWired = true
    window.addEventListener('beforeunload', flushPersist)
  }
}

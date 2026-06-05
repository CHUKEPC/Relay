import { useSettings, watchSystemTheme } from './settings'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useHistory } from './history'
import { useTabs } from './tabs'
import { useAi } from './ai'
import { useResponse } from './response'
import { useRealtime } from './realtime'
import { useRunner } from './runner'
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
  // Wire the unload flush FIRST — before any await — so a rejected storageLoad
  // can't skip past it and lose the unload-time flush for the whole session.
  if (!unloadWired) {
    unloadWired = true
    window.addEventListener('beforeunload', flushPersist)
  }

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
}

/**
 * Re-hydrate the per-workspace stores after switching the active workspace.
 * App-level docs (settings, providers) are unchanged across workspaces, so only
 * the isolated data set is reloaded. The caller must have flushed pending writes
 * and invoked `workspaceSwitch` in main first.
 */
export async function reloadWorkspace(): Promise<void> {
  // Tear down volatile UI state tied to the previous workspace's tabs/collections.
  useRealtime.getState().disconnectAll()
  useResponse.setState({ byTab: {} })
  // The runner's target points at the previous workspace's collection nodes.
  useRunner.getState().close()
  useRunner.setState({ targetId: null, targetName: '', results: [], current: null })

  const [collections, environments, globals, history, tabs] = await Promise.all([
    window.api.storageLoad('collections'),
    window.api.storageLoad('environments'),
    window.api.storageLoad('globals'),
    window.api.storageLoad('history'),
    window.api.storageLoad('tabs')
  ])

  useCollections.getState().hydrate(collections ?? emptyCollections())
  useEnvironments.getState().hydrate(environments ?? emptyEnvironments(), globals ?? emptyGlobals())
  useHistory.getState().hydrate(history ?? emptyHistory())
  useTabs.getState().hydrate(tabs ?? emptyTabs())
  if (!useTabs.getState().doc.tabs.length) useTabs.getState().openNew()
}

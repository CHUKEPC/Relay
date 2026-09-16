import type { StorageKey, StorageMap } from '@shared/ipc-contract'
import { useTabs } from './tabs'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useHistory } from './history'
import { useSettings } from './settings'
import { useAi } from './ai'

let wired = false

/**
 * Apply documents saved by another Relay window (a detached pane or the main
 * window), so every window shows the same requests, environments and settings.
 * Hydrating never persists, so updates don't echo back.
 */
export function wireStorageSync(): void {
  if (wired) return
  wired = true
  window.api.onStorageChanged(<K extends StorageKey>(key: K, value: StorageMap[K]) => {
    switch (key) {
      case 'tabs': {
        const remote = value as StorageMap['tabs']
        const local = useTabs.getState().doc.activeTabId
        // Each window keeps its own focused tab.
        const activeTabId = local && remote.tabs.some((t) => t.id === local) ? local : null
        useTabs.getState().hydrate({ ...remote, activeTabId })
        break
      }
      case 'collections':
        useCollections.getState().hydrate(value as StorageMap['collections'])
        break
      case 'environments':
        useEnvironments.getState().hydrate(value as StorageMap['environments'], useEnvironments.getState().globals)
        break
      case 'globals':
        useEnvironments.getState().hydrate(useEnvironments.getState().env, value as StorageMap['globals'])
        break
      case 'history':
        useHistory.getState().hydrate(value as StorageMap['history'])
        break
      case 'settings':
        useSettings.getState().hydrate(value as StorageMap['settings'])
        break
      case 'providers':
        useAi.getState().hydrateProviders(value as StorageMap['providers'])
        break
    }
  })
}

import { useSettings, watchSystemTheme } from './settings'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useHistory } from './history'
import { useTabs } from './tabs'
import { useAi } from './ai'
import { useResponse } from './response'
import { useRealtime } from './realtime'
import { useGrpc } from './grpc'
import { useRunner } from './runner'
import { usePlugins } from './plugins'
import { useFeatures, wireFeatures } from './features'
import { applyLanguage } from '../lib/i18n'
import { useUi } from './ui'
import { flushPersist, persist } from './persist'
import { LEGACY_PRESET_IDS } from '../lib/provider-templates'
import {
  defaultSettingsDoc,
  emptyCollections,
  emptyEnvironments,
  emptyGlobals,
  emptyHistory,
  emptyProviders,
  emptyTabs
} from './defaults'

import { tr } from '@renderer/lib/i18n'
let unloadWired = false

/**
 * Older versions seeded Anthropic/OpenAI/OpenRouter/Local on first run, which
 * showed "active" providers nobody had configured. Remove the ones that were
 * never connected; anything with a key stays.
 */
function dropUntouchedLegacyPresets(): void {
  const doc = useAi.getState().providers
  const providers = doc.providers.filter((p) => !(LEGACY_PRESET_IDS.has(p.id) && !p.hasKey && !p.apiKeyRef))
  const activeValid = providers.some((p) => p.id === doc.activeProviderId && p.hasKey)
  const activeProviderId = activeValid ? doc.activeProviderId : (providers.find((p) => p.hasKey)?.id ?? null)
  if (providers.length === doc.providers.length && activeProviderId === doc.activeProviderId) return
  const next = { ...doc, providers, activeProviderId }
  useAi.setState({ providers: next })
  persist('providers', next)
}

/** Load all persisted documents from main and hydrate the stores. */
export async function bootstrap(opts: { detached?: boolean } = {}): Promise<void> {
  // Wire the unload flush FIRST — before any await — so a rejected storageLoad
  // can't skip past it and lose the unload-time flush for the whole session.
  if (!unloadWired) {
    unloadWired = true
    window.addEventListener('beforeunload', flushPersist)
  }

  // Feature packs decide which UI even exists (protocols, AI, auth, languages),
  // so they are loaded with the documents, before the first render.
  const [collections, environments, globals, history, tabs, settings, providers, features] = await Promise.all([
    window.api.storageLoad('collections'),
    window.api.storageLoad('environments'),
    window.api.storageLoad('globals'),
    window.api.storageLoad('history'),
    window.api.storageLoad('tabs'),
    window.api.storageLoad('settings'),
    window.api.storageLoad('providers'),
    window.api.featuresList().catch(() => [])
  ])

  useFeatures.getState().setPlugins(features)
  useSettings.getState().hydrate(settings ?? defaultSettingsDoc())
  // Language depends on the packs above (a plugin language needs its pack on).
  await applyLanguage(useSettings.getState().settings.language || 'ru')
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
  // A detached pane window shows one existing tab; the main window owns first-run setup.
  if (opts.detached) {
    watchSystemTheme()
    return
  }

  dropUntouchedLegacyPresets()
  if (!useTabs.getState().doc.tabs.length) useTabs.getState().openNew()

  // Plugins load opportunistically — a broken plugins dir must not stall boot.
  void usePlugins.getState().init()

  wireFeatures()
  watchSystemTheme()
  scheduleUpdateCheck()
}

/**
 * Fire-and-forget version check against GitHub Releases, a few seconds after
 * launch so it never competes with startup work. Failures are silently ignored
 * — this must never block or break bootstrap.
 */
function scheduleUpdateCheck(): void {
  if (!useSettings.getState().settings.updateCheckEnabled) return
  window.setTimeout(() => {
    void window.api
      .checkUpdates()
      .then((res) => {
        if (res.ok && res.updateAvailable) {
          useUi.getState().showToast(tr('Доступна новая версия ') + res.latestVersion + ' — Настройки → О приложении')
        }
      })
      .catch(() => {
        /* ignore — opportunistic check only */
      })
  }, 3500)
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
  for (const id of Object.keys(useGrpc.getState().byTab)) useGrpc.getState().cancel(id)
  useGrpc.setState({ byTab: {} })
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

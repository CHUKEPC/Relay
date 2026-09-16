import { STORAGE_VERSION } from '@shared/constants'
import type {
  CollectionsDoc,
  CookiesDoc,
  EnvironmentsDoc,
  GlobalsDoc,
  HistoryDoc,
  PluginsStateDoc,
  ProvidersDoc,
  SettingsDoc,
  TabsDoc
} from '@shared/types'
import type { FeaturePluginsDoc } from '@shared/ipc-contract'

/**
 * First-run seed data. The app starts CLEAN — no demo collections, environments,
 * variables, history or tabs (the renderer opens a single blank tab on boot).
 * Only the default settings are seeded; AI providers start empty.
 */

export function defaultCollections(): CollectionsDoc {
  return { version: STORAGE_VERSION, collections: [] }
}

export function defaultEnvironments(): EnvironmentsDoc {
  return { version: STORAGE_VERSION, activeEnvironmentId: null, environments: [] }
}

export function defaultGlobals(): GlobalsDoc {
  return { version: STORAGE_VERSION, variables: [] }
}

export function defaultHistory(): HistoryDoc {
  return { version: STORAGE_VERSION, entries: [] }
}

export function defaultTabs(): TabsDoc {
  // No seeded tabs — bootstrap() opens one blank "Untitled" tab when empty.
  return { version: STORAGE_VERSION, activeTabId: null, tabs: [] }
}

export function defaultProviders(): ProvidersDoc {
  // Providers are added by the user from templates in Settings → AI providers.
  return { version: STORAGE_VERSION, activeProviderId: null, providers: [] }
}

export function defaultSettings(): SettingsDoc {
  return {
    version: STORAGE_VERSION,
    theme: 'system',
    accentHue: 264,
    accentColor: null,
    themePreset: 'relay',
    customTheme: null,
    keybindings: {},
    updateCheckEnabled: true,
    language: 'ru',
    disableHardwareAcceleration: false,
    onboardingDone: false,
    requestTimeoutMs: 30000,
    followRedirects: true,
    maxRedirects: 10,
    rejectUnauthorized: true,
    maxHistory: 200,
    wordWrapResponse: false,
    sendAiContext: true,
    autoApplyAiTools: false,
    defaultProviderId: null,
    proxy: { mode: 'off', enabled: false, url: '', bypass: [] },
    clientCerts: [],
    caPath: '',
    http2: false
  }
}

export function defaultCookies(): CookiesDoc {
  return { version: STORAGE_VERSION, cookies: [] }
}

export function defaultPlugins(): PluginsStateDoc {
  return { version: STORAGE_VERSION, plugins: [] }
}

export function defaultFeatures(): FeaturePluginsDoc {
  // Empty map = every pack is off; the installer (or Settings) switches on
  // what the user actually wants.
  return { version: STORAGE_VERSION, enabled: {} }
}

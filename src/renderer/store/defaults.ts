import { STORAGE_VERSION } from '@shared/constants'
import type {
  CollectionsDoc,
  EnvironmentsDoc,
  GlobalsDoc,
  HistoryDoc,
  ProvidersDoc,
  SettingsDoc,
  TabsDoc
} from '@shared/types'

/**
 * Placeholder initial state used before the real documents are hydrated from
 * disk on app start (main seeds first-run data).
 */
export function defaultSettingsDoc(): SettingsDoc {
  return {
    version: STORAGE_VERSION,
    theme: 'system',
    accentHue: 264,
    requestTimeoutMs: 30000,
    followRedirects: true,
    maxRedirects: 10,
    rejectUnauthorized: true,
    maxHistory: 200,
    wordWrapResponse: false,
    sendAiContext: true,
    autoApplyAiTools: false,
    defaultProviderId: null,
    proxy: { enabled: false, url: '', bypass: [] },
    clientCerts: []
  }
}

export const emptyCollections = (): CollectionsDoc => ({ version: STORAGE_VERSION, collections: [] })
export const emptyEnvironments = (): EnvironmentsDoc => ({
  version: STORAGE_VERSION,
  environments: [],
  activeEnvironmentId: null
})
export const emptyGlobals = (): GlobalsDoc => ({ version: STORAGE_VERSION, variables: [] })
export const emptyHistory = (): HistoryDoc => ({ version: STORAGE_VERSION, entries: [] })
export const emptyTabs = (): TabsDoc => ({ version: STORAGE_VERSION, tabs: [], activeTabId: null })
export const emptyProviders = (): ProvidersDoc => ({ version: STORAGE_VERSION, providers: [], activeProviderId: null })

import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { ProviderConfig } from '@shared/types'
import { IPC, type StorageKey, type StorageMap } from '@shared/ipc-contract'
import { JsonStore } from './json-store'
import { SecretStore } from './secrets'
import {
  defaultCollections,
  defaultCookies,
  defaultEnvironments,
  defaultGlobals,
  defaultHistory,
  defaultProviders,
  defaultSettings,
  defaultTabs
} from './defaults'

const SEEDS: { [K in StorageKey]: () => StorageMap[K] } = {
  collections: defaultCollections,
  environments: defaultEnvironments,
  globals: defaultGlobals,
  history: defaultHistory,
  tabs: defaultTabs,
  settings: defaultSettings,
  providers: defaultProviders,
  cookies: defaultCookies
}

/**
 * Owns the JSON document store + the encrypted secret store, with an in-memory
 * cache so AI handlers can read provider config / secrets synchronously.
 */
export class StorageManager {
  readonly store: JsonStore
  readonly secrets: SecretStore
  private cache = new Map<StorageKey, unknown>()

  constructor() {
    const dataDir = join(app.getPath('userData'), 'relay-data')
    this.store = new JsonStore(dataDir)
    this.secrets = new SecretStore(dataDir)
  }

  async get<K extends StorageKey>(key: K): Promise<StorageMap[K]> {
    if (this.cache.has(key)) return this.cache.get(key) as StorageMap[K]
    let doc = await this.store.load(key)
    if (!doc) {
      doc = SEEDS[key]() as StorageMap[K]
      this.store.save(key, doc)
    }
    this.cache.set(key, doc)
    return doc as StorageMap[K]
  }

  set<K extends StorageKey>(key: K, value: StorageMap[K]): void {
    this.cache.set(key, value)
    this.store.save(key, value)
  }

  getCached<K extends StorageKey>(key: K): StorageMap[K] | null {
    return (this.cache.get(key) as StorageMap[K]) ?? null
  }

  /** Warm caches that the AI handler reads synchronously. */
  async init(): Promise<void> {
    await this.get('providers')
    await this.get('settings')
  }

  /** Sync provider lookup for AI handler deps. */
  getProvider = (id: string): ProviderConfig | null => {
    const doc = this.getCached('providers')
    if (!doc) return null
    return doc.providers.find((p) => p.id === id) ?? null
  }

  /** Sync secret resolution for AI handler deps. */
  getSecret = (ref: string): string | null => this.secrets.get(ref)

  async flush(): Promise<void> {
    await this.store.flushAll()
  }
}

export function registerStorageHandlers(storage: StorageManager): void {
  ipcMain.handle(IPC.storage.load, async (_e, key: StorageKey) => storage.get(key))
  ipcMain.handle(IPC.storage.save, async (_e, key: StorageKey, value: unknown) => {
    storage.set(key, value as StorageMap[StorageKey])
  })

  ipcMain.handle(IPC.secrets.set, async (_e, ref: string, value: string) => {
    storage.secrets.set(ref, value)
    return { ref }
  })
  ipcMain.handle(IPC.secrets.has, async (_e, ref: string) => storage.secrets.has(ref))
  ipcMain.handle(IPC.secrets.delete, async (_e, ref: string) => {
    storage.secrets.delete(ref)
  })
  ipcMain.handle(IPC.secrets.available, async () => storage.secrets.isAvailable())
}

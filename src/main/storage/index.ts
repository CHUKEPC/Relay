import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { ProviderConfig, WorkspaceMeta, WorkspacesDoc } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { IPC, type StorageKey, type StorageMap } from '@shared/ipc-contract'
import { JsonStore } from './json-store'
import { SecretStore } from './secrets'
import {
  defaultCollections,
  defaultCookies,
  defaultEnvironments,
  defaultGlobals,
  defaultHistory,
  defaultPlugins,
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
  cookies: defaultCookies,
  plugins: defaultPlugins
}

/**
 * Keys that live at the app level (shared across all workspaces): UI/network
 * settings, AI provider config (+ their safeStorage secrets). Everything else is
 * isolated per workspace.
 */
const APP_KEYS = new Set<StorageKey>(['settings', 'providers', 'plugins'])
/** Per-workspace document keys (the isolated working data set). */
const WS_KEYS = ['collections', 'environments', 'globals', 'history', 'tabs', 'cookies'] as const

function isAppKey(key: StorageKey): boolean {
  return APP_KEYS.has(key)
}

/** Empty (non-demo) docs written when a brand-new workspace is created. */
const BLANK_WS: { [K in (typeof WS_KEYS)[number]]: () => StorageMap[K] } = {
  collections: () => ({ version: STORAGE_VERSION, collections: [] }),
  environments: () => ({ version: STORAGE_VERSION, environments: [], activeEnvironmentId: null }),
  globals: () => ({ version: STORAGE_VERSION, variables: [] }),
  history: () => ({ version: STORAGE_VERSION, entries: [] }),
  tabs: () => ({ version: STORAGE_VERSION, tabs: [], activeTabId: null }),
  cookies: () => ({ version: STORAGE_VERSION, cookies: [] })
}

/**
 * Owns the JSON document store + the encrypted secret store, with an in-memory
 * cache so AI handlers can read provider config / secrets synchronously.
 *
 * Storage is **workspace-aware**: app-level keys live at the data root; the
 * per-workspace keys live under `ws/<id>/`. Switching a workspace re-points the
 * per-workspace store and drops its cached docs (app-level cache is untouched).
 */
export class StorageManager {
  readonly secrets: SecretStore
  private rootDir: string
  private appStore: JsonStore
  private wsStore: JsonStore
  private workspaces: WorkspacesDoc
  private activeWorkspaceId: string
  private cache = new Map<StorageKey, unknown>()
  /** Dedupes concurrent first-load/seed of the same key (avoids double-seeding). */
  private inflight = new Map<StorageKey, Promise<unknown>>()
  /** Notified after a workspace switch so dependents (cookie jar) can reload. */
  private switchListeners = new Set<() => void>()
  /** Notified after any document save (key passed). */
  private saveListeners = new Set<(key: StorageKey) => void>()

  constructor() {
    this.rootDir = join(app.getPath('userData'), 'relay-data')
    mkdirSync(this.rootDir, { recursive: true })
    this.secrets = new SecretStore(this.rootDir)
    this.appStore = new JsonStore(this.rootDir)
    this.workspaces = this.loadOrInitWorkspaces()
    this.activeWorkspaceId = this.workspaces.activeWorkspaceId
    this.wsStore = new JsonStore(this.wsDir(this.activeWorkspaceId))
  }

  private wsDir(id: string): string {
    return join(this.rootDir, 'ws', id)
  }

  private metaFile(): string {
    return join(this.rootDir, 'workspaces.json')
  }

  private storeFor(key: StorageKey): JsonStore {
    return isAppKey(key) ? this.appStore : this.wsStore
  }

  /**
   * Load the workspaces meta file, or initialize it on first run. On a fresh
   * upgrade (no meta yet) any legacy per-workspace docs sitting at the data root
   * are migrated into a `default` workspace so existing data is preserved.
   */
  private loadOrInitWorkspaces(): WorkspacesDoc {
    try {
      if (existsSync(this.metaFile())) {
        const raw = readFileSync(this.metaFile(), 'utf8')
        const doc = JSON.parse(raw) as WorkspacesDoc
        if (Array.isArray(doc.workspaces) && doc.workspaces.length) {
          // Keep the active id valid even if the referenced workspace vanished.
          if (!doc.workspaces.some((w) => w.id === doc.activeWorkspaceId)) {
            doc.activeWorkspaceId = doc.workspaces[0].id
          }
          return doc
        }
      }
    } catch (err) {
      console.error('[storage] failed to read workspaces meta:', (err as Error).message)
    }

    // First run / corrupt meta → create a default workspace and migrate legacy files.
    const defaultId = 'default'
    mkdirSync(this.wsDir(defaultId), { recursive: true })
    for (const key of WS_KEYS) {
      const legacy = join(this.rootDir, `${key}.json`)
      const target = join(this.wsDir(defaultId), `${key}.json`)
      try {
        if (existsSync(legacy) && !existsSync(target)) renameSync(legacy, target)
      } catch (err) {
        console.error(`[storage] migrate ${key} failed:`, (err as Error).message)
      }
    }
    const doc: WorkspacesDoc = {
      version: STORAGE_VERSION,
      workspaces: [{ id: defaultId, name: 'Личное' }],
      activeWorkspaceId: defaultId
    }
    this.writeMeta(doc)
    return doc
  }

  private writeMeta(doc: WorkspacesDoc): void {
    const tmp = `${this.metaFile()}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
      renameSync(tmp, this.metaFile())
    } catch (err) {
      console.error('[storage] failed to persist workspaces meta:', (err as Error).message)
    }
  }

  async get<K extends StorageKey>(key: K): Promise<StorageMap[K]> {
    if (this.cache.has(key)) return this.cache.get(key) as StorageMap[K]
    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<StorageMap[K]>
    const store = this.storeFor(key)
    const load = (async () => {
      let doc = await store.load(key)
      if (!doc) {
        doc = SEEDS[key]() as StorageMap[K]
        // Persist a separate copy so the cached object is never aliased by the
        // store's pending-write buffer.
        store.save(key, structuredClone(doc))
      }
      // Only cache if the store hasn't been re-pointed by a workspace switch that
      // happened while this load was in flight — otherwise we'd cache the previous
      // workspace's document under the now-active workspace (cross-workspace bleed).
      if (this.storeFor(key) === store) this.cache.set(key, doc)
      return doc
    })()
    this.inflight.set(key, load)
    try {
      return (await load) as StorageMap[K]
    } finally {
      this.inflight.delete(key)
    }
  }

  set<K extends StorageKey>(key: K, value: StorageMap[K]): void {
    this.cache.set(key, value)
    this.storeFor(key).save(key, value)
    for (const cb of this.saveListeners) {
      try {
        cb(key)
      } catch (err) {
        console.error('[storage] save listener failed:', (err as Error).message)
      }
    }
  }

  /** Notified (with the key) after any document is saved. */
  onSave(cb: (key: StorageKey) => void): () => void {
    this.saveListeners.add(cb)
    return () => this.saveListeners.delete(cb)
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
    await this.appStore.flushAll()
    await this.wsStore.flushAll()
  }

  /* ---- workspaces ---- */

  onWorkspaceSwitch(cb: () => void): () => void {
    this.switchListeners.add(cb)
    return () => this.switchListeners.delete(cb)
  }

  listWorkspaces(): { workspaces: WorkspaceMeta[]; activeId: string } {
    return { workspaces: this.workspaces.workspaces.map((w) => ({ ...w })), activeId: this.activeWorkspaceId }
  }

  createWorkspace(name: string): WorkspaceMeta {
    const id = makeId('ws')
    const dir = this.wsDir(id)
    mkdirSync(dir, { recursive: true })
    // Start blank (not the demo seed) so a new workspace is empty.
    for (const key of WS_KEYS) {
      const tmp = join(dir, `${key}.json.${process.pid}.tmp`)
      const file = join(dir, `${key}.json`)
      try {
        writeFileSync(tmp, JSON.stringify(BLANK_WS[key](), null, 2), 'utf8')
        renameSync(tmp, file)
      } catch (err) {
        console.error(`[storage] init workspace ${key} failed:`, (err as Error).message)
      }
    }
    const meta: WorkspaceMeta = { id, name: name.trim() || 'Workspace' }
    this.workspaces.workspaces.push(meta)
    this.writeMeta(this.workspaces)
    return meta
  }

  renameWorkspace(id: string, name: string): void {
    const w = this.workspaces.workspaces.find((x) => x.id === id)
    if (!w) return
    w.name = name.trim() || w.name
    this.writeMeta(this.workspaces)
  }

  /** Delete a workspace. Returns the (possibly new) active id, or null if refused. */
  async deleteWorkspace(id: string): Promise<string | null> {
    if (this.workspaces.workspaces.length <= 1) return null // never delete the last one
    const idx = this.workspaces.workspaces.findIndex((x) => x.id === id)
    if (idx < 0) return null
    this.workspaces.workspaces.splice(idx, 1)
    // If the active workspace was removed, fall back to the first remaining one.
    if (this.activeWorkspaceId === id) {
      await this.switchWorkspace(this.workspaces.workspaces[0].id, false)
    }
    // Keep the meta's active id consistent with the (possibly switched) active.
    this.workspaces.activeWorkspaceId = this.activeWorkspaceId
    this.writeMeta(this.workspaces)
    // Best-effort removal of the on-disk data (after we've stopped using it).
    try {
      const { rm } = await import('node:fs/promises')
      await rm(this.wsDir(id), { recursive: true, force: true })
    } catch (err) {
      console.error('[storage] failed to remove workspace dir:', (err as Error).message)
    }
    return this.activeWorkspaceId
  }

  async switchWorkspace(id: string, persist = true): Promise<boolean> {
    if (!this.workspaces.workspaces.some((w) => w.id === id)) return false
    if (id === this.activeWorkspaceId && persist) return true
    // Flush + drop the outgoing per-workspace store, then re-point at the new one.
    await this.wsStore.flushAll()
    this.wsStore = new JsonStore(this.wsDir(id))
    for (const key of WS_KEYS) {
      this.cache.delete(key)
      this.inflight.delete(key)
    }
    this.activeWorkspaceId = id
    if (persist) {
      this.workspaces.activeWorkspaceId = id
      this.writeMeta(this.workspaces)
    }
    for (const cb of this.switchListeners) {
      try {
        cb()
      } catch (err) {
        console.error('[storage] workspace switch listener failed:', (err as Error).message)
      }
    }
    return true
  }
}

export function registerStorageHandlers(storage: StorageManager): void {
  // Reject unknown keys: `fileFor` joins the key into a path, so an unvalidated
  // key from the renderer (`../foo`) would read/write outside the data dir.
  const isKnownKey = (key: string): boolean => Object.prototype.hasOwnProperty.call(SEEDS, key)
  ipcMain.handle(IPC.storage.load, async (_e, key: StorageKey) => {
    if (!isKnownKey(key)) throw new Error(`Unknown storage key: ${key}`)
    return storage.get(key)
  })
  ipcMain.handle(IPC.storage.save, async (_e, key: StorageKey, value: unknown) => {
    if (!isKnownKey(key)) throw new Error(`Unknown storage key: ${key}`)
    storage.set(key, value as StorageMap[StorageKey])
  })

  // The `plugin:` namespace is owned by PluginManager (which validates the key
  // against the manifest); the generic secrets channel must not let the renderer
  // read-existence/overwrite/delete another plugin's secret out of band.
  const isReserved = (ref: string): boolean => typeof ref !== 'string' || ref.startsWith('plugin:')
  ipcMain.handle(IPC.secrets.set, async (_e, ref: string, value: string) => {
    if (isReserved(ref)) throw new Error('Reserved secret namespace')
    storage.secrets.set(ref, value)
    return { ref }
  })
  ipcMain.handle(IPC.secrets.has, async (_e, ref: string) => (isReserved(ref) ? false : storage.secrets.has(ref)))
  ipcMain.handle(IPC.secrets.delete, async (_e, ref: string) => {
    if (isReserved(ref)) return
    storage.secrets.delete(ref)
  })
  ipcMain.handle(IPC.secrets.available, async () => storage.secrets.isAvailable())
}

export function registerWorkspaceHandlers(storage: StorageManager): void {
  ipcMain.handle(IPC.workspace.list, async () => storage.listWorkspaces())
  ipcMain.handle(IPC.workspace.create, async (_e, name: string) => storage.createWorkspace(name))
  ipcMain.handle(IPC.workspace.rename, async (_e, id: string, name: string) => {
    storage.renameWorkspace(id, name)
  })
  ipcMain.handle(IPC.workspace.delete, async (_e, id: string) => {
    await storage.deleteWorkspace(id)
  })
  ipcMain.handle(IPC.workspace.switch, async (_e, id: string) => {
    await storage.switchWorkspace(id)
  })
}

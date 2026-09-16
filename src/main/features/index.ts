/**
 * Feature plugin registry — reads the `plugins/` folder shipped with the app.
 *
 * Everything here is declarative: a manifest says which capabilities a folder
 * unlocks, and (for the language pack) which locale files it carries. No plugin
 * code is ever executed, so this registry needs neither sandbox nor permissions
 * — unlike the user plugin system in `src/main/plugins`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { isCapability, type Capability, type FeaturePluginInfo, type FeaturePluginManifest } from '@shared/features'
import type { StorageManager } from '../storage'

const MANIFEST = 'plugin.json'
const MANIFEST_MAX_BYTES = 64 * 1024
const LOCALE_MAX_BYTES = 512 * 1024
const LOCALE_CODE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/

/**
 * Where the bundled plugins live: next to the executable in a packaged build
 * (electron-builder `extraResources`), at the repo root while developing.
 */
export function pluginsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'plugins') : join(app.getAppPath(), 'plugins')
}

function readManifest(dir: string, folder: string): FeaturePluginInfo {
  const base: FeaturePluginInfo = {
    id: folder,
    name: folder,
    description: '',
    version: '0.0.0',
    capabilities: [],
    enabled: false,
    dir
  }
  const file = join(dir, MANIFEST)
  try {
    if (statSync(file).size > MANIFEST_MAX_BYTES) return { ...base, error: 'манифест слишком большой' }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FeaturePluginManifest>
    if (raw.id !== folder) return { ...base, error: 'id в манифесте не совпадает с именем папки' }
    const caps = Array.isArray(raw.capabilities) ? raw.capabilities.filter(isCapability) : []
    if (!caps.length) return { ...base, error: 'манифест не объявляет ни одной возможности' }
    const locales = Array.isArray(raw.locales) ? raw.locales.filter((l) => typeof l === 'string' && LOCALE_CODE.test(l)) : undefined
    return {
      ...base,
      name: typeof raw.name === 'string' && raw.name ? raw.name : folder,
      description: typeof raw.description === 'string' ? raw.description : '',
      version: typeof raw.version === 'string' ? raw.version : '0.0.0',
      capabilities: caps as Capability[],
      locales: locales?.length ? locales : undefined
    }
  } catch (err) {
    return { ...base, error: `манифест не читается: ${(err as Error).message}` }
  }
}

export class FeatureRegistry {
  private plugins: FeaturePluginInfo[] = []
  private enabled: Record<string, boolean> = {}
  private loaded = false

  constructor(private storage: StorageManager) {}

  /** Scan the folder and merge the persisted enable/disable state. */
  async load(): Promise<FeaturePluginInfo[]> {
    const dir = pluginsDir()
    let folders: string[] = []
    try {
      folders = existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name)
            .sort()
        : []
    } catch (err) {
      console.error('[features] cannot read plugins dir:', (err as Error).message)
    }

    const doc = await this.storage.get('features')
    this.enabled = { ...doc.enabled }
    this.plugins = folders.map((f) => {
      const info = readManifest(join(dir, f), f)
      // New plugins start enabled: the folder shipping with the app *is* the
      // user's decision to have the feature. Disabling is what gets persisted.
      return { ...info, enabled: !info.error && (this.enabled[info.id] ?? true) }
    })
    this.loaded = true
    return this.list()
  }

  list(): FeaturePluginInfo[] {
    return this.plugins.map((p) => ({ ...p }))
  }

  /** Capabilities unlocked by the currently enabled plugins. */
  capabilities(): Capability[] {
    const set = new Set<Capability>()
    for (const p of this.plugins) if (p.enabled && !p.error) for (const c of p.capabilities) set.add(c)
    return [...set]
  }

  async setEnabled(id: string, enabled: boolean): Promise<FeaturePluginInfo[]> {
    const plugin = this.plugins.find((p) => p.id === id)
    if (!plugin || plugin.error) return this.list()
    plugin.enabled = enabled
    this.enabled[id] = enabled
    const doc = await this.storage.get('features')
    this.storage.set('features', { ...doc, enabled: { ...this.enabled } })
    this.broadcast()
    return this.list()
  }

  /**
   * Read one locale catalog contributed by an enabled language plugin.
   * Path is derived from the plugin id and a validated code, never from the
   * renderer, so a crafted code cannot escape the plugin folder.
   */
  readLocale(code: string): Record<string, string> | null {
    if (!LOCALE_CODE.test(code)) return null
    for (const p of this.plugins) {
      if (!p.enabled || p.error || !p.locales?.includes(code)) continue
      const file = join(p.dir, 'locales', `${code}.json`)
      // Defence in depth: the resolved path must stay inside the plugin folder.
      if (!resolve(file).startsWith(resolve(p.dir))) return null
      try {
        if (statSync(file).size > LOCALE_MAX_BYTES) return null
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
        return out
      } catch {
        return null
      }
    }
    return null
  }

  /** Locale codes offered by enabled language plugins. */
  extraLocales(): string[] {
    const out = new Set<string>()
    for (const p of this.plugins) if (p.enabled && !p.error) for (const l of p.locales ?? []) out.add(l)
    return [...out]
  }

  private broadcast(): void {
    const list = this.list()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.features.changed, list)
    }
  }

  isLoaded(): boolean {
    return this.loaded
  }
}

export function registerFeatureHandlers(registry: FeatureRegistry): void {
  ipcMain.handle(IPC.features.list, async () => (registry.isLoaded() ? registry.list() : registry.load()))
  ipcMain.handle(IPC.features.setEnabled, (_e, id: string, enabled: boolean) => registry.setEnabled(id, enabled))
  ipcMain.handle(IPC.features.locale, (_e, code: string) => registry.readLocale(code))
  ipcMain.handle(IPC.features.openFolder, async () => {
    const dir = pluginsDir()
    if (existsSync(dir)) await shell.openPath(dir)
    return existsSync(dir)
  })
}

/**
 * Feature plugin registry — reads the `plugins/` folder shipped with the app.
 *
 * Everything here is declarative: a manifest says which capabilities a folder
 * unlocks, and (for the language pack) which locale files it carries. No plugin
 * code is ever executed, so this registry needs neither sandbox nor permissions
 * — unlike the user plugin system in `src/main/plugins`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { isCapability, type Capability, type FeaturePluginInfo, type FeaturePluginManifest } from '@shared/features'
import type { StorageManager } from '../storage'
import { mt } from '../i18n'
import { readInstallChoice } from './install'
import { MANIFEST, MANIFEST_MAX_BYTES, stageSource, validateManifest } from './pack-source'
import { PACK_DATA_MAX_BYTES, parseSnippets, parseThemes, SNIPPETS_FILE, THEMES_FILE, type PackSnippet, type PackTheme } from '@shared/pack-data'

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
  /** Every pack folder found on disk, added or not. */
  private plugins: FeaturePluginInfo[] = []
  /**
   * Packs the user has actually taken into the app: ticked in the installer or
   * picked later in Settings. A folder that is merely present in `plugins/` is
   * deliberately *not* here — it stays invisible until it is added, so the
   * Settings list shows what the user chose rather than what shipped.
   */
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

    // The installer's pack selection wins once per install; after that the
    // user's own toggles in Settings are what counts.
    const choice = readInstallChoice()
    const fresh = choice && choice.stamp !== doc.appliedInstall
    if (choice && fresh) {
      // Only the ticked packs are added; the rest keep sitting in the folder.
      this.enabled = Object.fromEntries(folders.filter((id) => choice.packs.includes(id)).map((id) => [id, true]))
    }

    this.plugins = folders.map((f) => {
      const info = readManifest(join(dir, f), f)
      // Packs start OFF: the base app is HTTP only, and everything beyond that
      // is switched on deliberately — in the installer or in Settings.
      return { ...info, enabled: !info.error && (this.enabled[info.id] ?? false) }
    })
    this.loaded = true

    if (choice && fresh) {
      this.storage.set('features', { ...doc, enabled: { ...this.enabled }, appliedInstall: choice.stamp })
      await this.applyInstallLocale(choice.locale)
    }
    // After the installer choice, which rewrites the features document.
    await this.migrate(folders)
    return this.list()
  }

  /** The packs the user added — what Settings shows. */
  list(): FeaturePluginInfo[] {
    return this.plugins.filter((p) => p.id in this.enabled).map((p) => ({ ...p }))
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

  /**
   * Install a pack the user picked anywhere on disk: either the folder holding
   * its `plugin.json`, or a `.zip` containing one. The folder is copied into
   * the app's `plugins` directory so it loads on every start like the bundled
   * ones — there is no second place packs can live.
   */
  async install(sourcePath: string): Promise<{ ok: true; id: string; list: FeaturePluginInfo[] } | { ok: false; error: string }> {
    const dir = pluginsDir()
    try {
      mkdirSync(dir, { recursive: true })
      const staged = stageSource(sourcePath)
      if ('error' in staged) return { ok: false, error: staged.error }

      const checked = validateManifest(staged.dir)
      if ('error' in checked) {
        if (staged.temp) rmSync(staged.temp, { recursive: true, force: true })
        return { ok: false, error: checked.error }
      }
      const id = checked.id

      const target = join(dir, id)
      // Picking a folder that already lives in `plugins/` (the dialog opens
      // there) is the normal way to take a shipped pack into use — nothing to
      // copy, it just gets added.
      if (resolve(staged.dir) !== resolve(target)) {
        rmSync(target, { recursive: true, force: true })
        cpSync(staged.dir, target, { recursive: true })
      }
      if (staged.temp) rmSync(staged.temp, { recursive: true, force: true })

      // A hand-picked pack is switched on immediately: picking it *is* the
      // decision to use it, unlike the ones that merely ship with the app.
      this.enabled[id] = true
      const doc = await this.storage.get('features')
      this.storage.set('features', { ...doc, enabled: { ...this.enabled, [id]: true } })
      await this.load()
      this.broadcast()
      return { ok: true, id, list: this.list() }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Take a pack out of the app. The folder is left in `plugins/` on purpose:
   * removing a shipped pack must not mean reinstalling the app to get it back,
   * and the same picker that added it can add it again.
   */
  async remove(id: string): Promise<FeaturePluginInfo[]> {
    delete this.enabled[id]
    const doc = await this.storage.get('features')
    const enabled = { ...doc.enabled }
    delete enabled[id]
    this.storage.set('features', { ...doc, enabled })
    await this.load()
    this.broadcast()
    return this.list()
  }

  /**
   * Parsed data file of every enabled pack that has `cap`. The path is built
   * from the pack folder and a fixed file name, never from the renderer.
   */
  private readPackData<T>(cap: Capability, file: string, parse: (raw: unknown, packId: string) => T[]): T[] {
    const out: T[] = []
    for (const p of this.plugins) {
      if (!p.enabled || p.error || !p.capabilities.includes(cap)) continue
      const path = join(p.dir, file)
      if (!resolve(path).startsWith(resolve(p.dir))) continue
      try {
        if (!existsSync(path) || statSync(path).size > PACK_DATA_MAX_BYTES) continue
        out.push(...parse(JSON.parse(readFileSync(path, 'utf8')) as unknown, p.id))
      } catch (err) {
        console.error(`[features] ${p.id}/${file} is not readable:`, (err as Error).message)
      }
    }
    return out
  }

  /** Script snippets of all enabled snippet packs (first pack wins on an id clash). */
  snippets(): PackSnippet[] {
    const seen = new Set<string>()
    return this.readPackData('snippets', SNIPPETS_FILE, (raw) => parseSnippets(raw)).filter((s) => !seen.has(s.id) && !!seen.add(s.id))
  }

  /** Colour themes of all enabled theme packs, ids namespaced by pack. */
  themes(): PackTheme[] {
    return this.readPackData('themes.extra', THEMES_FILE, parseThemes)
  }

  /**
   * 1.2 moved built-in things into packs: the script snippets, the Postman /
   * Insomnia themes and most code-generation languages. Someone upgrading must
   * not lose them, so once per installation: an existing user gets the snippet
   * and code-generation packs added, and a Postman/Insomnia theme is carried
   * over to the theme pack (which is added too). A fresh install is left alone —
   * packs stay opt-in there.
   */
  private async migrate(folders: string[]): Promise<void> {
    try {
      const doc = await this.storage.get('features')
      const done = new Set(doc.migrations ?? [])
      const pending = ['packs-1.2', 'codegen-1.2'].filter((m) => !done.has(m))
      if (!pending.length) return
      const settings = await this.storage.get('settings')
      const existingUser = !!(settings.onboardingDone || settings.onboardingVersion)
      const add = (id: string): void => {
        if (!folders.includes(id) || id in this.enabled) return
        this.enabled[id] = true
        const p = this.plugins.find((x) => x.id === id)
        if (p && !p.error) p.enabled = true
      }
      // The code-generation languages beyond cURL/HTTP/JS/Python moved into a pack too.
      if (pending.includes('codegen-1.2') && existingUser) add('codegen-languages')
      if (pending.includes('packs-1.2') && existingUser) add('script-snippets')

      const legacy = settings.themePreset === 'postman' || settings.themePreset === 'insomnia' ? settings.themePreset : null
      if (pending.includes('packs-1.2') && legacy) {
        add('theme-pack')
        const theme = this.themes().find((t) => t.id === `theme-pack/${legacy}`)
        this.storage.set(
          'settings',
          theme
            ? { ...settings, themePreset: 'pack', packTheme: theme.id, packThemeData: theme }
            : { ...settings, themePreset: 'relay', packTheme: null, packThemeData: null }
        )
      }
      this.storage.set('features', { ...doc, enabled: { ...this.enabled }, migrations: [...done, ...pending] })
    } catch (err) {
      console.error('[features] migration failed:', (err as Error).message)
    }
  }

  /** Locale codes offered by enabled language plugins. */
  extraLocales(): string[] {
    const out = new Set<string>()
    for (const p of this.plugins) if (p.enabled && !p.error) for (const l of p.locales ?? []) out.add(l)
    return [...out]
  }

  /**
   * Make the language chosen in the installer the UI language. Only ever
   * applied together with a fresh install marker, so it cannot fight a user who
   * later picks a different language in Settings.
   */
  private async applyInstallLocale(locale: string): Promise<void> {
    try {
      const settings = await this.storage.get('settings')
      if (settings.language === locale) return
      this.storage.set('settings', { ...settings, language: locale })
    } catch (err) {
      console.error('[features] cannot apply the installer language:', (err as Error).message)
    }
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

/** Result of the one "pick a plugin" action in Settings. */
export type PickResult =
  | { ok: true; kind: 'pack'; id: string; list: FeaturePluginInfo[] }
  | { ok: true; kind: 'plugin'; id: string }
  | { ok: false; error: string }

export function registerFeatureHandlers(
  registry: FeatureRegistry,
  /** Fallback for an archive that is a code plugin rather than a capability pack. */
  installCodePlugin: (zipPath: string) => Promise<{ id: string }>
): void {
  ipcMain.handle(IPC.features.list, async () => (registry.isLoaded() ? registry.list() : registry.load()))
  ipcMain.handle(IPC.features.setEnabled, (_e, id: string, enabled: boolean) => registry.setEnabled(id, enabled))
  ipcMain.handle(IPC.features.locale, (_e, code: string) => registry.readLocale(code))
  ipcMain.handle(IPC.features.snippets, async () => {
    if (!registry.isLoaded()) await registry.load()
    return registry.snippets()
  })
  ipcMain.handle(IPC.features.themes, async () => {
    if (!registry.isLoaded()) await registry.load()
    return registry.themes()
  })
  ipcMain.handle(IPC.features.install, async (): Promise<PickResult | null> => {
    // The path always comes from a native dialog, never from the renderer. It
    // opens in the plugins folder — where the packs that ship with the app wait
    // to be switched on — but any folder on the computer works.
    const picked = await dialog.showOpenDialog({
      title: mt('Выберите плагин'),
      defaultPath: pluginsDir(),
      properties: ['openFile'],
      filters: [
        { name: mt('Плагин Relay'), extensions: ['json', 'zip'] },
        { name: mt('Все файлы'), extensions: ['*'] }
      ]
    })
    if (picked.canceled || !picked.filePaths.length) return null

    const path = picked.filePaths[0]
    const asPack = await registry.install(path)
    if (asPack.ok) return { ...asPack, kind: 'pack' as const }

    // Not a capability pack. A `.zip` can still be a code plugin, so try that
    // before reporting the pack error — the user picked one file, not a kind.
    if (path.toLowerCase().endsWith('.zip')) {
      try {
        const installed = await installCodePlugin(path)
        return { ok: true as const, kind: 'plugin' as const, id: installed.id }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    }
    return asPack
  })

  ipcMain.handle(IPC.features.remove, (_e, id: string) => registry.remove(id))

  ipcMain.handle(IPC.features.openFolder, async () => {
    const dir = pluginsDir()
    if (existsSync(dir)) await shell.openPath(dir)
    return existsSync(dir)
  })
}

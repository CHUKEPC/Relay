/**
 * PluginManager — discovery, grants, hot reload and event dispatch for user
 * plugins (docs/PLUGINS.md). Lives in the main process; plugin CODE never runs
 * here — every event is dispatched to an isolated forked sandbox (`./host.ts`).
 *
 * Enforcement happens in this trusted layer: the event context is filtered by
 * the user's grants and redacted (credential-looking header values masked, URL
 * query values masked, body capped) BEFORE it crosses the fork boundary, and is
 * capability-gated again inside the sandbox. The renderer's copy of the context
 * is advisory input only.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { app, clipboard, dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { STORAGE_VERSION } from '@shared/constants'
import type {
  PluginEventContext,
  PluginHistorySnapshot,
  PluginInfo,
  PluginLastRun,
  PluginManifest,
  PluginPermission,
  PluginRunKind,
  PluginRunRequest,
  PluginRunResult,
  PluginsBroadcastEvent,
  PluginsStateDoc,
  PluginStateEntry,
  RequestSpec,
  ResponseResult
} from '@shared/types'
import { requestSnapshotForPlugin, responseSnapshotForPlugin } from '@shared/plugin-context'
import type { StorageManager } from '../storage'
import { maskHeader, redactUrl } from './redact'
import { applyRequestPatch, effectivePermissions } from './perms'
import { isValidNetHost, MAIN_MAX_BYTES, MANIFEST_FILE, MANIFEST_MAX_BYTES, parseManifest } from './manifest'
import { runPluginInSandbox } from './host'
import { SAMPLE_PLUGIN_FILES, SAMPLE_PLUGIN_ID } from './sample'

/** Response body cap inside an event context (chars). */
const CONTEXT_BODY_LIMIT = 200_000

const WATCH_DEBOUNCE_MS = 300
/** Config value caps (renderer-supplied input). */
const MAX_CONFIG_KEYS = 40
const MAX_CONFIG_VALUE_CHARS = 4096
/** Plugin-scoped KV store caps (per plugin). */
const MAX_STORAGE_KEYS = 100
const MAX_STORAGE_VALUE_CHARS = 8192
const MAX_NET_ALLOWLIST = 20
/** Per-plugin bound for the BLOCKING pre-request hook — short so a slow plugin
 *  can't stall the user's send (the 15 s wall is for fire-and-forget events). */
const PRE_REQUEST_HOOK_TIMEOUT_MS = 5000
/** Aggregate bound across ALL pre-request hooks for one send — so N plugins each
 *  near their per-hook limit can't add up to a multi-second stall. */
const REQUEST_HOOKS_TOTAL_BUDGET_MS = 8000
/** Recent-history entries exposed to a plugin with `history:read`. */
const HISTORY_LIMIT = 25
/** Max chars of an interactive panel's postMessage payload. */
const MAX_PANEL_MESSAGE_CHARS = 16_384
/** Keep only the tail of a run's console output on the PluginInfo card. */
const LAST_RUN_LOG_TAIL = 20
/** Identical hook toasts from one plugin within this window are dropped. */
const TOAST_DEDUPE_MS = 10_000

/** safeStorage ref for a plugin's secret config value. */
function secretRef(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`
}

interface DiscoveredPlugin {
  /** folder name == plugin id (enforced by manifest validation) */
  folder: string
  dir: string
  manifest: PluginManifest | null
  error?: string
}

/** Placeholder manifest so broken plugins still render a card with the error. */
function brokenManifest(folder: string): PluginManifest {
  return { id: folder, name: folder, version: '0.0.0', apiVersion: 1, permissions: [], contributes: {}, config: [] }
}

export class PluginManager {
  private readonly pluginsDir: string
  /** Per-plugin KV stores (the `storage` permission), kept OUTSIDE the plugin
   *  folder so the plugin can't tamper with its own persisted state on disk. */
  private readonly pluginDataDir: string
  private storeCache = new Map<string, Record<string, string>>()
  private discovered: DiscoveredPlugin[] | null = null
  /** False when the LAST scan failed to read the plugins dir at all — list()
   *  must then skip orphan revocation (an EPERM/EMFILE blip must not durably
   *  revoke every grant as if all folders were deleted). */
  private lastScanOk = true
  private watchers: FSWatcher[] = []
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  /** Per-plugin lifecycle-hook coalescing: at most 1 running + 1 pending. The
   *  pending value is a lazy payload builder (+ its run kind), not a built
   *  payload (so a coalesced event never pays for readMain/sanitize). */
  private hookBusy = new Set<string>()
  private hookPending = new Map<string, { kind: PluginRunKind; build: () => PluginRunRequest | null }>()
  /** Unsubscribe fns for workspace/collection event sources. */
  private lifecycleUnsubs: Array<() => void> = []
  /** Last sandbox run per plugin — the v1 debugging surface on the card. */
  private lastRuns = new Map<string, PluginLastRun>()
  /** Per-plugin toast dedupe (docs §5.2 promises per-plugin, not global). */
  private lastToasts = new Map<string, { key: string; at: number }>()

  constructor(
    private readonly storage: StorageManager,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    const root = join(app.getPath('userData'), 'relay-data')
    this.pluginsDir = join(root, 'plugins')
    this.pluginDataDir = join(root, 'plugin-data')
    try {
      mkdirSync(this.pluginsDir, { recursive: true })
      mkdirSync(this.pluginDataDir, { recursive: true })
    } catch (err) {
      console.error('[plugins] failed to create plugins dir:', (err as Error).message)
    }
  }

  get dir(): string {
    return this.pluginsDir
  }

  /* ---- plugin-scoped KV storage (the `storage` permission) ---- */

  private storeFile(id: string): string {
    return join(this.pluginDataDir, `${id}.json`)
  }

  private readStore(id: string): Record<string, string> {
    const cached = this.storeCache.get(id)
    if (cached) return cached
    let kv: Record<string, string> = {}
    try {
      const file = this.storeFile(id)
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') kv[k] = v
          }
        }
      }
    } catch (err) {
      console.error(`[plugins] ${id}: failed to read store:`, (err as Error).message)
      kv = {}
    }
    this.storeCache.set(id, kv)
    return kv
  }

  /** Apply a run's storageUpdates to the plugin's KV store (capped) and persist. */
  private applyStorageUpdates(id: string, updates: Record<string, string | null> | undefined): void {
    if (!updates || !Object.keys(updates).length) return
    const kv = { ...this.readStore(id) }
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) delete kv[k]
      else if (Object.keys(kv).length < MAX_STORAGE_KEYS || Object.prototype.hasOwnProperty.call(kv, k)) {
        kv[k] = v.slice(0, MAX_STORAGE_VALUE_CHARS)
      }
    }
    this.storeCache.set(id, kv)
    try {
      const tmp = `${this.storeFile(id)}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(kv), 'utf8')
      renameSync(tmp, this.storeFile(id))
    } catch (err) {
      console.error(`[plugins] ${id}: failed to persist store:`, (err as Error).message)
    }
  }

  /* ---- file confinement ---- */

  /**
   * Reject symlinked plugin files and anything that resolves outside the
   * plugins folder. The manifest already forbids path separators in `main`;
   * this closes the symlink variant (§8: files outside the sandbox stay
   * unreachable).
   */
  private assertConfinedFile(path: string): void {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) throw new Error('symlinked plugin files are not allowed')
    const real = realpathSync(path)
    const base = realpathSync(this.pluginsDir)
    if (real !== base && !real.startsWith(base + sep)) {
      throw new Error('plugin file escapes the plugins folder')
    }
  }

  /* ---- discovery ---- */

  private scanSync(): DiscoveredPlugin[] {
    let folders: string[] = []
    try {
      folders = readdirSync(this.pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort()
      this.lastScanOk = true
    } catch (err) {
      console.error('[plugins] scan failed:', (err as Error).message)
      this.lastScanOk = false
      return []
    }

    return folders.map((folder): DiscoveredPlugin => {
      const dir = join(this.pluginsDir, folder)
      const manifestPath = join(dir, MANIFEST_FILE)
      try {
        this.assertConfinedFile(manifestPath)
        const size = statSync(manifestPath).size
        if (size > MANIFEST_MAX_BYTES) {
          return { folder, dir, manifest: null, error: `plugin.json is too large (max ${MANIFEST_MAX_BYTES / 1024} KB)` }
        }
      } catch (err) {
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'plugin.json not found' : (err as Error).message
        return { folder, dir, manifest: null, error: msg }
      }

      let raw: string
      try {
        raw = readFileSync(manifestPath, 'utf8')
      } catch (err) {
        return { folder, dir, manifest: null, error: `cannot read plugin.json: ${(err as Error).message}` }
      }

      const parsed = parseManifest(raw, folder)
      if (!parsed.ok) return { folder, dir, manifest: null, error: parsed.error }
      const manifest = parsed.manifest

      // A plugin that contributes handlers must actually ship its main file.
      const needsCode =
        (manifest.contributes.buttons?.length ?? 0) > 0 ||
        (manifest.contributes.panels?.length ?? 0) > 0 ||
        (manifest.contributes.events?.length ?? 0) > 0
      if (needsCode) {
        const mainPath = join(dir, manifest.main ?? 'main.js')
        try {
          this.assertConfinedFile(mainPath)
          const size = statSync(mainPath).size
          if (size > MAIN_MAX_BYTES) {
            return { folder, dir, manifest, error: `${manifest.main ?? 'main.js'} is too large (max ${MAIN_MAX_BYTES / 1024} KB)` }
          }
        } catch (err) {
          const msg =
            (err as NodeJS.ErrnoException).code === 'ENOENT'
              ? `${manifest.main ?? 'main.js'} not found`
              : (err as Error).message
          return { folder, dir, manifest, error: msg }
        }
      }

      return { folder, dir, manifest }
    })
  }

  private ensureScan(): DiscoveredPlugin[] {
    if (!this.discovered) this.discovered = this.scanSync()
    return this.discovered
  }

  /** Drop the scan cache (fs watcher, installs, the «Обновить» button). */
  invalidate(): void {
    this.discovered = null
  }

  /* ---- state merge ---- */

  async list(): Promise<PluginInfo[]> {
    const discovered = this.ensureScan()
    let state = await this.storage.get('plugins')

    // A deleted folder revokes activation: stale entries lose enabled+granted
    // so a later same-id reinstall starts disabled and must be re-approved.
    // Only when the scan itself succeeded — a transient readdir failure must
    // not be mistaken for "all plugins were deleted".
    const orphaned = !this.lastScanOk
      ? []
      : state.plugins.filter(
          (e) => (e.enabled || e.granted.length > 0) && !discovered.some((d) => d.folder === e.id)
        )
    if (orphaned.length) {
      await this.mutateState((plugins) =>
        plugins.map((e) => (orphaned.some((o) => o.id === e.id) ? { ...e, enabled: false, granted: [] } : e))
      )
      state = await this.storage.get('plugins')
    }

    return discovered.map((d) => {
      const entry = state.plugins.find((e) => e.id === d.folder)
      const granted = entry?.granted ?? []
      const manifest = d.manifest ?? brokenManifest(d.folder)
      // A manifest update that asks for MORE than was granted disables the
      // plugin until the user re-approves (docs/PLUGINS.md §4).
      const needsRegrant =
        !!d.manifest && !!entry?.enabled && !d.manifest.permissions.every((p) => granted.includes(p))
      const enabled = !!entry?.enabled && !d.error && !needsRegrant
      // Which secret config keys currently have a value in safeStorage.
      const secretKeysSet = manifest.config
        .filter((f) => f.type === 'secret' && this.storage.secrets.has(secretRef(d.folder, f.key)))
        .map((f) => f.key)
      const info: PluginInfo = {
        manifest,
        dir: d.dir,
        enabled,
        granted,
        config: entry?.config ?? {},
        secretKeysSet,
        netAllowlist: entry?.netAllowlist ?? [],
        needsRegrant,
        error: d.error
      }
      const lastRun = this.lastRuns.get(d.folder)
      if (lastRun) info.lastRun = lastRun
      return info
    })
  }

  /** Resolve the dispatch config: non-secret values + decrypted secret values. */
  private resolveConfig(manifest: PluginManifest, config: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = { ...config }
    for (const f of manifest.config) {
      if (f.type !== 'secret') continue
      const v = this.storage.secrets.get(secretRef(manifest.id, f.key))
      if (v != null) out[f.key] = v
      else delete out[f.key]
    }
    return out
  }

  private async mutateState(fn: (plugins: PluginStateEntry[]) => PluginStateEntry[]): Promise<void> {
    const doc = await this.storage.get('plugins')
    const next: PluginsStateDoc = { version: STORAGE_VERSION, plugins: fn(doc.plugins.slice()) }
    this.storage.set('plugins', next)
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginInfo[]> {
    const d = this.ensureScan().find((x) => x.folder === id)
    if (enabled && (!d?.manifest || d.error)) {
      // Broken plugins can never be enabled; return the current truth.
      return this.list()
    }
    await this.mutateState((plugins) => {
      const idx = plugins.findIndex((e) => e.id === id)
      if (enabled && d?.manifest) {
        // Enable = grant: snapshot the CURRENT manifest permission set, but
        // PRESERVE the user's config + net allowlist across a disable→enable.
        const entry: PluginStateEntry = {
          id,
          enabled: true,
          granted: [...d.manifest.permissions],
          config: idx >= 0 ? plugins[idx].config : {},
          netAllowlist: idx >= 0 ? plugins[idx].netAllowlist : undefined
        }
        if (idx >= 0) plugins[idx] = entry
        else plugins.push(entry)
      } else if (idx >= 0) {
        plugins[idx] = { ...plugins[idx], enabled: false }
      }
      return plugins
    })
    return this.list()
  }

  async setConfig(id: string, config: unknown): Promise<void> {
    // Secret-typed fields are NEVER stored in the doc — they go through
    // setSecret → safeStorage. Drop them here defensively even if the renderer
    // sends one by mistake.
    const manifest = this.ensureScan().find((d) => d.folder === id)?.manifest
    const secretKeys = new Set((manifest?.config ?? []).filter((f) => f.type === 'secret').map((f) => f.key))
    const clean: Record<string, string> = {}
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
        if (Object.keys(clean).length >= MAX_CONFIG_KEYS) break
        if (typeof k !== 'string' || k.length > 64 || secretKeys.has(k)) continue
        clean[k] = String(v ?? '').slice(0, MAX_CONFIG_VALUE_CHARS)
      }
    }
    await this.mutateState((plugins) => {
      const idx = plugins.findIndex((e) => e.id === id)
      if (idx >= 0) plugins[idx] = { ...plugins[idx], config: clean }
      else plugins.push({ id, enabled: false, granted: [], config: clean })
      return plugins
    })
  }

  /** Store (or clear, when value is '') a secret config value in safeStorage. */
  async setSecret(id: string, key: string, value: string): Promise<PluginInfo[]> {
    const manifest = this.ensureScan().find((d) => d.folder === id)?.manifest
    const field = manifest?.config.find((f) => f.key === key && f.type === 'secret')
    if (!field) return this.list() // unknown / non-secret key — ignore
    const ref = secretRef(id, key)
    if (value) this.storage.secrets.set(ref, value.slice(0, MAX_CONFIG_VALUE_CHARS))
    else this.storage.secrets.delete(ref)
    return this.list()
  }

  /** Set the user's net allowlist (host patterns). [] removes the restriction. */
  async setNetAllowlist(id: string, hosts: unknown): Promise<PluginInfo[]> {
    const clean: string[] = []
    if (Array.isArray(hosts)) {
      for (const h of hosts) {
        if (clean.length >= MAX_NET_ALLOWLIST) break
        const host = typeof h === 'string' ? h.trim().toLowerCase() : ''
        if (host && isValidNetHost(host) && !clean.includes(host)) clean.push(host)
      }
    }
    await this.mutateState((plugins) => {
      const idx = plugins.findIndex((e) => e.id === id)
      if (idx >= 0) plugins[idx] = { ...plugins[idx], netAllowlist: clean }
      else plugins.push({ id, enabled: false, granted: [], config: {}, netAllowlist: clean })
      return plugins
    })
    return this.list()
  }

  /* ---- context sanitization (the trusted enforcement point) ---- */

  private sanitizeContext(granted: PluginPermission[], context: PluginEventContext | undefined): PluginEventContext {
    const out: PluginEventContext = {}
    const req = context?.request
    if (granted.includes('request:read') && req) {
      const headers = Array.isArray(req.headers) ? req.headers : []
      out.request = {
        method: String(req.method ?? '').slice(0, 32),
        url: redactUrl(String(req.url ?? '').slice(0, 8192)),
        headers: headers.slice(0, 100).map((h) => {
          const key = String(h?.key ?? '').slice(0, 200)
          return { key, value: maskHeader(key, String(h?.value ?? '').slice(0, 4096)) }
        })
      }
    }
    const res = context?.response
    if (granted.includes('response:read') && res) {
      let bodyText = typeof res.bodyText === 'string' ? res.bodyText : undefined
      let truncated = !!res.truncated
      if (bodyText != null && bodyText.length > CONTEXT_BODY_LIMIT) {
        bodyText = bodyText.slice(0, CONTEXT_BODY_LIMIT)
        truncated = true
      }
      const headers = Array.isArray(res.headers) ? res.headers : []
      out.response = {
        status: Number(res.status) || 0,
        statusText: String(res.statusText ?? '').slice(0, 200),
        headers: headers.slice(0, 200).map(([k, v]) => {
          const key = String(k ?? '').slice(0, 200)
          return [key, maskHeader(key, String(v ?? '').slice(0, 4096))] as [string, string]
        }),
        contentType: String(res.contentType ?? '').slice(0, 200),
        bodyText,
        truncated,
        sizeBytes: Number(res.sizeBytes) || 0,
        timeMs: Number(res.timeMs) || 0,
        finalUrl: redactUrl(String(res.finalUrl ?? '').slice(0, 8192))
      }
    }
    if (granted.includes('history:read') && Array.isArray(context?.history)) {
      out.history = context!.history.slice(0, HISTORY_LIMIT)
    }
    // workspace + panel message are not secrets — pass through, but cap the
    // message size so any path (not just panelMessage) stays bounded.
    if (context?.workspace) out.workspace = context.workspace
    if (context?.message !== undefined) {
      try {
        const s = JSON.stringify(context.message)
        out.message = s.length > MAX_PANEL_MESSAGE_CHARS ? null : context.message
      } catch {
        out.message = null
      }
    }
    return out
  }

  /** Read a redacted snapshot of recent history (for `history:read`). */
  private async readHistorySnapshot(): Promise<PluginHistorySnapshot[]> {
    try {
      const doc = await this.storage.get('history')
      return doc.entries.slice(0, HISTORY_LIMIT).map((e) => ({
        method: e.method,
        url: redactUrl(e.url),
        status: e.status,
        ok: e.ok,
        timeMs: e.timeMs,
        at: e.at
      }))
    } catch {
      return []
    }
  }

  /** Augment a base context with redacted history when the plugin can read it. */
  private async withHistory(info: PluginInfo, ctx: PluginEventContext): Promise<PluginEventContext> {
    const perms = effectivePermissions(info.manifest, info.granted, info.netAllowlist)
    if (!perms.includes('history:read')) return ctx
    return { ...ctx, history: await this.readHistorySnapshot() }
  }

  /* ---- dispatch ---- */

  private readMain(info: Pick<PluginInfo, 'dir' | 'manifest'>): string {
    const mainPath = join(info.dir, info.manifest.main ?? 'main.js')
    this.assertConfinedFile(mainPath)
    const size = statSync(mainPath).size
    if (size > MAIN_MAX_BYTES) throw new Error(`plugin main file is too large (max ${MAIN_MAX_BYTES / 1024} KB)`)
    return readFileSync(mainPath, 'utf8')
  }

  private recordRun(pluginId: string, event: PluginRunKind, startedAt: number, res: PluginRunResult): void {
    const lastRun: PluginLastRun = {
      at: startedAt,
      event,
      durationMs: Date.now() - startedAt,
      error: res.error,
      logs: res.logs.slice(-LAST_RUN_LOG_TAIL)
    }
    this.lastRuns.set(pluginId, lastRun)
    // Fine-grained event: the renderer merges it into the matching card. A
    // 'changed' broadcast here would force a full refetch+rescan per run AND
    // clobber config fields the user is typing (their persist is debounced).
    this.broadcast({ type: 'lastRun', pluginId, lastRun })
  }

  /** Attributed toast for fire-and-forget hook runs, deduplicated per plugin. */
  private emitHookToast(pluginId: string, name: string, message: string, kind: 'ok' | 'error'): void {
    const key = `${kind}|${message}`
    const now = Date.now()
    const prev = this.lastToasts.get(pluginId)
    if (prev && prev.key === key && now - prev.at < TOAST_DEDUPE_MS) return
    this.lastToasts.set(pluginId, { key, at: now })
    this.broadcast({ type: 'toast', pluginId, message: `Плагин ${name}: ${message}`, kind })
  }

  /** Build a fully-resolved sandbox payload for an enabled plugin (may throw). */
  private buildPayload(info: PluginInfo, event: PluginRunRequest['event'], context: PluginEventContext): PluginRunRequest {
    const permissions = effectivePermissions(info.manifest, info.granted, info.netAllowlist)
    const code = this.readMain(info)
    return {
      pluginId: info.manifest.id,
      code,
      permissions,
      config: this.resolveConfig(info.manifest, info.config),
      storage: permissions.includes('storage') ? { ...this.readStore(info.manifest.id) } : {},
      event,
      context: this.sanitizeContext(permissions, context)
    }
  }

  /** Run a built payload, persist its storage mutations + clipboard, record. */
  private async runDispatch(
    pluginId: string,
    eventKind: PluginRunKind,
    payload: PluginRunRequest,
    timeoutMs?: number
  ): Promise<PluginRunResult> {
    const startedAt = Date.now()
    const result = await runPluginInSandbox(payload, timeoutMs)
    this.applyStorageUpdates(pluginId, result.storageUpdates)
    if (typeof result.clipboardWrite === 'string') {
      try {
        clipboard.writeText(result.clipboardWrite)
      } catch (err) {
        console.error(`[plugins] ${pluginId} clipboard write failed:`, (err as Error).message)
      }
    }
    this.recordRun(pluginId, eventKind, startedAt, result)
    return result
  }

  /** Shared guard: resolve an enabled, non-broken plugin or an error result. */
  private async enabledPlugin(pluginId: string): Promise<PluginInfo | PluginRunResult> {
    const info = (await this.list()).find((i) => i.manifest.id === pluginId)
    if (!info) return { logs: [], error: 'Plugin not found' }
    if (info.error) return { logs: [], error: `Plugin is broken: ${info.error}` }
    if (!info.enabled) {
      return { logs: [], error: info.needsRegrant ? 'Plugin needs new permissions — re-enable it in Settings' : 'Plugin is disabled' }
    }
    return info
  }

  async invokeButton(pluginId: string, buttonId: string, context: PluginEventContext): Promise<PluginRunResult> {
    const got = await this.enabledPlugin(pluginId)
    if ('logs' in got) return got
    if (!got.manifest.contributes.buttons?.some((b) => b.id === buttonId)) {
      return { logs: [], error: `Unknown button "${buttonId}"` }
    }
    try {
      const ctx = await this.withHistory(got, context)
      return await this.runDispatch(pluginId, 'button', this.buildPayload(got, { type: 'button', buttonId }, ctx))
    } catch (err) {
      return { logs: [], error: (err as Error).message }
    }
  }

  async invokeCommand(pluginId: string, commandId: string, context: PluginEventContext): Promise<PluginRunResult> {
    const got = await this.enabledPlugin(pluginId)
    if ('logs' in got) return got
    if (!got.manifest.contributes.commands?.some((c) => c.id === commandId)) {
      return { logs: [], error: `Unknown command "${commandId}"` }
    }
    try {
      const ctx = await this.withHistory(got, context)
      return await this.runDispatch(pluginId, 'command', this.buildPayload(got, { type: 'command', commandId }, ctx))
    } catch (err) {
      return { logs: [], error: (err as Error).message }
    }
  }

  async invokePanel(pluginId: string, panelId: string, context: PluginEventContext): Promise<PluginRunResult> {
    const got = await this.enabledPlugin(pluginId)
    if ('logs' in got) return got
    if (!got.manifest.contributes.panels?.some((p) => p.id === panelId)) {
      return { logs: [], error: `Unknown panel "${panelId}"` }
    }
    try {
      const ctx = await this.withHistory(got, context)
      return await this.runDispatch(pluginId, 'panel', this.buildPayload(got, { type: 'panel', panelId }, ctx))
    } catch (err) {
      return { logs: [], error: (err as Error).message }
    }
  }

  /** Re-dispatch an interactive panel's postMessage to its handler with the
   *  message in `ctx.message`; the new `panelHtml` re-renders the iframe. */
  async panelMessage(
    pluginId: string,
    panelId: string,
    message: unknown,
    context: PluginEventContext
  ): Promise<PluginRunResult> {
    const got = await this.enabledPlugin(pluginId)
    if ('logs' in got) return got
    const panel = got.manifest.contributes.panels?.find((p) => p.id === panelId)
    if (!panel) return { logs: [], error: `Unknown panel "${panelId}"` }
    if (!panel.interactive) return { logs: [], error: `Panel "${panelId}" is not interactive` }
    // Cap the message payload so a chatty iframe can't bloat the dispatch.
    let safeMessage: unknown
    try {
      const s = JSON.stringify(message ?? null)
      safeMessage = s.length > MAX_PANEL_MESSAGE_CHARS ? null : JSON.parse(s)
    } catch {
      safeMessage = null
    }
    try {
      const ctx = await this.withHistory(got, { ...context, message: safeMessage })
      return await this.runDispatch(pluginId, 'panel', this.buildPayload(got, { type: 'panel', panelId }, ctx))
    } catch (err) {
      return { logs: [], error: (err as Error).message }
    }
  }

  /**
   * Run enabled `request`-event plugins (request:write) before send, threading
   * the patched spec through each in series. This BLOCKS the send (the hook may
   * change the request), so each plugin is bounded by a short per-hook timeout
   * — a slow/hung plugin is killed and skipped rather than stalling the user's
   * request for the full 15 s wall. `signal` aborts the remaining hooks when the
   * user cancels the request.
   */
  async runRequestHooks(spec: RequestSpec, signal?: AbortSignal): Promise<RequestSpec> {
    const infos = await this.list()
    const hooked = infos.filter(
      (i) =>
        i.enabled &&
        !i.error &&
        i.manifest.contributes.events?.includes('request') &&
        effectivePermissions(i.manifest, i.granted, i.netAllowlist).includes('request:write')
    )
    if (!hooked.length) return spec

    let current = spec
    const deadline = Date.now() + REQUEST_HOOKS_TOTAL_BUDGET_MS
    for (const info of hooked) {
      if (signal?.aborted) break
      // Stop once the aggregate budget is spent; each hook also gets at most the
      // remaining budget so the LAST hook can't extend the send past the cap.
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      try {
        const perms = effectivePermissions(info.manifest, info.granted, info.netAllowlist)
        const context: PluginEventContext = { request: requestSnapshotForPlugin(current.method, current.url, current.headers) }
        const result = await this.runDispatch(
          info.manifest.id,
          'request',
          this.buildPayload(info, { type: 'request' }, context),
          Math.min(PRE_REQUEST_HOOK_TIMEOUT_MS, remaining)
        )
        // A cross-origin retarget is honored only if this plugin holds net for
        // the new host (same gate as relay.fetch) — see applyRequestPatch.
        if (result.requestPatch) current = applyRequestPatch(current, result.requestPatch, perms)
        if (result.error) this.emitHookToast(info.manifest.id, info.manifest.name, result.error, 'error')
      } catch (err) {
        console.error(`[plugins] ${info.manifest.id} request hook: ${(err as Error).message}`)
      }
    }
    return current
  }

  /**
   * Run one plugin's `response` hook with per-plugin coalescing: while a run is
   * in flight, only the LATEST pending event is kept (the hook is best-effort
   * and lossy by design — a collection run must not pile up forks).
   *
   * The payload is built lazily, only when a fork is actually about to happen —
   * so the expensive parts (readMain's up-to-512 KB sync read + the ≤200 KB
   * context copy) never run for events that coalescing immediately discards.
   */
  private runHook(
    pluginId: string,
    name: string,
    kind: PluginRunKind,
    build: () => PluginRunRequest | null
  ): void {
    if (this.hookBusy.has(pluginId)) {
      this.hookPending.set(pluginId, { kind, build }) // last-wins; prior build dropped unbuilt
      return
    }
    let payload: PluginRunRequest | null
    try {
      payload = build()
    } catch (err) {
      console.error(`[plugins] ${pluginId}: ${(err as Error).message}`)
      payload = null
    }
    if (!payload) return

    this.hookBusy.add(pluginId)
    const startedAt = Date.now()
    void runPluginInSandbox(payload)
      .then((res) => {
        this.applyStorageUpdates(pluginId, res.storageUpdates)
        if (typeof res.clipboardWrite === 'string') {
          try {
            clipboard.writeText(res.clipboardWrite)
          } catch {
            /* ignore */
          }
        }
        this.recordRun(pluginId, kind, startedAt, res)
        if (res.toast) this.emitHookToast(pluginId, name, res.toast.message, res.toast.kind)
        // Surface hook failures — a silently broken automation is worse than a
        // toast. Dedupe keeps a failing-every-request plugin to one toast/10 s.
        else if (res.error) this.emitHookToast(pluginId, name, res.error, 'error')
        // A background hook that overwrote the clipboard MUST be visible (it
        // could swap a copied address) — the user didn't click anything.
        else if (typeof res.clipboardWrite === 'string') {
          this.emitHookToast(pluginId, name, 'записал в буфер обмена', 'ok')
        }
      })
      .finally(() => {
        this.hookBusy.delete(pluginId)
        const next = this.hookPending.get(pluginId)
        if (next) {
          this.hookPending.delete(pluginId)
          this.runHook(pluginId, name, next.kind, next.build)
        }
      })
  }

  /**
   * Fan a fire-and-forget lifecycle event out to every plugin that declared it,
   * with per-plugin coalescing. `baseContext` is pre-redacted per plugin in
   * buildPayload. History is fetched once up front when any subscriber can read it.
   */
  private dispatchLifecycle(
    eventName: 'response' | 'workspace' | 'collection',
    baseContext: PluginEventContext
  ): void {
    void (async () => {
      const infos = await this.list()
      const hooked = infos.filter((i) => i.enabled && !i.error && i.manifest.contributes.events?.includes(eventName))
      if (!hooked.length) return

      const wantsHistory = hooked.some((i) =>
        effectivePermissions(i.manifest, i.granted, i.netAllowlist).includes('history:read')
      )
      const ctx: PluginEventContext = wantsHistory
        ? { ...baseContext, history: await this.readHistorySnapshot() }
        : baseContext

      for (const info of hooked) {
        // Build lazily — readMain + sanitizeContext run only if this event is
        // actually forked, not when coalescing drops it (see runHook).
        this.runHook(info.manifest.id, info.manifest.name, eventName, () =>
          this.buildPayload(info, { type: eventName }, ctx)
        )
      }
    })().catch((err) => console.error(`[plugins] ${eventName} dispatch failed:`, err))
  }

  /**
   * Fire the `response` lifecycle hook. Called from the HTTP IPC layer after
   * every completed exchange; MUST never throw or delay the response path.
   * User-cancelled requests are skipped (an abort is not an "arrived response");
   * transport failures (status 0 + error) ARE dispatched — alerting plugins
   * legitimately want them.
   */
  dispatchResponseHook(spec: RequestSpec, result: ResponseResult): void {
    if (result.error?.kind === 'abort') return
    // setImmediate: even the synchronous prefix (cached-scan reads) must not
    // run inside the request:send IPC handler's response path.
    setImmediate(() =>
      this.dispatchLifecycle('response', {
        request: requestSnapshotForPlugin(spec.method, spec.url, spec.headers),
        response: responseSnapshotForPlugin(result)
      })
    )
  }

  /** Fire the `workspace` event after the active workspace switches. */
  private dispatchWorkspaceEvent(): void {
    const { workspaces, activeId } = this.storage.listWorkspaces()
    const ws = workspaces.find((w) => w.id === activeId)
    this.dispatchLifecycle('workspace', { workspace: ws ? { id: ws.id, name: ws.name } : { id: activeId, name: '' } })
  }

  /** Fire the `collection` event after the collections document changes. */
  private dispatchCollectionEvent(): void {
    this.dispatchLifecycle('collection', {})
  }

  /* ---- install / delete / folder ---- */

  async installSample(force = false): Promise<{ plugins: PluginInfo[]; existed: boolean }> {
    const dir = join(this.pluginsDir, SAMPLE_PLUGIN_ID)
    let exists = false
    try {
      const st = lstatSync(dir)
      if (st.isSymbolicLink()) throw new Error('plugin folder is a symlink — refusing to write')
      exists = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (exists && !force) return { plugins: await this.list(), existed: true }

    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(SAMPLE_PLUGIN_FILES)) {
      const target = join(dir, name)
      try {
        if (lstatSync(target).isSymbolicLink()) throw new Error(`${name} is a symlink — refusing to overwrite`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      writeFileSync(target, content, 'utf8')
    }
    this.invalidate()
    return { plugins: await this.list(), existed: false }
  }

  /**
   * Install a plugin from a `.zip` the user picks via a native dialog. The
   * archive must contain a valid `plugin.json` (with an `id`); files are written
   * into `plugins/<id>/`. A freshly-installed plugin always starts DISABLED with
   * NO grants — even when it reuses the id of an already-trusted plugin — so the
   * user must re-approve before any (possibly swapped) code runs.
   *
   * There is deliberately NO signature/"verified" claim: a signature in the
   * archive itself proves nothing without a pinned trust anchor (that needs a
   * hosted registry, see docs §11), so showing «подпись проверена» would be
   * misleading. We don't.
   */
  async installZip(): Promise<{ plugins: PluginInfo[]; id: string } | null> {
    const win = this.getWindow()
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Установить плагин из .zip',
      properties: ['openFile'],
      filters: [{ name: 'Plugin archive', extensions: ['zip'] }]
    })
    if (picked.canceled || !picked.filePaths.length) return null
    const zipPath = picked.filePaths[0]

    const ZIP_MAX_COMPRESSED = 8 * 1024 * 1024
    const ZIP_MAX_TOTAL_DECOMPRESSED = 16 * 1024 * 1024
    const ZIP_MAX_FILE_DECOMPRESSED = 4 * 1024 * 1024
    if (statSync(zipPath).size > ZIP_MAX_COMPRESSED) throw new Error('Архив слишком большой (макс 8 МБ)')

    // Bound the DECOMPRESSED size too (zip-bomb guard): fflate's filter exposes
    // each entry's declared original size before inflating; reject oversized
    // entries and abort once the running total exceeds the cap.
    let total = 0
    const files = unzipSync(readFileSync(zipPath), {
      filter: (f) => {
        if (f.originalSize > ZIP_MAX_FILE_DECOMPRESSED) throw new Error('Файл в архиве слишком большой')
        total += f.originalSize
        if (total > ZIP_MAX_TOTAL_DECOMPRESSED) throw new Error('Архив распаковывается в слишком большой объём')
        return true
      }
    })

    // Tolerate a single top-level folder in the archive (foo/plugin.json).
    const names = Object.keys(files)
    const manifestKey = names.find((n) => n === MANIFEST_FILE || n.endsWith(`/${MANIFEST_FILE}`))
    if (!manifestKey) throw new Error('В архиве нет plugin.json')
    const prefix = manifestKey.slice(0, manifestKey.length - MANIFEST_FILE.length) // '' or 'foo/'

    const dec = new TextDecoder()
    const manifestText = dec.decode(files[manifestKey])
    // The id is unknown until we read the manifest, so extract it, then run the
    // full validator binding it to that id (folder == id).
    let id: string
    try {
      id = JSON.parse(manifestText)?.id
    } catch {
      throw new Error('plugin.json — некорректный JSON')
    }
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new Error('Некорректный id плагина')
    const reparsed = parseManifest(manifestText, id)
    if (!reparsed.ok) throw new Error(`Некорректный манифест: ${reparsed.error}`)

    // Write the plugin files under plugins/<id>/, refusing path escapes/symlinks.
    const destDir = join(this.pluginsDir, id)
    try {
      if (lstatSync(destDir).isSymbolicLink()) throw new Error('Папка плагина — симлинк, отказ')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    mkdirSync(destDir, { recursive: true })
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith('/')) continue // directory entry
      // Only files UNDER the manifest's folder (drop siblings outside the prefix).
      if (prefix && !name.startsWith(prefix)) continue
      const rel = prefix ? name.slice(prefix.length) : name
      // Reject path escapes by SEGMENT (a '..' path component, an absolute path),
      // not by substring — so a legit name like 'config..bak.js' is not dropped.
      // The realpath-style join check below is the actual backstop.
      if (!rel || rel.startsWith('/') || rel.startsWith('\\')) continue
      if (rel.split(/[\\/]/).some((seg) => seg === '..')) continue
      const target = join(destDir, rel)
      if (target !== destDir && !target.startsWith(destDir + sep)) continue
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, Buffer.from(bytes))
    }

    // CRITICAL: a zip-installed plugin must start disabled with no grants, so a
    // same-id overwrite of a trusted plugin can't run new code under old grants.
    await this.mutateState((plugins) => {
      const idx = plugins.findIndex((e) => e.id === id)
      if (idx >= 0) plugins[idx] = { ...plugins[idx], enabled: false, granted: [] }
      return plugins
    })
    this.invalidate()
    return { plugins: await this.list(), id }
  }

  /** Delete the plugin folder and purge ALL its stored state (uninstall). */
  async delete(id: string): Promise<PluginInfo[]> {
    const d = this.ensureScan().find((x) => x.folder === id)
    // Purge every secret in the plugin's namespace — by prefix, so it works
    // even when the manifest is broken/unparseable and the key set is unknown.
    this.storage.secrets.deleteByPrefix(secretRef(id, ''))
    if (d) {
      try {
        await rm(d.dir, { recursive: true, force: true })
      } catch (err) {
        console.error('[plugins] failed to remove plugin dir:', (err as Error).message)
      }
    }
    // Drop the plugin-scoped KV store too.
    try {
      await rm(this.storeFile(id), { force: true })
    } catch {
      /* best effort */
    }
    this.storeCache.delete(id)
    await this.mutateState((plugins) => plugins.filter((e) => e.id !== id))
    this.lastRuns.delete(id)
    this.invalidate()
    return this.list()
  }

  async openFolder(): Promise<void> {
    await shell.openPath(this.pluginsDir)
  }

  /* ---- hot reload ---- */

  private broadcast(event: PluginsBroadcastEvent): void {
    try {
      this.getWindow()?.webContents.send(IPC.plugins.event, event)
    } catch (err) {
      console.error('[plugins] broadcast failed:', (err as Error).message)
    }
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* already closed */
      }
    }
    this.watchers = []
  }

  private armWatchers(): void {
    this.disposeWatchers()
    try {
      mkdirSync(this.pluginsDir, { recursive: true })
      // Recursive fs.watch is supported on macOS/Windows and on Linux since
      // Node 20 (Electron ≥ 28 ships it), so one watcher covers everything.
      const w = watch(this.pluginsDir, { recursive: true }, () => this.onFsEvent())
      // Without an 'error' handler a watcher failure (e.g. the dir being
      // deleted on Windows → EPERM) is an unhandled exception in main.
      w.on('error', (err) => {
        console.error('[plugins] watcher failed, re-arming:', (err as Error).message)
        this.disposeWatchers()
        setTimeout(() => {
          this.armWatchers()
          this.invalidate()
          this.broadcast({ type: 'changed' })
        }, 1000)
      })
      this.watchers.push(w)
    } catch (err) {
      console.error('[plugins] failed to watch plugins dir:', (err as Error).message)
    }
  }

  private onFsEvent(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      this.invalidate()
      this.broadcast({ type: 'changed' })
    }, WATCH_DEBOUNCE_MS)
  }

  startWatching(): void {
    this.armWatchers()
    // Lifecycle event sources: workspace switch + collections save.
    this.lifecycleUnsubs.push(this.storage.onWorkspaceSwitch(() => this.dispatchWorkspaceEvent()))
    this.lifecycleUnsubs.push(
      this.storage.onSave((key) => {
        if (key === 'collections') this.dispatchCollectionEvent()
      })
    )
  }

  dispose(): void {
    for (const un of this.lifecycleUnsubs) {
      try {
        un()
      } catch {
        /* ignore */
      }
    }
    this.lifecycleUnsubs = []
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = null
    this.disposeWatchers()
  }
}

export function registerPluginHandlers(
  ipcMain: IpcMain,
  storage: StorageManager,
  getWindow: () => BrowserWindow | null
): PluginManager {
  const manager = new PluginManager(storage, getWindow)

  ipcMain.handle(IPC.plugins.list, async () => {
    // The renderer's list/«Обновить» is the escape hatch when a watcher event
    // was missed — always serve a fresh scan here (it is cheap and rare).
    manager.invalidate()
    return manager.list()
  })
  ipcMain.handle(IPC.plugins.setEnabled, async (_e, id: string, enabled: boolean) => {
    if (typeof id !== 'string') throw new Error('Invalid plugin id')
    return manager.setEnabled(id, !!enabled)
  })
  ipcMain.handle(IPC.plugins.setConfig, async (_e, id: string, config: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid plugin id')
    await manager.setConfig(id, config)
  })
  ipcMain.handle(IPC.plugins.setSecret, async (_e, id: string, key: string, value: string) => {
    if (typeof id !== 'string' || typeof key !== 'string') throw new Error('Invalid plugin secret')
    return manager.setSecret(id, key, typeof value === 'string' ? value : '')
  })
  ipcMain.handle(IPC.plugins.setNetAllowlist, async (_e, id: string, hosts: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid plugin id')
    return manager.setNetAllowlist(id, hosts)
  })
  ipcMain.handle(
    IPC.plugins.invokeButton,
    async (_e, pluginId: string, buttonId: string, context: PluginEventContext): Promise<PluginRunResult> => {
      if (typeof pluginId !== 'string' || typeof buttonId !== 'string') {
        return { logs: [], error: 'Invalid plugin invocation' }
      }
      return manager.invokeButton(pluginId, buttonId, context)
    }
  )
  ipcMain.handle(
    IPC.plugins.invokePanel,
    async (_e, pluginId: string, panelId: string, context: PluginEventContext): Promise<PluginRunResult> => {
      if (typeof pluginId !== 'string' || typeof panelId !== 'string') {
        return { logs: [], error: 'Invalid plugin invocation' }
      }
      return manager.invokePanel(pluginId, panelId, context)
    }
  )
  ipcMain.handle(
    IPC.plugins.panelMessage,
    async (_e, pluginId: string, panelId: string, message: unknown, context: PluginEventContext): Promise<PluginRunResult> => {
      if (typeof pluginId !== 'string' || typeof panelId !== 'string') {
        return { logs: [], error: 'Invalid plugin invocation' }
      }
      return manager.panelMessage(pluginId, panelId, message, context)
    }
  )
  ipcMain.handle(
    IPC.plugins.invokeCommand,
    async (_e, pluginId: string, commandId: string, context: PluginEventContext): Promise<PluginRunResult> => {
      if (typeof pluginId !== 'string' || typeof commandId !== 'string') {
        return { logs: [], error: 'Invalid plugin invocation' }
      }
      return manager.invokeCommand(pluginId, commandId, context)
    }
  )
  ipcMain.handle(IPC.plugins.openFolder, async () => manager.openFolder())
  ipcMain.handle(IPC.plugins.installSample, async (_e, force?: boolean) => manager.installSample(!!force))
  ipcMain.handle(IPC.plugins.installZip, async () => manager.installZip())
  ipcMain.handle(IPC.plugins.delete, async (_e, id: string) => {
    if (typeof id !== 'string') throw new Error('Invalid plugin id')
    return manager.delete(id)
  })

  manager.startWatching()
  // Close fs watchers + workspace/collection listeners on quit so they don't
  // outlive the app (the sandbox children are reaped separately by stopPluginSandbox).
  app.on('will-quit', () => manager.dispose())
  return manager
}

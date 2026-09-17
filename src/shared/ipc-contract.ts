/**
 * The single source of truth for the renderer <-> main boundary.
 *
 * `RelayApi` is the exact shape exposed on `window.api` by the preload's
 * contextBridge. Main implements handlers for each channel; the renderer only
 * ever touches `window.api` (never `ipcRenderer`).
 */
import type {
  AiChatStart,
  AiStreamEvent,
  CollectionsDoc,
  CookiesDoc,
  EnvironmentsDoc,
  FilePickResult,
  GlobalsDoc,
  GrpcInvokeSpec,
  GrpcParseResult,
  GrpcReflectSpec,
  GraphqlIntrospectResult,
  HistoryDoc,
  ImportKind,
  ImportResult,
  OAuthDeviceRequest,
  OAuthDeviceResult,
  ModelInfo,
  OAuthTokenRequest,
  OAuthTokenResult,
  PluginEventContext,
  PluginInfo,
  PluginRunResult,
  PluginsBroadcastEvent,
  PluginsStateDoc,
  ProvidersDoc,
  MqttConnectSpec,
  RealtimeEvent,
  RequestSpec,
  ResponseResult,
  RunOptions,
  ScriptRunRequest,
  ScriptRunResult,
  SettingsDoc,
  SqliteImportSummary,
  SqliteSnapshot,
  SocketIoConnectSpec,
  SseConnectSpec,
  StoredCookie,
  TabsDoc,
  WorkspaceMeta,
  WsConnectSpec
} from './types'
import type { FeaturePluginInfo } from './features'

/** Persisted enable/disable state of the bundled feature plugins (app-level). */
export interface FeaturePluginsDoc {
  version: number
  /** plugin id -> enabled; a missing id means disabled (packs are opt-in) */
  enabled: Record<string, boolean>
  /** mtime of the install-config.json whose pack selection was already applied */
  appliedInstall?: number
}

/** Channel names, grouped. Use these constants on both ends. */
export const IPC = {
  request: {
    send: 'request:send',
    cancel: 'request:cancel'
  },
  ai: {
    chat: 'ai:chat',
    cancel: 'ai:cancel',
    listModels: 'ai:listModels',
    /** event channel suffix; full channel = `${ai.event}:${streamId}` */
    event: 'ai:chat:event'
  },
  secrets: {
    set: 'secrets:set',
    has: 'secrets:has',
    delete: 'secrets:delete',
    available: 'secrets:available'
  },
  storage: {
    load: 'storage:load',
    save: 'storage:save',
    /** main → other windows after a save, so every window shows the same data */
    changed: 'storage:changed'
  },
  panes: {
    detach: 'panes:detach',
    attach: 'panes:attach',
    focus: 'panes:focus',
    putSnapshot: 'panes:putSnapshot',
    takeSnapshot: 'panes:takeSnapshot',
    /** main → main window when a detached pane window closed (payload: tabId) */
    closed: 'panes:closed',
    nudge: 'panes:nudge',
    list: 'panes:list'
  },
  data: {
    import: 'data:import',
    export: 'data:export'
  },
  script: {
    run: 'script:run'
  },
  oauth: {
    token: 'oauth:token',
    device: 'oauth:device'
  },
  graphql: {
    introspect: 'graphql:introspect'
  },
  cookies: {
    get: 'cookies:get',
    set: 'cookies:set',
    delete: 'cookies:delete',
    clear: 'cookies:clear'
  },
  realtime: {
    wsConnect: 'realtime:wsConnect',
    wsSend: 'realtime:wsSend',
    wsClose: 'realtime:wsClose',
    sseConnect: 'realtime:sseConnect',
    sseClose: 'realtime:sseClose',
    socketioConnect: 'realtime:socketioConnect',
    socketioEmit: 'realtime:socketioEmit',
    socketioClose: 'realtime:socketioClose',
    mqttConnect: 'realtime:mqttConnect',
    mqttPublish: 'realtime:mqttPublish',
    mqttSubscribe: 'realtime:mqttSubscribe',
    mqttClose: 'realtime:mqttClose',
    /** event channel suffix; full channel = `${realtime.event}:${connId}` */
    event: 'realtime:event'
  },
  grpc: {
    parse: 'grpc:parse',
    invoke: 'grpc:invoke',
    send: 'grpc:send',
    end: 'grpc:end',
    cancel: 'grpc:cancel',
    reflect: 'grpc:reflect',
    /** event channel suffix; full channel = `${grpc.event}:${connId}` */
    event: 'grpc:event'
  },
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    rename: 'workspace:rename',
    delete: 'workspace:delete',
    switch: 'workspace:switch'
  },
  /** feature plugins bundled with the app (declarative capability packs) */
  features: {
    list: 'features:list',
    setEnabled: 'features:setEnabled',
    locale: 'features:locale',
    install: 'features:install',
    remove: 'features:remove',
    openFolder: 'features:openFolder',
    /** broadcast: the enabled set changed (sent to every window) */
    changed: 'features:changed'
  },
  plugins: {
    list: 'plugins:list',
    setEnabled: 'plugins:setEnabled',
    setConfig: 'plugins:setConfig',
    setSecret: 'plugins:setSecret',
    setNetAllowlist: 'plugins:setNetAllowlist',
    invokeButton: 'plugins:invokeButton',
    invokePanel: 'plugins:invokePanel',
    panelMessage: 'plugins:panelMessage',
    invokeCommand: 'plugins:invokeCommand',
    openFolder: 'plugins:openFolder',
    installSample: 'plugins:installSample',
    installZip: 'plugins:installZip',
    delete: 'plugins:delete',
    /** broadcast channel: hot-reload + hook toasts (no per-id suffix) */
    event: 'plugins:event'
  },
  sqlite: {
    export: 'sqlite:export',
    import: 'sqlite:import'
  },
  dialog: {
    openFile: 'dialog:openFile',
    saveFile: 'dialog:saveFile',
    readFile: 'dialog:readFile',
    readBinary: 'dialog:readBinary'
  },
  app: {
    platform: 'app:platform',
    themeChanged: 'app:themeChanged',
    windowMaximized: 'app:windowMaximized',
    minimize: 'app:minimize',
    maximize: 'app:maximize',
    close: 'app:close',
    openExternal: 'app:openExternal',
    getVersion: 'app:getVersion'
  },
  update: {
    check: 'update:check'
  }
} as const

/**
 * Result of asking GitHub Releases for the latest version. Never a rejected
 * promise — network/parse failures come back as `ok: false` with a short
 * machine-readable error string.
 */
export type UpdateCheckResult =
  | {
      ok: true
      currentVersion: string
      latestVersion: string
      updateAvailable: boolean
      url: string
      /** where the version came from: a published release or a plain git tag */
      source: 'release' | 'tag'
      /** release publication date (ISO), when the source is a release */
      publishedAt?: string
      /** release notes, trimmed; only for releases that carry a body */
      notes?: string
    }
  | { ok: false; error: UpdateCheckError }

/**
 * Why a check could not produce a version.
 * `no-releases` is a normal state for a fresh repository, not a failure of the
 * app — the UI says so instead of blaming the network.
 */
export type UpdateCheckError = 'no-releases' | 'rate-limit' | 'timeout' | 'network' | 'ipc' | 'web-mode' | `http-${number}`

/** Type-safe map of persisted documents keyed by storage name. */
export interface StorageMap {
  collections: CollectionsDoc
  environments: EnvironmentsDoc
  globals: GlobalsDoc
  history: HistoryDoc
  tabs: TabsDoc
  settings: SettingsDoc
  providers: ProvidersDoc
  cookies: CookiesDoc
  plugins: PluginsStateDoc
  features: FeaturePluginsDoc
}

export type StorageKey = keyof StorageMap

export interface SaveFileOptions {
  defaultName?: string
  /** text content, or base64 when `base64` is true */
  content: string
  base64?: boolean
  filters?: { name: string; extensions: string[] }[]
}

export interface OpenFileOptions {
  multiple?: boolean
  filters?: { name: string; extensions: string[] }[]
}

/**
 * The exact surface exposed as `window.api`. Implemented by preload,
 * consumed (typed) by the renderer.
 */
export interface RelayApi {
  /* ---- platform ---- */
  platform: NodeJS.Platform | string

  /* ---- HTTP engine ---- */
  sendRequest(spec: RequestSpec, opts: RunOptions): Promise<ResponseResult>
  cancelRequest(requestId: string): Promise<void>

  /* ---- AI ---- */
  aiChat(payload: AiChatStart): Promise<void>
  aiCancel(streamId: string): Promise<void>
  aiListModels(providerId: string): Promise<ModelInfo[]>
  /** Subscribe to stream events for a given streamId. Returns an unsubscribe fn. */
  onAiStream(streamId: string, cb: (event: AiStreamEvent) => void): () => void

  /* ---- secrets (safeStorage) ---- */
  secretsSet(ref: string, value: string): Promise<{ ref: string }>
  secretsHas(ref: string): Promise<boolean>
  secretsDelete(ref: string): Promise<void>
  secretsAvailable(): Promise<boolean>

  /* ---- storage ---- */
  storageLoad<K extends StorageKey>(key: K): Promise<StorageMap[K] | null>
  storageSave<K extends StorageKey>(key: K, value: StorageMap[K]): Promise<void>
  /** A document was saved by ANOTHER window. Returns an unsubscribe fn. */
  onStorageChanged(cb: <K extends StorageKey>(key: K, value: StorageMap[K]) => void): () => void

  /* ---- detached panes (one request per separate OS window) ---- */
  /** Open (or focus) a separate window showing only this tab. */
  paneDetach(tabId: string, title: string): Promise<void>
  /** Close the tab's separate window (the tab returns to the main window). */
  paneAttach(tabId: string): Promise<void>
  paneFocus(tabId: string): Promise<void>
  /** Tabs currently shown in separate windows (main window re-syncs after a reload). */
  paneList(): Promise<string[]>
  /** Hand a tab's volatile response state to the window that shows it next. */
  panePutSnapshot(tabId: string, snapshot: unknown): void
  paneTakeSnapshot(tabId: string): Promise<unknown>
  /** Main window: a detached pane window was closed. Returns an unsubscribe fn. */
  onPaneClosed(cb: (tabId: string) => void): () => void
  /** Move/resize the calling window by a pixel delta (keyboard pane control). */
  windowNudge(dx: number, dy: number, dw: number, dh: number): Promise<void>

  /* ---- import / export ---- */
  importData(kind: ImportKind, text: string): Promise<ImportResult[]>
  exportCollection(collectionJson: string): Promise<string>

  /* ---- scripting (P1) ---- */
  runScript(payload: ScriptRunRequest): Promise<ScriptRunResult>

  /* ---- oauth (P1) ---- */
  oauthToken(payload: OAuthTokenRequest): Promise<OAuthTokenResult>
  /** Device Authorization Grant — step 1 (RFC 8628). */
  oauthDevice(payload: OAuthDeviceRequest): Promise<OAuthDeviceResult>

  /* ---- GraphQL ---- */
  /** Introspect a GraphQL endpoint's schema (for docs + autocomplete). */
  graphqlIntrospect(url: string, headers: { key: string; value: string }[], rejectUnauthorized: boolean): Promise<GraphqlIntrospectResult>

  /* ---- cookies (persistent jar) ---- */
  cookiesGet(): Promise<StoredCookie[]>
  /** upsert by (domain, path, key) */
  cookiesSet(cookie: StoredCookie): Promise<void>
  cookiesDelete(cookie: Pick<StoredCookie, 'domain' | 'path' | 'key'>): Promise<void>
  /** clear all, or just one domain when `domain` is given */
  cookiesClear(domain?: string): Promise<void>

  /* ---- realtime: WebSocket + SSE ---- */
  wsConnect(spec: WsConnectSpec): Promise<void>
  wsSend(connId: string, data: string): Promise<void>
  wsClose(connId: string): Promise<void>
  sseConnect(spec: SseConnectSpec): Promise<void>
  sseClose(connId: string): Promise<void>
  socketioConnect(spec: SocketIoConnectSpec): Promise<void>
  socketioEmit(connId: string, event: string, data: string): Promise<void>
  socketioClose(connId: string): Promise<void>
  mqttConnect(spec: MqttConnectSpec): Promise<void>
  mqttPublish(connId: string, topic: string, payload: string): Promise<void>
  mqttSubscribe(connId: string, topic: string): Promise<void>
  mqttClose(connId: string): Promise<void>
  /** Subscribe to events for a connection. Returns an unsubscribe fn. */
  onRealtime(connId: string, cb: (event: RealtimeEvent) => void): () => void

  /* ---- gRPC ---- */
  /** Parse a .proto document into its services/methods (no network). */
  grpcParse(proto: string): Promise<GrpcParseResult>
  /** Start a gRPC call; results stream over the grpc event channel. */
  grpcInvoke(spec: GrpcInvokeSpec): Promise<void>
  /** Write a message into a client-/bidi-streaming call. */
  grpcSend(connId: string, message: string): Promise<void>
  /** Half-close (finish sending) a client-/bidi-streaming call. */
  grpcEnd(connId: string): Promise<void>
  /** Cancel an in-flight call. */
  grpcCancel(connId: string): Promise<void>
  /** Discover services/methods from a live server via Server Reflection. */
  grpcReflect(spec: GrpcReflectSpec): Promise<GrpcParseResult>
  /** Subscribe to gRPC events for a call. Returns an unsubscribe fn. */
  onGrpc(connId: string, cb: (event: RealtimeEvent) => void): () => void

  /* ---- feature plugins bundled in `plugins/` (docs/PLUGINS.md §10) ---- */
  featuresList(): Promise<FeaturePluginInfo[]>
  /** Turn a bundled feature pack on or off. Returns the updated list. */
  featuresSetEnabled(id: string, enabled: boolean): Promise<FeaturePluginInfo[]>
  /** Read one UI locale catalog contributed by an enabled language pack. */
  featuresLocale(code: string): Promise<Record<string, string> | null>
  /** Reveal the bundled plugins folder; false when it is missing. */
  featuresOpenFolder(): Promise<boolean>
  /**
   * Pick a plugin anywhere on disk and add it: a capability pack's folder (or
   * its `plugin.json`), or a `.zip` holding either a pack or a code plugin.
   * The dialog opens in the app's `plugins` folder. Null = cancelled.
   */
  featuresInstall(): Promise<
    | { ok: true; kind: 'pack'; id: string; list: FeaturePluginInfo[] }
    | { ok: true; kind: 'plugin'; id: string }
    | { ok: false; error: string }
    | null
  >
  /** Take a pack out of the app (its folder stays in `plugins/`). */
  featuresRemove(id: string): Promise<FeaturePluginInfo[]>
  /** Subscribe to enable/disable changes made in any window. Returns an unsubscribe fn. */
  onFeaturesChanged(cb: (list: FeaturePluginInfo[]) => void): () => void

  /* ---- plugins (docs/PLUGINS.md) ---- */
  pluginsList(): Promise<PluginInfo[]>
  /** Enable (= grant the manifest permissions) or disable a plugin. Returns the updated list. */
  pluginsSetEnabled(id: string, enabled: boolean): Promise<PluginInfo[]>
  /** Persist non-secret string config values. */
  pluginsSetConfig(id: string, config: Record<string, string>): Promise<void>
  /** Set/clear a secret config value (stored in safeStorage; '' clears). Returns the updated list. */
  pluginsSetSecret(id: string, key: string, value: string): Promise<PluginInfo[]>
  /** Narrow a broad `net` grant to a host allowlist ([] = no restriction). Returns the updated list. */
  pluginsSetNetAllowlist(id: string, hosts: string[]): Promise<PluginInfo[]>
  /** Run a contributed button's handler in the plugin sandbox. */
  pluginsInvokeButton(pluginId: string, buttonId: string, context: PluginEventContext): Promise<PluginRunResult>
  /** Run a contributed panel's handler; the result's `panelHtml` is rendered in a sandboxed iframe. */
  pluginsInvokePanel(pluginId: string, panelId: string, context: PluginEventContext): Promise<PluginRunResult>
  /** Re-dispatch an interactive panel's `postMessage` to its handler; returns the new `panelHtml`. */
  pluginsPanelMessage(pluginId: string, panelId: string, message: unknown, context: PluginEventContext): Promise<PluginRunResult>
  /** Run a contributed command (from the palette) with the active tab's context. */
  pluginsInvokeCommand(pluginId: string, commandId: string, context: PluginEventContext): Promise<PluginRunResult>
  pluginsOpenFolder(): Promise<void>
  /**
   * Write the bundled sample plugin into the plugins folder. When the folder
   * already exists and `force` is false, nothing is written (`existed: true`).
   */
  pluginsInstallSample(force?: boolean): Promise<{ plugins: PluginInfo[]; existed: boolean }>
  /** Install a plugin from a `.zip` the user picks via a native dialog (no
   *  renderer-supplied path). The plugin starts DISABLED. Null when cancelled. */
  pluginsInstallZip(): Promise<{ plugins: PluginInfo[]; id: string } | null>
  /** Delete a plugin's folder and purge its stored state. Returns the updated list. */
  pluginsDelete(id: string): Promise<PluginInfo[]>
  /** Subscribe to plugin broadcasts (hot-reload, hook toasts). Returns an unsubscribe fn. */
  onPluginsEvent(cb: (event: PluginsBroadcastEvent) => void): () => void

  /* ---- local workspaces ---- */
  workspaceList(): Promise<{ workspaces: WorkspaceMeta[]; activeId: string }>
  workspaceCreate(name: string): Promise<WorkspaceMeta>
  workspaceRename(id: string, name: string): Promise<void>
  workspaceDelete(id: string): Promise<void>
  workspaceSwitch(id: string): Promise<void>

  /* ---- SQLite backup (optional, pure-WASM) ---- */
  /** Build a .sqlite of the snapshot; returns base64 bytes to save via the dialog. */
  sqliteExport(snapshot: SqliteSnapshot): Promise<string>
  /** Read a user-picked .sqlite path; returns the parsed snapshot + counts. */
  sqliteImport(path: string): Promise<{ snapshot: SqliteSnapshot; summary: SqliteImportSummary }>

  /* ---- dialogs / fs ---- */
  openFile(opts: OpenFileOptions): Promise<FilePickResult[] | null>
  saveFile(opts: SaveFileOptions): Promise<string | null>
  /** Read a UTF-8 text file the user picked (for runner data files). Size-capped in main. */
  readTextFile(path: string): Promise<string>
  /** Read a user-picked file as base64 (binary backups). Same size cap as text. */
  readBinaryFile(path: string): Promise<string>

  /* ---- window controls (frameless) ---- */
  minimizeWindow(): Promise<void>
  maximizeWindow(): Promise<void>
  closeWindow(): Promise<void>

  /* ---- updates ---- */
  getAppVersion(): Promise<string>
  /** Check GitHub Releases for a newer version. Resolves, never rejects. */
  checkUpdates(): Promise<UpdateCheckResult>

  /* ---- misc ---- */
  openExternal(url: string): Promise<void>
  onNativeThemeChange(cb: (theme: 'light' | 'dark') => void): () => void
  /** Window maximized/restored — the titlebar button mirrors the real state. */
  onWindowMaximized(cb: (maximized: boolean) => void): () => void
}

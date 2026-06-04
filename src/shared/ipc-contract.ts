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
  HistoryDoc,
  ImportKind,
  ImportResult,
  ModelInfo,
  OAuthTokenRequest,
  OAuthTokenResult,
  ProvidersDoc,
  RequestSpec,
  ResponseResult,
  RunOptions,
  ScriptRunRequest,
  ScriptRunResult,
  SettingsDoc,
  TabsDoc
} from './types'

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
    save: 'storage:save'
  },
  data: {
    import: 'data:import',
    export: 'data:export'
  },
  script: {
    run: 'script:run'
  },
  oauth: {
    token: 'oauth:token'
  },
  dialog: {
    openFile: 'dialog:openFile',
    saveFile: 'dialog:saveFile'
  },
  app: {
    platform: 'app:platform',
    themeChanged: 'app:themeChanged',
    minimize: 'app:minimize',
    maximize: 'app:maximize',
    close: 'app:close',
    openExternal: 'app:openExternal'
  }
} as const

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

  /* ---- import / export ---- */
  importData(kind: ImportKind, text: string): Promise<ImportResult[]>
  exportCollection(collectionJson: string): Promise<string>

  /* ---- scripting (P1) ---- */
  runScript(payload: ScriptRunRequest): Promise<ScriptRunResult>

  /* ---- oauth (P1) ---- */
  oauthToken(payload: OAuthTokenRequest): Promise<OAuthTokenResult>

  /* ---- dialogs / fs ---- */
  openFile(opts: OpenFileOptions): Promise<FilePickResult[] | null>
  saveFile(opts: SaveFileOptions): Promise<string | null>

  /* ---- window controls (frameless) ---- */
  minimizeWindow(): Promise<void>
  maximizeWindow(): Promise<void>
  closeWindow(): Promise<void>

  /* ---- misc ---- */
  openExternal(url: string): Promise<void>
  onNativeThemeChange(cb: (theme: 'light' | 'dark') => void): () => void
}

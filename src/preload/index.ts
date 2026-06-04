import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { OpenFileOptions, RelayApi, SaveFileOptions, StorageKey, StorageMap } from '@shared/ipc-contract'
import type {
  AiChatStart,
  AiStreamEvent,
  ImportKind,
  OAuthTokenRequest,
  RequestSpec,
  RunOptions,
  ScriptRunRequest
} from '@shared/types'

/**
 * The ONLY bridge between renderer and main. Exposes a typed, minimal surface.
 * No raw ipcRenderer or Node globals leak into the renderer.
 */
const api: RelayApi = {
  platform: process.platform,

  /* ---- HTTP ---- */
  sendRequest: (spec: RequestSpec, opts: RunOptions) => ipcRenderer.invoke(IPC.request.send, spec, opts),
  cancelRequest: (requestId: string) => ipcRenderer.invoke(IPC.request.cancel, requestId),

  /* ---- AI ---- */
  aiChat: (payload: AiChatStart) => ipcRenderer.invoke(IPC.ai.chat, payload),
  aiCancel: (streamId: string) => {
    // main registers cancel with ipcMain.on (fire-and-forget).
    ipcRenderer.send(IPC.ai.cancel, streamId)
    return Promise.resolve()
  },
  aiListModels: (providerId: string) => ipcRenderer.invoke(IPC.ai.listModels, providerId),
  onAiStream: (streamId: string, cb: (event: AiStreamEvent) => void) => {
    const channel = `${IPC.ai.event}:${streamId}`
    const handler = (_e: unknown, event: AiStreamEvent) => cb(event)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /* ---- secrets ---- */
  secretsSet: (ref: string, value: string) => ipcRenderer.invoke(IPC.secrets.set, ref, value),
  secretsHas: (ref: string) => ipcRenderer.invoke(IPC.secrets.has, ref),
  secretsDelete: (ref: string) => ipcRenderer.invoke(IPC.secrets.delete, ref),
  secretsAvailable: () => ipcRenderer.invoke(IPC.secrets.available),

  /* ---- storage ---- */
  storageLoad: <K extends StorageKey>(key: K) =>
    ipcRenderer.invoke(IPC.storage.load, key) as Promise<StorageMap[K] | null>,
  storageSave: <K extends StorageKey>(key: K, value: StorageMap[K]) =>
    ipcRenderer.invoke(IPC.storage.save, key, value) as Promise<void>,

  /* ---- import / export ---- */
  importData: (kind: ImportKind, text: string) => ipcRenderer.invoke(IPC.data.import, kind, text),
  exportCollection: (collectionJson: string) => ipcRenderer.invoke(IPC.data.export, collectionJson),

  /* ---- scripting ---- */
  runScript: (payload: ScriptRunRequest) => ipcRenderer.invoke(IPC.script.run, payload),

  /* ---- oauth ---- */
  oauthToken: (payload: OAuthTokenRequest) => ipcRenderer.invoke(IPC.oauth.token, payload),

  /* ---- dialogs / fs ---- */
  openFile: (opts: OpenFileOptions) => ipcRenderer.invoke(IPC.dialog.openFile, opts),
  saveFile: (opts: SaveFileOptions) => ipcRenderer.invoke(IPC.dialog.saveFile, opts),

  /* ---- window controls ---- */
  minimizeWindow: () => ipcRenderer.invoke(IPC.app.minimize),
  maximizeWindow: () => ipcRenderer.invoke(IPC.app.maximize),
  closeWindow: () => ipcRenderer.invoke(IPC.app.close),

  /* ---- misc ---- */
  openExternal: (url: string) => ipcRenderer.invoke(IPC.app.openExternal, url),
  onNativeThemeChange: (cb: (theme: 'light' | 'dark') => void) => {
    const handler = (_e: unknown, theme: 'light' | 'dark') => cb(theme)
    ipcRenderer.on(IPC.app.themeChanged, handler)
    return () => ipcRenderer.removeListener(IPC.app.themeChanged, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

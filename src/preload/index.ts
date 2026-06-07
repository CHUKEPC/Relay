import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { OpenFileOptions, RelayApi, SaveFileOptions, StorageKey, StorageMap } from '@shared/ipc-contract'
import type {
  AiChatStart,
  AiStreamEvent,
  GrpcInvokeSpec,
  ImportKind,
  MqttConnectSpec,
  OAuthTokenRequest,
  RealtimeEvent,
  RequestSpec,
  RunOptions,
  ScriptRunRequest,
  SocketIoConnectSpec,
  SseConnectSpec,
  StoredCookie,
  WsConnectSpec
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

  /* ---- cookies ---- */
  cookiesGet: () => ipcRenderer.invoke(IPC.cookies.get),
  cookiesSet: (cookie: StoredCookie) => ipcRenderer.invoke(IPC.cookies.set, cookie),
  cookiesDelete: (cookie: Pick<StoredCookie, 'domain' | 'path' | 'key'>) =>
    ipcRenderer.invoke(IPC.cookies.delete, cookie),
  cookiesClear: (domain?: string) => ipcRenderer.invoke(IPC.cookies.clear, domain),

  /* ---- realtime: WebSocket + SSE ---- */
  wsConnect: (spec: WsConnectSpec) => ipcRenderer.invoke(IPC.realtime.wsConnect, spec),
  wsSend: (connId: string, data: string) => ipcRenderer.invoke(IPC.realtime.wsSend, connId, data),
  wsClose: (connId: string) => ipcRenderer.invoke(IPC.realtime.wsClose, connId),
  sseConnect: (spec: SseConnectSpec) => ipcRenderer.invoke(IPC.realtime.sseConnect, spec),
  sseClose: (connId: string) => ipcRenderer.invoke(IPC.realtime.sseClose, connId),
  socketioConnect: (spec: SocketIoConnectSpec) => ipcRenderer.invoke(IPC.realtime.socketioConnect, spec),
  socketioEmit: (connId: string, event: string, data: string) =>
    ipcRenderer.invoke(IPC.realtime.socketioEmit, connId, event, data),
  socketioClose: (connId: string) => ipcRenderer.invoke(IPC.realtime.socketioClose, connId),
  mqttConnect: (spec: MqttConnectSpec) => ipcRenderer.invoke(IPC.realtime.mqttConnect, spec),
  mqttPublish: (connId: string, topic: string, payload: string) =>
    ipcRenderer.invoke(IPC.realtime.mqttPublish, connId, topic, payload),
  mqttSubscribe: (connId: string, topic: string) => ipcRenderer.invoke(IPC.realtime.mqttSubscribe, connId, topic),
  mqttClose: (connId: string) => ipcRenderer.invoke(IPC.realtime.mqttClose, connId),
  onRealtime: (connId: string, cb: (event: RealtimeEvent) => void) => {
    const channel = `${IPC.realtime.event}:${connId}`
    const handler = (_e: unknown, event: RealtimeEvent) => cb(event)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /* ---- gRPC ---- */
  grpcParse: (proto: string) => ipcRenderer.invoke(IPC.grpc.parse, proto),
  grpcInvoke: (spec: GrpcInvokeSpec) => ipcRenderer.invoke(IPC.grpc.invoke, spec),
  grpcSend: (connId: string, message: string) => ipcRenderer.invoke(IPC.grpc.send, connId, message),
  grpcEnd: (connId: string) => ipcRenderer.invoke(IPC.grpc.end, connId),
  grpcCancel: (connId: string) => ipcRenderer.invoke(IPC.grpc.cancel, connId),
  onGrpc: (connId: string, cb: (event: RealtimeEvent) => void) => {
    const channel = `${IPC.grpc.event}:${connId}`
    const handler = (_e: unknown, event: RealtimeEvent) => cb(event)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /* ---- local workspaces ---- */
  workspaceList: () => ipcRenderer.invoke(IPC.workspace.list),
  workspaceCreate: (name: string) => ipcRenderer.invoke(IPC.workspace.create, name),
  workspaceRename: (id: string, name: string) => ipcRenderer.invoke(IPC.workspace.rename, id, name),
  workspaceDelete: (id: string) => ipcRenderer.invoke(IPC.workspace.delete, id),
  workspaceSwitch: (id: string) => ipcRenderer.invoke(IPC.workspace.switch, id),

  /* ---- SQLite backup ---- */
  sqliteExport: (snapshot) => ipcRenderer.invoke(IPC.sqlite.export, snapshot),
  sqliteImport: (path: string) => ipcRenderer.invoke(IPC.sqlite.import, path),

  /* ---- dialogs / fs ---- */
  openFile: (opts: OpenFileOptions) => ipcRenderer.invoke(IPC.dialog.openFile, opts),
  saveFile: (opts: SaveFileOptions) => ipcRenderer.invoke(IPC.dialog.saveFile, opts),
  readTextFile: (path: string) => ipcRenderer.invoke(IPC.dialog.readFile, path),

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

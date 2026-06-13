import { statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type OpenFileOptions, type SaveFileOptions } from '@shared/ipc-contract'
import type { FilePickResult } from '@shared/types'
import { registerHttpHandlers } from '../http'
import { CookieManager, registerCookieHandlers } from '../http/cookies'
import { registerAiHandlers } from '../ai'
import { registerStorageHandlers, registerWorkspaceHandlers, type StorageManager } from '../storage'
import { registerDataHandlers } from '../data'
import { registerPluginHandlers } from '../plugins'
import { registerScriptHandlers } from '../scripting'
import { registerOAuthHandlers } from '../auth/oauth'
import { registerGraphqlHandlers } from '../graphql'
import { registerRealtimeHandlers } from '../realtime'
import { registerGrpcHandlers } from '../grpc'
import { registerSqliteHandlers } from '../sqlite'
import { checkForUpdate } from '../update'

/** Max size of a user-picked text file the renderer may read (runner data files). */
const MAX_READ_TEXT_BYTES = 25 * 1024 * 1024

/**
 * Paths the user has explicitly picked via a native open dialog this session.
 * `readTextFile` only reads from this allowlist, so a compromised renderer can't
 * read arbitrary local files (e.g. ~/.ssh/id_rsa) by passing a crafted path.
 */
const pickedPaths = new Set<string>()

export interface IpcContext {
  storage: StorageManager
  getWindow: () => BrowserWindow | null
}

export function registerIpc(ctx: IpcContext): void {
  // Persistent cookie jar (per workspace) — also injected into the HTTP engine.
  const cookieJar = new CookieManager(ctx.storage)
  void cookieJar.load()

  // User plugins (docs/PLUGINS.md): discovery, grants, sandboxed dispatch.
  const plugins = registerPluginHandlers(ipcMain, ctx.storage, ctx.getWindow)

  // Networking core (CORS-free) — built by the http engine module. The plugins'
  // `request` hook may patch the spec before send (request:write); completed
  // exchanges feed the `response` hook (fire-and-forget).
  registerHttpHandlers(
    ipcMain,
    cookieJar,
    (spec, result) => plugins.dispatchResponseHook(spec, result),
    (spec, signal) => plugins.runRequestHooks(spec, signal)
  )
  registerCookieHandlers(ipcMain, cookieJar)

  // Realtime: WebSocket + SSE clients (streamed to the renderer per connection).
  registerRealtimeHandlers(ipcMain, ctx.getWindow)

  // gRPC client (proto parse + unary/streaming calls, streamed per call).
  registerGrpcHandlers(ipcMain, ctx.getWindow)

  // SQLite backup (optional, pure-WASM sql.js) — export/import a workspace.
  registerSqliteHandlers(ipcMain)

  // Multi-provider AI — secrets + provider config resolved from storage.
  registerAiHandlers(ipcMain, {
    getSecret: ctx.storage.getSecret,
    getProvider: ctx.storage.getProvider
  })

  // Persistence + secrets + local workspaces.
  registerStorageHandlers(ctx.storage)
  registerWorkspaceHandlers(ctx.storage)

  // P1: import/export, scripting sandbox, OAuth 2.0 token fetch.
  registerDataHandlers(ipcMain)
  registerScriptHandlers(ipcMain)
  registerOAuthHandlers(ipcMain)
  registerGraphqlHandlers(ipcMain)

  // Dialogs + filesystem bridges.
  ipcMain.handle(IPC.dialog.openFile, async (_e, opts: OpenFileOptions): Promise<FilePickResult[] | null> => {
    const win = ctx.getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
          filters: opts.filters
        })
      : await dialog.showOpenDialog({
          properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
          filters: opts.filters
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths.map((filePath) => {
      let sizeBytes = 0
      try {
        sizeBytes = statSync(filePath).size
      } catch {
        /* ignore */
      }
      // Remember picked paths so readTextFile can later read them (and only them).
      pickedPaths.add(filePath)
      return { filePath, fileName: basename(filePath), sizeBytes }
    })
  })

  ipcMain.handle(IPC.dialog.saveFile, async (_e, opts: SaveFileOptions): Promise<string | null> => {
    const win = ctx.getWindow()
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: opts.defaultName, filters: opts.filters })
      : await dialog.showSaveDialog({ defaultPath: opts.defaultName, filters: opts.filters })
    if (result.canceled || !result.filePath) return null
    const data = opts.base64 ? Buffer.from(opts.content, 'base64') : Buffer.from(opts.content, 'utf8')
    await writeFile(result.filePath, data)
    return result.filePath
  })

  // Read a user-picked text file (runner data files). Size-capped to avoid
  // loading an enormous file into memory; returns UTF-8 text.
  ipcMain.handle(IPC.dialog.readFile, async (_e, path: string): Promise<string> => {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path')
    // Confine reads to files the user actually picked via a dialog — never an
    // arbitrary renderer-supplied path.
    if (!pickedPaths.has(path)) throw new Error('Path was not selected via a file dialog')
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      throw new Error('File not found')
    }
    if (size > MAX_READ_TEXT_BYTES) throw new Error('File is too large (max 25 MB)')
    return readFile(path, 'utf8')
  })

  // App-level bridges.
  ipcMain.handle(IPC.app.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  ipcMain.handle(IPC.app.minimize, () => ctx.getWindow()?.minimize())
  ipcMain.handle(IPC.app.maximize, () => {
    const win = ctx.getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.app.close, () => ctx.getWindow()?.close())
  ipcMain.handle(IPC.app.getVersion, () => app.getVersion())

  // Update checker — GitHub Releases, no own backend. Never throws.
  ipcMain.handle(IPC.update.check, () => checkForUpdate())
}

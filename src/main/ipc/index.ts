import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type OpenFileOptions, type SaveFileOptions } from '@shared/ipc-contract'
import type { FilePickResult } from '@shared/types'
import { registerHttpHandlers } from '../http'
import { registerAiHandlers } from '../ai'
import { registerStorageHandlers, type StorageManager } from '../storage'
import { registerDataHandlers } from '../data'
import { registerScriptHandlers } from '../scripting'
import { registerOAuthHandlers } from '../auth/oauth'

export interface IpcContext {
  storage: StorageManager
  getWindow: () => BrowserWindow | null
}

export function registerIpc(ctx: IpcContext): void {
  // Networking core (CORS-free) — built by the http engine module.
  registerHttpHandlers(ipcMain)

  // Multi-provider AI — secrets + provider config resolved from storage.
  registerAiHandlers(ipcMain, {
    getSecret: ctx.storage.getSecret,
    getProvider: ctx.storage.getProvider
  })

  // Persistence + secrets.
  registerStorageHandlers(ctx.storage)

  // P1: import/export, scripting sandbox, OAuth 2.0 token fetch.
  registerDataHandlers(ipcMain)
  registerScriptHandlers(ipcMain)
  registerOAuthHandlers(ipcMain)

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
}

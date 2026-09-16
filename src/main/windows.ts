import { join } from 'node:path'
import { BrowserWindow, ipcMain, nativeTheme, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { APP_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc-contract'

export interface AppWindowOptions {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title: string
  x?: number
  y?: number
  /** URL fragment for the renderer, e.g. `pane=<tabId>` for a detached pane */
  hash?: string
  isDev: boolean
}

/** Every Relay window shares the same hardened webPreferences and navigation guards. */
export function createAppWindow(opts: AppWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    x: opts.x,
    y: opts.y,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161619' : '#fbfbfc',
    title: opts.title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (opts.isDev) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${source}:${line})`)
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[renderer] did-fail-load', code, desc, url))
    win.webContents.on('render-process-gone', (_e, details) => console.error('[renderer] render-process-gone', details))
  }

  // Block navigation to remote origins; open external links in the OS browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(opts.hash ? `${rendererUrl}#${opts.hash}` : rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), opts.hash ? { hash: opts.hash } : undefined)
  }
  return win
}

/* ============================================================
 * Detached panes: a single request tab in its own OS window
 * ============================================================ */

const paneWindows = new Map<string, BrowserWindow>()
/** Volatile response state handed between the main window and a pane window. */
const snapshots = new Map<string, unknown>()

const PANE_MIN_W = 420
const PANE_MIN_H = 360

export function closeAllPaneWindows(): void {
  for (const win of paneWindows.values()) if (!win.isDestroyed()) win.close()
}

export function registerPaneHandlers(opts: {
  isDev: boolean
  getMainWindow: () => BrowserWindow | null
  /** Called with the webContents id of a pane window that closed (release its connections). */
  onPaneWindowClosed: (webContentsId: number) => void
}): void {
  ipcMain.handle(IPC.panes.detach, (e: IpcMainInvokeEvent, tabId: string, title: string) => {
    if (typeof tabId !== 'string' || !tabId) return
    const existing = paneWindows.get(tabId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }
    const parent = BrowserWindow.fromWebContents(e.sender)
    const pb = parent?.getBounds()
    const win = createAppWindow({
      isDev: opts.isDev,
      width: 820,
      height: 760,
      minWidth: PANE_MIN_W,
      minHeight: PANE_MIN_H,
      x: pb ? pb.x + 80 + paneWindows.size * 32 : undefined,
      y: pb ? pb.y + 60 + paneWindows.size * 32 : undefined,
      title: `${String(title || 'Запрос').slice(0, 80)} — ${APP_NAME}`,
      hash: `pane=${encodeURIComponent(tabId)}`
    })
    paneWindows.set(tabId, win)
    const webContentsId = win.webContents.id
    win.on('closed', () => {
      paneWindows.delete(tabId)
      opts.onPaneWindowClosed(webContentsId)
      const main = opts.getMainWindow()
      if (main && !main.isDestroyed()) main.webContents.send(IPC.panes.closed, tabId)
    })
  })

  ipcMain.handle(IPC.panes.attach, (_e: IpcMainInvokeEvent, tabId: string) => {
    const win = paneWindows.get(tabId)
    if (win && !win.isDestroyed()) win.close()
  })

  ipcMain.handle(IPC.panes.focus, (_e: IpcMainInvokeEvent, tabId: string) => {
    const win = paneWindows.get(tabId)
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  ipcMain.handle(IPC.panes.list, () => [...paneWindows.entries()].filter(([, w]) => !w.isDestroyed()).map(([tabId]) => tabId))

  ipcMain.on(IPC.panes.putSnapshot, (_e: IpcMainEvent, tabId: string, snapshot: unknown) => {
    if (typeof tabId === 'string' && tabId) snapshots.set(tabId, snapshot)
  })

  ipcMain.handle(IPC.panes.takeSnapshot, (_e: IpcMainInvokeEvent, tabId: string) => {
    const snap = snapshots.get(tabId) ?? null
    snapshots.delete(tabId)
    return snap
  })

  ipcMain.handle(IPC.panes.nudge, (e: IpcMainInvokeEvent, dx: number, dy: number, dw: number, dh: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || win.isDestroyed()) return
    if (win.isMaximized()) win.unmaximize()
    const b = win.getBounds()
    const [minW, minH] = win.getMinimumSize()
    const num = (v: number): number => (Number.isFinite(v) ? Math.round(v) : 0)
    win.setBounds({
      x: b.x + num(dx),
      y: b.y + num(dy),
      width: Math.max(minW || PANE_MIN_W, b.width + num(dw)),
      height: Math.max(minH || PANE_MIN_H, b.height + num(dh))
    })
  })
}

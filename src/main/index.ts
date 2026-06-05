import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import { APP_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc-contract'
import { StorageManager } from './storage'
import { registerIpc } from './ipc'
import { abortAllRequests } from './http'
import { abortAllAiStreams } from './ai'
import { abortAllRealtime } from './realtime'
import { startSandboxHost, stopScriptSandbox } from './scripting'

let mainWindow: BrowserWindow | null = null

// `app` is undefined when this bundle is re-forked as the script sandbox
// (ELECTRON_RUN_AS_NODE) — stay throw-safe until the role branch below.
const isDev = !app?.isPackaged

function contentSecurityPolicy(): string {
  const scriptExtra = isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''
  const connectExtra = isDev ? ' ws: wss: http://localhost:* ws://localhost:*' : ''
  return [
    "default-src 'self'",
    `script-src 'self'${scriptExtra}`,
    "style-src 'self' 'unsafe-inline'",
    'img-src \'self\' data: blob:',
    "font-src 'self' data:",
    `connect-src 'self'${connectExtra}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: { x: -100, y: -100 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161619' : '#fbfbfc',
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (isDev) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${source}:${line})`)
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.error('[renderer] did-fail-load', code, desc, url)
    )
    mainWindow.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer] render-process-gone', details)
    )
  }

  // Block navigation to remote origins; open external links in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    // Drop any in-flight HTTP/AI work tied to this window (matters on macOS where
    // the app stays alive after the window closes).
    abortAllRequests()
    abortAllAiStreams()
    abortAllRealtime()
    mainWindow = null
  })
}

if (process.env.RELAY_SCRIPT_SANDBOX === '1') {
  // This process was re-forked as the isolated pm.* script sandbox — run the
  // host message loop, never the Electron app.
  startSandboxHost()
} else {
  app.whenReady().then(async () => {
  // Content Security Policy for all sessions.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()]
      }
    })
  })

  const storage = new StorageManager()
  await storage.init()
  registerIpc({ storage, getWindow: () => mainWindow })

  // Relay native theme changes to the renderer (for 'system' theme mode).
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send(IPC.app.themeChanged, nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Ensure pending writes are flushed before exit.
  let flushing = false
  app.on('will-quit', (e) => {
    if (flushing) return
    abortAllRequests()
    abortAllAiStreams()
    abortAllRealtime()
    stopScriptSandbox()
    e.preventDefault()
    flushing = true
    // Never hang the quit: force-exit if the flush stalls (disk full/stuck fs).
    const force = setTimeout(() => app.exit(0), 2000)
    storage
      .flush()
      .catch((err) => console.error('[main] flush on quit failed:', err))
      .finally(() => {
        clearTimeout(force)
        app.exit(0)
      })
  })
  }).catch((err) => {
    // Surface startup failures rather than silently dying.
    console.error('[main] failed to start:', err)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

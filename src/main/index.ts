import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron'
import { APP_NAME } from '@shared/constants'
import { IPC } from '@shared/ipc-contract'
import { StorageManager } from './storage'
import { registerIpc } from './ipc'
import { abortAllRequests } from './http'
import { abortAllAiStreams } from './ai'
import { abortAllRealtime, abortRealtimeFor } from './realtime'
import { abortAllGrpc, abortGrpcFor } from './grpc'
import { closeAllPaneWindows, createAppWindow, registerPaneHandlers } from './windows'
import { startSandboxHost, stopScriptSandbox } from './scripting'
import { startPluginSandboxHost, stopPluginSandbox } from './plugins/host'

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

/**
 * Low-power mode must be decided before the app is ready, long before the
 * storage layer is up — so the one setting that needs it is read straight from
 * its JSON file. A missing or unreadable file simply means "full power", which
 * is the default. `disableHardwareAcceleration` is the 1.2 name of the setting.
 */
export function lowPowerRequested(): boolean {
  try {
    const file = join(app.getPath('userData'), 'relay-data', 'settings.json')
    if (!existsSync(file)) return false
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { lowPowerMode?: unknown; disableHardwareAcceleration?: unknown }
    return doc.lowPowerMode === true || (doc.lowPowerMode === undefined && doc.disableHardwareAcceleration === true)
  } catch {
    // Corrupt settings must never stop the app from starting.
    return false
  }
}

/**
 * Everything that makes Chromium cheaper to run, applied only in low-power
 * mode. No feature depends on any of it: the GPU switches move compositing to
 * the CPU, the rest shrink caches and background work.
 */
function applyLowPowerPreference(): void {
  if (!lowPowerRequested()) return
  app.disableHardwareAcceleration()
  // Without a GPU process there is nothing to composite on the GPU; this keeps
  // Chromium from allocating video memory for layers it cannot use.
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  // Chromium's own profile for weak machines: smaller caches, fewer tiles.
  app.commandLine.appendSwitch('enable-low-end-device-mode')
  app.commandLine.appendSwitch('disable-smooth-scrolling')
  // Nothing here renders 3D or plays media; dropping these frees their memory.
  app.commandLine.appendSwitch('disable-features', 'WebGL,WebGL2,MediaFoundationVideoCapture')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

/**
 * Isolation: Chromium features that would reach the network (or the user's
 * hardware) without the user asking. The spellchecker downloads dictionaries
 * from Google's servers; permission prompts (camera, location, notifications…)
 * have no use in an API client. Only the clipboard stays — copy buttons use it.
 */
function isolateSession(): void {
  const ses = session.defaultSession
  ses.setSpellCheckerEnabled(false)
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

function createWindow(): void {
  mainWindow = createAppWindow({ isDev, width: 1380, height: 880, minWidth: 940, minHeight: 600, title: APP_NAME })

  mainWindow.on('closed', () => {
    // Drop any in-flight HTTP/AI work tied to this window (matters on macOS where
    // the app stays alive after the window closes).
    abortAllRequests()
    abortAllAiStreams()
    abortAllRealtime()
    abortAllGrpc()
    closeAllPaneWindows()
    mainWindow = null
  })

  // A reload (F5 in development, a renderer crash) replaces the page that owned
  // every live socket. Without this the connections kept reconnecting in main
  // for a renderer that no longer listens to them.
  const wc = mainWindow.webContents
  const wcId = wc.id
  const dropLive = (): void => {
    abortRealtimeFor(wcId)
    abortGrpcFor(wcId)
  }
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) dropLive()
  })
  wc.on('render-process-gone', dropLive)
}

if (process.env.RELAY_SCRIPT_SANDBOX === '1') {
  // This process was re-forked as the isolated pm.* script sandbox — run the
  // host message loop, never the Electron app.
  startSandboxHost()
} else if (process.env.RELAY_PLUGIN_SANDBOX === '1') {
  // Re-forked as the isolated plugin sandbox (docs/PLUGINS.md) — same model.
  startPluginSandboxHost()
} else {
  // No speculative DNS lookups for links in the UI: every lookup the app makes
  // should belong to a request the user sent.
  app.commandLine.appendSwitch('dns-prefetch-disable')
  applyLowPowerPreference()
  app.whenReady().then(async () => {
  // Relay drives everything from its own titlebar and in-app shortcuts. The
  // default Electron menu is invisible with a frameless window, yet its
  // accelerators still fire first and never reach the renderer: Ctrl+W closed
  // the window instead of the tab, Ctrl+R reloaded the app out from under the
  // user and Ctrl+Shift+I opened DevTools in a release build.
  Menu.setApplicationMenu(null)
  // Content Security Policy for all sessions.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()]
      }
    })
  })
  isolateSession()

  const storage = new StorageManager()
  await storage.init()
  registerIpc({ storage, getWindow: () => mainWindow })
  registerPaneHandlers({
    isDev,
    getMainWindow: () => mainWindow,
    onPaneWindowClosed: (webContentsId) => {
      abortRealtimeFor(webContentsId)
      abortGrpcFor(webContentsId)
    }
  })
  // Pane windows show the previous workspace's tabs — close them on a switch.
  storage.onWorkspaceSwitch(closeAllPaneWindows)

  // Relay native theme changes to the renderer (for 'system' theme mode).
  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.app.themeChanged, nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    }
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
    abortAllGrpc()
    stopScriptSandbox()
    stopPluginSandbox()
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

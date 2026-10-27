/**
 * The app icon the user picked in Settings → Appearance. The renderer draws it
 * and hands over a 256×256 PNG; here it goes onto every window (the taskbar
 * button on Windows and Linux), the Dock on macOS, and — when asked for, on
 * Windows — the app's own shortcuts. The PNG is kept in userData so the next
 * start shows it from the first frame. «Relay» puts the original icon back.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeImage, shell, type NativeImage } from 'electron'
import { IPC, type AppIconResult } from '@shared/ipc-contract'
import { ICON_IMAGE_MAX } from '@shared/app-icon'

const PNG_FILE = 'app-icon.png'
const ICO_FILE = 'app-icon.ico'
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const iconDir = (): string => app.getPath('userData')
const pngPath = (): string => join(iconDir(), PNG_FILE)
const icoPath = (): string => join(iconDir(), ICO_FILE)

/** The custom icon chosen earlier, for a window about to be created. */
export function savedAppIcon(): NativeImage | undefined {
  try {
    if (!existsSync(pngPath())) return undefined
    const img = nativeImage.createFromPath(pngPath())
    return img.isEmpty() ? undefined : img
  } catch {
    return undefined
  }
}

/** Put the saved icon on the Dock (macOS) — the windows take it when created. */
export function applySavedAppIcon(): void {
  const img = savedAppIcon()
  if (img && process.platform === 'darwin') app.dock?.setIcon(img)
}

/**
 * An .ico holding PNG images (Windows Vista and later read those), one per
 * size, so Explorer has a sharp picture for every place it shows a shortcut.
 */
export function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries: Buffer[] = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

function writeAtomic(path: string, data: Buffer): void {
  mkdirSync(iconDir(), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

/** Where Windows keeps the shortcuts the installer made (and the taskbar pin). */
function shortcutDirs(): string[] {
  const roaming = process.env.APPDATA
  const dirs = [app.getPath('desktop')]
  if (roaming) {
    dirs.push(join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    dirs.push(join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'))
  }
  if (process.env.PUBLIC) dirs.push(join(process.env.PUBLIC, 'Desktop'))
  return dirs
}

/**
 * Point every shortcut that starts this very executable at `icon` (or back at
 * the executable's own icon). Shortcuts of other programs are never touched.
 * Returns how many were updated.
 */
function updateShortcuts(icon: string | null): number {
  if (process.platform !== 'win32' || !app.isPackaged) return 0
  const exe = process.execPath.toLowerCase()
  let n = 0
  for (const dir of shortcutDirs()) {
    let names: string[] = []
    try {
      names = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.lnk')) : []
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(dir, name)
      try {
        const link = shell.readShortcutLink(file)
        if (link.target.toLowerCase() !== exe) continue
        const ok = shell.writeShortcutLink(file, 'update', { target: link.target, icon: icon ?? process.execPath, iconIndex: 0 })
        if (ok) n++
      } catch {
        // Not readable, or not ours to change (an all-users shortcut without rights).
      }
    }
  }
  return n
}

/** The original icon (shipped next to the app as `icon.png`), to put back after a custom one. */
function defaultImage(): NativeImage | undefined {
  const file = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
  if (!existsSync(file)) return undefined
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? undefined : img
}

function applyToWindows(img: NativeImage | undefined): void {
  if (!img || img.isEmpty()) return
  if (process.platform === 'darwin') {
    app.dock?.setIcon(img)
    return
  }
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.setIcon(img)
}

/**
 * Apply a new icon (`png` = a 256×256 PNG data URL) or go back to the original
 * one (`png` = null). `shortcuts` also re-points the Windows shortcuts.
 */
export function setAppIcon(png: string | null, shortcuts: boolean): AppIconResult {
  try {
    if (png === null) {
      rmSync(pngPath(), { force: true })
      // Shortcuts are put back only when Relay changed them (the .ico it pointed
      // them at exists); ones it never touched stay exactly as they are.
      const updated = existsSync(icoPath()) ? updateShortcuts(null) : 0
      rmSync(icoPath(), { force: true })
      applyToWindows(defaultImage())
      return { ok: true, shortcuts: updated }
    }
    if (typeof png !== 'string' || png.length > ICON_IMAGE_MAX * 2 || !png.startsWith('data:image/png;base64,')) {
      return { ok: false, error: 'not-png' }
    }
    const img = nativeImage.createFromDataURL(png)
    if (img.isEmpty()) return { ok: false, error: 'not-png' }
    writeAtomic(pngPath(), img.toPNG())
    applyToWindows(img)
    let updated = 0
    if (shortcuts && process.platform === 'win32') {
      const pngs = ICO_SIZES.map((size) => ({ size, data: (size === img.getSize().width ? img : img.resize({ width: size, height: size, quality: 'best' })).toPNG() }))
      writeAtomic(icoPath(), buildIco(pngs))
      updated = updateShortcuts(icoPath())
    } else if (process.platform === 'win32' && existsSync(icoPath())) {
      // The shortcuts were switched off: they get the original icon back.
      updated = updateShortcuts(null)
      rmSync(icoPath(), { force: true })
    }
    return { ok: true, shortcuts: updated }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function registerAppIconHandlers(): void {
  ipcMain.handle(IPC.app.setIcon, (_e, png: string | null, shortcuts: boolean) => setAppIcon(png, !!shortcuts))
}

/**
 * Decisions taken in the Windows installer.
 *
 * `install-config.json` is written next to the executable by build/installer.nsh
 * and carries two things the app cannot know on its own: the language the user
 * ran the installer in, and which feature packs they ticked. It is applied once
 * per install — the file's modification time is the marker, so reinstalling (or
 * repairing) re-applies the choice while day-to-day toggling in Settings is
 * never overwritten.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { CORE_LOCALES } from '@shared/features'

export interface InstallChoice {
  /** UI language picked in the installer ('ru' | 'en') */
  locale: string
  /** ids of the packs to switch on at first launch */
  packs: string[]
  /** file mtime in ms — identifies this particular install */
  stamp: number
}

const FILE = 'install-config.json'

/** Next to Relay.exe in a packaged install; absent while developing. */
function configPath(): string {
  return join(dirname(app.getPath('exe')), FILE)
}

/** Read the installer's choices, or null when there are none to apply. */
export function readInstallChoice(): InstallChoice | null {
  try {
    const file = configPath()
    if (!existsSync(file)) return null
    const stamp = Math.round(statSync(file).mtimeMs)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { locale?: unknown; packs?: unknown; chosen?: unknown }
    // A silent or update install shows no pages: it writes the file with
    // `chosen: "0"`, and the app must keep the configuration it already has.
    if (raw.chosen !== '1') return null
    const locale = typeof raw.locale === 'string' && (CORE_LOCALES as readonly string[]).includes(raw.locale) ? raw.locale : 'ru'
    const packs = Array.isArray(raw.packs) ? raw.packs.filter((p): p is string => typeof p === 'string') : []
    return { locale, packs, stamp }
  } catch {
    // A damaged file must never block startup — the app just uses its defaults.
    return null
  }
}

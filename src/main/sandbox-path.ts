/**
 * Where the sandbox children's entry bundle lives (`out/main/sandbox.js`, built
 * from `./sandbox-entry.ts`).
 *
 * It cannot be a plain `join(__dirname, 'sandbox.js')`: the script and plugin
 * hosts are shared by both main-process entries, so Rollup puts them in a
 * shared chunk under `out/main/chunks/`, and `__dirname` there is one level too
 * deep. The app bundle itself always sits in `out/main`, so the main module's
 * directory is the reliable anchor — with the neighbouring directories as
 * fallbacks, and `existsSync` to pick the one that is really there (it reads
 * inside app.asar too).
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

let cached: string | null = null

export function sandboxEntryPath(): string {
  if (cached) return cached
  const mainDir = require.main?.filename ? dirname(require.main.filename) : null
  const candidates = [
    mainDir ? join(mainDir, 'sandbox.js') : null,
    join(__dirname, 'sandbox.js'),
    join(__dirname, '..', 'sandbox.js')
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (existsSync(candidate)) {
        cached = candidate
        return candidate
      }
    } catch {
      /* unreadable path — try the next one */
    }
  }
  // Nothing found: hand back the most likely path so the caller's fork fails
  // loudly (fail closed) instead of silently running code somewhere else.
  return join(__dirname, 'sandbox.js')
}

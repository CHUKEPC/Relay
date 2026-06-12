/**
 * Update checker — asks GitHub Releases directly, no own cloud.
 * Fully fail-safe: every outcome is a resolved UpdateCheckResult.
 */
import { app } from 'electron'
import { UPDATE_REPO } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/ipc-contract'

const CHECK_TIMEOUT_MS = 10_000

/** Split 'X.Y.Z'-ish into numeric parts; null when any part is not a number. */
function parseVersion(raw: string): number[] | null {
  const parts = raw.trim().replace(/^v/i, '').split('.')
  if (!parts.length) return null
  const nums: number[] = []
  for (const part of parts) {
    const n = Number(part)
    if (part === '' || !Number.isFinite(n)) return null
    nums.push(n)
  }
  return nums
}

/** True when `latest` is strictly newer than `current`; unparsable -> not newer. */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'Relay', Accept: 'application/vnd.github+json' },
      signal: ctrl.signal
    })
    if (!res.ok) return { ok: false, error: `http-${res.status}` }
    const json = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    const tag = typeof json.tag_name === 'string' ? json.tag_name.trim() : ''
    if (!tag) return { ok: false, error: 'no-tag' }
    const latestVersion = tag.replace(/^v/i, '')
    const url =
      typeof json.html_url === 'string' && json.html_url
        ? json.html_url
        : `https://github.com/${UPDATE_REPO}/releases`
    return {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable: isNewer(latestVersion, currentVersion),
      url
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    return { ok: false, error: name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

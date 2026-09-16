/**
 * Update checker — asks GitHub directly, no own cloud.
 * Fully fail-safe: every outcome is a resolved UpdateCheckResult.
 *
 * Releases are the primary source. A repository that only pushes version tags
 * (no published release) is a normal, common state, so the checker falls back
 * to the tag list instead of reporting a failure.
 */
import { app } from 'electron'
import { UPDATE_REPO } from '@shared/constants'
import type { UpdateCheckError, UpdateCheckResult } from '@shared/ipc-contract'

const CHECK_TIMEOUT_MS = 10_000
const NOTES_MAX = 600

const API = `https://api.github.com/repos/${UPDATE_REPO}`
const HEADERS = { 'User-Agent': 'Relay', Accept: 'application/vnd.github+json' }

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

/** Newest first by semantic order; unparsable names sort last. */
function byVersionDesc(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x) return y ? 1 : 0
  if (!y) return -1
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d) return d
  }
  return 0
}

type Json = Record<string, unknown>

async function getJson(url: string, signal: AbortSignal): Promise<{ json: unknown } | { error: UpdateCheckError }> {
  const res = await fetch(url, { headers: HEADERS, signal })
  if (res.status === 403 || res.status === 429) return { error: 'rate-limit' }
  if (res.status === 404) return { error: 'no-releases' }
  if (!res.ok) return { error: `http-${res.status}` }
  return { json: await res.json() }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The newest published, non-draft release; null when the repo has none. */
async function latestRelease(signal: AbortSignal): Promise<UpdateCheckResult | null> {
  const got = await getJson(`${API}/releases?per_page=20`, signal)
  if ('error' in got) return got.error === 'no-releases' ? null : { ok: false, error: got.error }
  const list = Array.isArray(got.json) ? (got.json as Json[]) : []
  // `/releases/latest` 404s on repos whose only releases are drafts or
  // prereleases, so filter the full list ourselves.
  const usable = list.filter((r) => r.draft !== true && r.prerelease !== true)
  const rel = usable[0]
  if (!rel) return null
  const tag = str(rel.tag_name)
  if (!tag) return null
  const notes = str(rel.body)
  return {
    ok: true,
    currentVersion: app.getVersion(),
    latestVersion: tag.replace(/^v/i, ''),
    updateAvailable: isNewer(tag.replace(/^v/i, ''), app.getVersion()),
    url: str(rel.html_url) || `https://github.com/${UPDATE_REPO}/releases`,
    source: 'release',
    publishedAt: str(rel.published_at) || undefined,
    notes: notes ? notes.slice(0, NOTES_MAX) : undefined
  }
}

/** Highest version tag; used when the repository publishes no releases. */
async function latestTag(signal: AbortSignal): Promise<UpdateCheckResult | null> {
  const got = await getJson(`${API}/tags?per_page=100`, signal)
  if ('error' in got) return got.error === 'no-releases' ? null : { ok: false, error: got.error }
  const names = (Array.isArray(got.json) ? (got.json as Json[]) : []).map((t) => str(t.name)).filter((n) => parseVersion(n))
  if (!names.length) return null
  const newest = names.sort(byVersionDesc)[0].replace(/^v/i, '')
  return {
    ok: true,
    currentVersion: app.getVersion(),
    latestVersion: newest,
    updateAvailable: isNewer(newest, app.getVersion()),
    url: `https://github.com/${UPDATE_REPO}/releases`,
    source: 'tag'
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
  try {
    const release = await latestRelease(ctrl.signal)
    if (release) return release
    const tag = await latestTag(ctrl.signal)
    if (tag) return tag
    return { ok: false, error: 'no-releases' }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    return { ok: false, error: name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

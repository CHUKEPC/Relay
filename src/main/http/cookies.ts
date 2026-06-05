/**
 * Persistent, editable cookie jar (lives in the main process).
 *
 * - Backed by the `cookies` storage document (per workspace).
 * - Auto-captures `Set-Cookie` from responses and auto-attaches matching,
 *   non-expired cookies to outgoing requests (domain/path/secure matching),
 *   implementing the pure-engine `CookieJarBridge`.
 * - Exposes CRUD for the renderer's Cookie Manager UI over IPC.
 *
 * Matching uses tough-cookie's `domainMatch`/`pathMatch`/`Cookie.parse` so the
 * behavior lines up with what Postman/browsers do.
 */
import type { IpcMain } from 'electron'
import { Cookie, domainMatch, pathMatch } from 'tough-cookie'
import { STORAGE_VERSION } from '@shared/constants'
import { IPC } from '@shared/ipc-contract'
import type { StoredCookie } from '@shared/types'
import type { CookieJarBridge } from './engine'
import type { StorageManager } from '../storage'

/** Default cookie path per RFC 6265 §5.1.4 (directory of the request path). */
function defaultPath(pathname: string): string {
  if (!pathname || pathname[0] !== '/') return '/'
  const i = pathname.lastIndexOf('/')
  return i <= 0 ? '/' : pathname.slice(0, i)
}

function isExpired(c: StoredCookie, now: number): boolean {
  if (!c.expires) return false // session cookie — kept for the app session
  const t = Date.parse(c.expires)
  return Number.isFinite(t) && t <= now
}

function sameCookie(a: Pick<StoredCookie, 'domain' | 'path' | 'key'>, b: StoredCookie): boolean {
  return a.key === b.key && a.domain.toLowerCase() === b.domain.toLowerCase() && a.path === b.path
}

/* ============================================================
 * Pure matching/capture helpers (exported for unit testing)
 * ============================================================ */

/**
 * Build the Cookie header value for `url` from a cookie list — matching by
 * domain (suffix), path, secure flag, and expiry. Pure; `now` is injected.
 */
export function buildCookieHeader(cookies: StoredCookie[], url: string, now: number): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return ''
  }
  const host = u.hostname
  const path = u.pathname || '/'
  const isHttps = u.protocol === 'https:'
  const out: string[] = []
  for (const c of cookies) {
    if (!c || !c.key) continue
    if (isExpired(c, now)) continue
    if (c.secure && !isHttps) continue
    const domain = c.domain.replace(/^\./, '')
    if (!domainMatch(host, domain, true)) continue
    if (!pathMatch(path, c.path || '/')) continue
    out.push(`${c.key}=${c.value}`)
  }
  return out.join('; ')
}

/**
 * Apply `Set-Cookie` lines observed for `url` to an existing cookie list. Pure:
 * returns a NEW list plus whether anything changed (cookies cleared by an expiry
 * in the past are removed). `now` is injected for deterministic tests.
 */
export function captureSetCookies(
  existing: StoredCookie[],
  url: string,
  setCookie: string[],
  now: number
): { cookies: StoredCookie[]; changed: boolean } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { cookies: existing, changed: false }
  }
  const cookies = existing.slice()
  let changed = false
  const reqHost = u.hostname.toLowerCase()
  for (const line of setCookie) {
    const parsed = Cookie.parse(line)
    if (!parsed || !parsed.key) continue
    // RFC 6265 §5.3: an explicit Domain the request host is NOT within must cause
    // the whole cookie to be ignored — otherwise a.com could set a cookie for
    // b.com (cross-domain injection). Also reject bare single-label domains
    // (e.g. "com") unless they equal the host (localhost), since domainMatch
    // would otherwise treat every "*.com" host as a match.
    let domain: string
    if (parsed.domain) {
      const d = parsed.domain.replace(/^\./, '').toLowerCase()
      if (d === reqHost || (d.includes('.') && domainMatch(reqHost, d, true))) {
        domain = d
      } else {
        continue // not within the request host → ignore this cookie
      }
    } else {
      domain = reqHost
    }
    const path = parsed.path ?? defaultPath(u.pathname)
    let expires: string | undefined
    if (parsed.expires && parsed.expires !== 'Infinity') expires = (parsed.expires as Date).toISOString()
    if (typeof parsed.maxAge === 'number') {
      expires = parsed.maxAge <= 0 ? new Date(0).toISOString() : new Date(now + parsed.maxAge * 1000).toISOString()
    }
    const next: StoredCookie = {
      key: parsed.key,
      value: parsed.value ?? '',
      domain,
      path,
      expires,
      httpOnly: parsed.httpOnly || undefined,
      secure: parsed.secure || undefined
    }
    const idx = cookies.findIndex((c) => sameCookie(next, c))
    if (expires && Date.parse(expires) <= now) {
      if (idx >= 0) {
        cookies.splice(idx, 1)
        changed = true
      }
      continue
    }
    if (idx >= 0) cookies[idx] = next
    else cookies.push(next)
    changed = true
  }
  return { cookies, changed }
}

export class CookieManager implements CookieJarBridge {
  private cookies: StoredCookie[] = []
  private loaded = false

  constructor(private storage: StorageManager) {
    // Reload the in-memory snapshot whenever the active workspace changes.
    storage.onWorkspaceSwitch(() => {
      // Fail safe: drop the previous workspace's cookies SYNCHRONOUSLY so the
      // async reload window can't attach/persist another workspace's cookies.
      this.cookies = []
      this.loaded = false
      void this.load()
    })
  }

  /** Warm the in-memory snapshot from storage (call once at startup). */
  async load(): Promise<void> {
    try {
      const doc = await this.storage.get('cookies')
      this.cookies = (doc.cookies ?? []).filter((c) => c && c.key && c.domain)
      this.loaded = true
    } catch {
      this.cookies = []
      this.loaded = true
    }
  }

  private persist(): void {
    this.storage.set('cookies', { version: STORAGE_VERSION, cookies: this.cookies })
  }

  /* ---- CookieJarBridge (used by the engine) ---- */

  cookieHeaderFor(url: string): string {
    if (!this.loaded || this.cookies.length === 0) return ''
    return buildCookieHeader(this.cookies, url, Date.now())
  }

  storeFromResponse(url: string, setCookie: string[]): void {
    if (!setCookie || setCookie.length === 0) return
    const { cookies, changed } = captureSetCookies(this.cookies, url, setCookie, Date.now())
    if (changed) {
      this.cookies = cookies
      this.persist()
    }
  }

  /* ---- CRUD for the renderer ---- */

  list(): StoredCookie[] {
    return this.cookies.map((c) => ({ ...c }))
  }

  upsert(cookie: StoredCookie): void {
    const clean: StoredCookie = {
      key: cookie.key,
      value: cookie.value ?? '',
      domain: (cookie.domain ?? '').replace(/^\./, '').toLowerCase(),
      path: cookie.path || '/',
      expires: cookie.expires || undefined,
      httpOnly: cookie.httpOnly || undefined,
      secure: cookie.secure || undefined
    }
    if (!clean.key || !clean.domain) return
    const idx = this.cookies.findIndex((c) => sameCookie(clean, c))
    if (idx >= 0) this.cookies[idx] = clean
    else this.cookies.push(clean)
    this.persist()
  }

  remove(target: Pick<StoredCookie, 'domain' | 'path' | 'key'>): void {
    const before = this.cookies.length
    const dom = (target.domain ?? '').replace(/^\./, '').toLowerCase()
    this.cookies = this.cookies.filter(
      (c) => !(c.key === target.key && c.domain.toLowerCase() === dom && c.path === target.path)
    )
    if (this.cookies.length !== before) this.persist()
  }

  clear(domain?: string): void {
    if (!domain) {
      if (this.cookies.length === 0) return
      this.cookies = []
      this.persist()
      return
    }
    const dom = domain.replace(/^\./, '').toLowerCase()
    const before = this.cookies.length
    this.cookies = this.cookies.filter((c) => c.domain.toLowerCase() !== dom)
    if (this.cookies.length !== before) this.persist()
  }
}

export function registerCookieHandlers(ipcMain: IpcMain, jar: CookieManager): void {
  ipcMain.handle(IPC.cookies.get, async () => jar.list())
  ipcMain.handle(IPC.cookies.set, async (_e, cookie: StoredCookie) => {
    jar.upsert(cookie)
  })
  ipcMain.handle(IPC.cookies.delete, async (_e, cookie: Pick<StoredCookie, 'domain' | 'path' | 'key'>) => {
    jar.remove(cookie)
  })
  ipcMain.handle(IPC.cookies.clear, async (_e, domain?: string) => {
    jar.clear(domain)
  })
}

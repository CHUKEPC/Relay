/**
 * Headers Relay adds to an HTTP request on its own — the "hidden" headers the
 * Headers tab can show and switch off one by one.
 *
 * The engine (src/main/http/engine.ts) and the Headers tab both read this
 * module, so what the tab lists is exactly what goes on the wire.
 */
import { APP_VERSION, RAW_LANGUAGE_CONTENT_TYPE } from './constants'
import type { KV, RequestBody } from './types'

/** Sent on every HTTP request unless the request sets the header itself. */
export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': `Relay/${APP_VERSION}`,
  Accept: '*/*',
  // Only what the engine can actually decode again (gzip / deflate / br).
  'Accept-Encoding': 'gzip, deflate, br'
}

/** Lower-case names of the automatic headers a request can switch off. */
export type AutoHeaderKey = 'user-agent' | 'accept' | 'accept-encoding' | 'content-type' | 'cookie' | 'host' | 'content-length'

export interface AutoHeader {
  key: AutoHeaderKey
  /** as it is sent */
  name: string
  /** what will be sent; `null` when only the send can tell (length, jar cookies) */
  value: string | null
  /** required by HTTP itself — shown, but cannot be switched off */
  locked: boolean
  /** a header in the request's own list replaces this one */
  overridden: boolean
}

/** The Content-Type the engine derives from the body, or null for none. */
export function autoContentType(body: RequestBody): string | null {
  switch (body.type) {
    case 'raw':
      return RAW_LANGUAGE_CONTENT_TYPE[body.language] ?? 'text/plain'
    case 'urlencoded':
      return 'application/x-www-form-urlencoded'
    case 'formdata':
      return 'multipart/form-data; boundary=…'
    case 'binary':
      return body.filePath ? (body.contentType ?? 'application/octet-stream') : null
    case 'graphql':
      return 'application/json'
    default:
      return null
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`).host || null
  } catch {
    return null
  }
}

/**
 * Every automatic header for a request, in the order they are sent. A header
 * the user put in the list themselves is marked `overridden`.
 */
export function autoHeadersFor(req: { url: string; body: RequestBody; headers: KV[] }): AutoHeader[] {
  const own = new Set(req.headers.filter((h) => h.enabled !== false && h.key).map((h) => h.key.trim().toLowerCase()))
  const out: AutoHeader[] = []
  const add = (key: AutoHeaderKey, name: string, value: string | null, locked = false): void => {
    out.push({ key, name, value, locked, overridden: own.has(key) })
  }
  add('host', 'Host', hostOf(req.url), true)
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) add(name.toLowerCase() as AutoHeaderKey, name, value)
  const ct = autoContentType(req.body)
  // multipart needs its boundary in the header — the body is unreadable without it.
  if (ct) add('content-type', 'Content-Type', ct, req.body.type === 'formdata')
  if (req.body.type !== 'none') add('content-length', 'Content-Length', null, true)
  add('cookie', 'Cookie', null)
  return out
}

/** Normalize a request's list of switched-off automatic headers. */
export function disabledAutoHeaders(list: readonly string[] | undefined): Set<string> {
  return new Set((list ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean))
}

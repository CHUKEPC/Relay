/**
 * Pure redaction helpers for plugin event context (no Electron deps, so they
 * stay unit-testable). The grant-filtering that decides WHETHER a plugin sees
 * request/response data lives in `PluginManager.sanitizeContext`; these just
 * scrub credentials out of whatever is allowed through.
 */
import { CREDENTIAL_HEADER_RE } from '../http/engine'

export const MASK = '***'

/** Mask a header value whose NAME looks credential-bearing. */
export function maskHeader(key: string, value: string): string {
  return CREDENTIAL_HEADER_RE.test(key) ? MASK : value
}

/**
 * Redact a URL for plugin context: strip userinfo, drop the fragment, and mask
 * the VALUE of every query parameter (keys stay visible). We mask all query
 * values rather than guess credential names — the engine injects `apikey` auth
 * into the query under a USER-CHOSEN name (e.g. `?key=…`, `?subscription-key=…`)
 * that no name list can reliably catch, and the post-auth `finalUrl` carries it.
 * The FRAGMENT is dropped entirely: an OAuth implicit-flow callback returns the
 * access token in the URL hash (`#access_token=…`), which no query masking would
 * touch. A plugin gets the param keys and the path; it does not need literal
 * query values. Best-effort — unparseable input is passed through unchanged.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.username = ''
    u.password = ''
    u.hash = ''
    // Rebuild the query masking every value while PRESERVING duplicate keys —
    // searchParams.set() collapses `?a=1&a=2` into a single `a`, distorting the
    // shape the plugin sees. keys() yields one entry per pair (dupes included).
    const names = [...u.searchParams.keys()]
    if (names.length) {
      const masked = new URLSearchParams()
      for (const name of names) masked.append(name, MASK)
      u.search = masked.toString()
    }
    return u.toString()
  } catch {
    return raw
  }
}

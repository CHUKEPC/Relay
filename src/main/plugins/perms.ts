/**
 * Pure permission/patch helpers (no Electron deps, unit-testable). Kept apart
 * from the manager so tests can import them without the electron runtime.
 */
import { CREDENTIAL_HEADER_RE } from '../http/engine'
import { hostAllowed } from './sandbox'
import type { Auth, PluginManifest, PluginPermission, PluginRequestPatch, RequestBody, RequestSpec } from '@shared/types'

/** Origin (scheme://host:port) of a URL, or null when unparseable. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Effective permission set for a dispatch: the granted∩manifest set, with a
 * user-set net allowlist narrowing a broad `net` grant down to specific hosts.
 */
export function effectivePermissions(
  manifest: PluginManifest,
  granted: PluginPermission[],
  netAllowlist: string[] | undefined
): PluginPermission[] {
  const perms = manifest.permissions.filter((p) => granted.includes(p))
  if (netAllowlist && netAllowlist.length && perms.includes('net')) {
    // Replace the broad `net` (and any manifest net:host) with exactly the
    // user's allowlist — a strict narrowing the user chose.
    const narrowed = perms.filter((p) => p !== 'net' && !p.startsWith('net:'))
    for (const host of netAllowlist) narrowed.push(`net:${host}` as PluginPermission)
    return narrowed
  }
  return perms
}

/**
 * Apply a `request`-event patch to a resolved spec.
 *
 * SECURITY — the request-hook path must never grant a plugin more reach than it
 * already has via `relay.fetch`. So a CROSS-ORIGIN retarget is allowed only when
 * the plugin holds `net`/`net:<host>` for the NEW host (the same gate fetch
 * uses). When it does not, the URL swap is REFUSED and the request still goes to
 * the user's original URL — a `request:write`-only plugin can rewrite within the
 * user's origin but can't point the user's request (with its body/query/auth) at
 * a host the plugin couldn't reach itself.
 *
 * Even on an ALLOWED cross-origin retarget we still strip the USER's secrets —
 * `spec.auth`, credential-bearing headers, `spec.body` and `spec.query` — so the
 * app never forwards the user's login/OAuth/apikey material onto another origin;
 * a plugin that needs to POST cross-origin supplies its OWN body via the patch.
 *
 * `permissions` is the plugin's effective (granted ∩ manifest, net-narrowed) set.
 */
export function applyRequestPatch(
  spec: RequestSpec,
  patch: PluginRequestPatch,
  permissions: PluginPermission[] = []
): RequestSpec {
  const next: RequestSpec = { ...spec, headers: spec.headers.map((h) => ({ ...h })) }
  if (typeof patch.method === 'string' && patch.method) next.method = patch.method

  const wantsUrl = typeof patch.url === 'string' && patch.url ? patch.url : null
  const origChanged = !!wantsUrl && originOf(wantsUrl) !== originOf(spec.url)
  if (wantsUrl && (!origChanged || hostAllowed(wantsUrl, permissions))) {
    next.url = wantsUrl
  }
  // else: a cross-origin retarget the plugin isn't allowed to reach — ignore the
  // url swap entirely; the request keeps the user's original URL.

  if (origChanged && next.url === wantsUrl) {
    next.auth = { type: 'none' } satisfies Auth
    next.headers = next.headers.filter((h) => !CREDENTIAL_HEADER_RE.test(h.key))
    next.body = { type: 'none' } satisfies RequestBody
    next.query = []
  }

  // Replay header ops IN ORDER so set-then-remove of the same name resolves
  // exactly as the plugin wrote it.
  for (const op of patch.headerOps ?? []) {
    if (op.op === 'remove') {
      next.headers = next.headers.filter((h) => h.key.toLowerCase() !== op.key.toLowerCase())
    } else {
      const found = next.headers.find((h) => h.key.toLowerCase() === op.key.toLowerCase())
      if (found) found.value = op.value ?? ''
      else next.headers.push({ key: op.key, value: op.value ?? '', enabled: true })
    }
  }
  return next
}

import type { KV } from '@shared/types'

/** Split a full URL into a base (path) and parsed query params. Values are kept
 *  raw (not decoded) so `{{variables}}` survive. */
export function splitUrl(full: string): { base: string; query: KV[] } {
  const qi = full.indexOf('?')
  if (qi === -1) return { base: full, query: [] }
  const base = full.slice(0, qi)
  const qs = full.slice(qi + 1)
  const query: KV[] = qs
    .split('&')
    .filter((p) => p.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq >= 0
        ? { key: pair.slice(0, eq), value: pair.slice(eq + 1), enabled: true }
        : { key: pair, value: '', enabled: true }
    })
  return { base, query }
}

/** Build the displayed URL = base + enabled query (raw, no encoding). */
export function joinUrl(base: string, query: KV[]): string {
  const enabled = query.filter((q) => q.enabled && q.key)
  if (!enabled.length) return base
  const sep = base.includes('?') ? '&' : '?'
  return base + sep + enabled.map((q) => (q.value !== '' ? `${q.key}=${q.value}` : q.key)).join('&')
}

/** When the URL bar is edited, derive the new query while preserving any
 *  previously-disabled params. */
export function mergeQueryFromUrl(prev: KV[], full: string): { base: string; query: KV[] } {
  const { base, query } = splitUrl(full)
  const parsedKeys = new Set(query.map((q) => q.key))
  const preservedDisabled = prev.filter((q) => !q.enabled && q.key && !parsedKeys.has(q.key))
  return { base, query: [...query, ...preservedDisabled] }
}

/** Detect `:name` path variables in a URL path. */
export function detectPathVars(url: string): string[] {
  const base = url.split('?')[0]
  const matches = base.match(/:([A-Za-z_][A-Za-z0-9_]*)/g) ?? []
  return [...new Set(matches.map((s) => s.slice(1)))]
}

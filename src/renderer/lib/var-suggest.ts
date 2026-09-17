/**
 * `{{` autocomplete: what to offer while a variable reference is being typed.
 *
 * Pure and store-free so it can be unit-tested and reused by both surfaces that
 * take variables — the highlighted single-line inputs (URL, params, headers,
 * auth) and the Monaco editors (body, scripts). The UI decides how to render;
 * this module only decides WHAT matches, in WHICH order, and how the accepted
 * name is written back into the text.
 */
import type { VariableScope } from '@shared/types'
import { DYNAMIC_VAR_NAMES } from '@shared/interpolate'

/** Where a suggestion comes from; also its precedence, highest first. */
export type SuggestSource = 'local' | 'collection' | 'environment' | 'global' | 'dynamic'

export interface VarSuggestion {
  name: string
  source: SuggestSource
  /** Current value; undefined for dynamic variables (generated per send). */
  value?: string
  /** Value is stored as a secret — the caller masks the preview. */
  secret?: boolean
}

/** The `{{…}}` reference the caret sits in. */
export interface VarQuery {
  /** Index of the opening `{{`. */
  start: number
  /** Index just past the text an accepted suggestion replaces. */
  end: number
  /** What is typed between `{{` and the caret — the filter. */
  query: string
}

/** Precedence order of the scope maps, highest first (mirrors the resolver). */
const SCOPE_ORDER: readonly Exclude<SuggestSource, 'dynamic'>[] = ['local', 'collection', 'environment', 'global']

/**
 * Find the unclosed (or caret-enclosing) `{{` reference at `caret`, or null when
 * the caret is not inside one.
 *
 * `{{ba|` completes into a new reference; `{{ba|se}}` replaces the whole
 * existing one, which is what makes re-picking a variable painless. A `{` or `}`
 * between the braces and the caret means the caret is no longer in that
 * reference, so nothing is offered.
 */
export function varQueryAt(value: string, caret: number): VarQuery | null {
  const pos = Math.max(0, Math.min(caret, value.length))
  const start = value.lastIndexOf('{{', pos)
  if (start < 0) return null
  const query = value.slice(start + 2, pos)
  if (/[{}\n]/.test(query)) return null
  // Swallow the rest of an existing reference, so accepting a suggestion
  // replaces `{{base}}` rather than nesting inside it.
  const rest = value.slice(pos)
  const close = rest.indexOf('}}')
  const end = close >= 0 && !/[{\n]/.test(rest.slice(0, close)) ? pos + close + 2 : pos
  return { start, end, query }
}

/** Rank: prefix matches first, then substring; alphabetical inside each group. */
function rank(name: string, needle: string): number {
  if (!needle) return 1
  const lower = name.toLowerCase()
  if (lower.startsWith(needle)) return 0
  return lower.includes(needle) ? 1 : -1
}

/**
 * Variables worth offering for `query`, most relevant first.
 *
 * A name defined in several scopes appears once, attributed to the scope that
 * would actually win. Dynamic `{{$...}}` variables come last — unless the query
 * starts with `$`, when they are all the user can mean.
 */
export function suggestVars(
  query: string,
  scope?: VariableScope,
  opts: { secrets?: ReadonlySet<string>; limit?: number } = {}
): VarSuggestion[] {
  const needle = query.trim().toLowerCase()
  const limit = opts.limit ?? 40
  const seen = new Set<string>()
  const plain: { s: VarSuggestion; r: number }[] = []

  if (!needle.startsWith('$')) {
    for (const source of SCOPE_ORDER) {
      const map = scope?.[source]
      if (!map) continue
      for (const name of Object.keys(map)) {
        if (!name || seen.has(name)) continue
        seen.add(name)
        const r = rank(name, needle)
        if (r < 0) continue
        plain.push({ s: { name, source, value: map[name], secret: opts.secrets?.has(name) }, r })
      }
    }
    plain.sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name))
  }

  const dynamic: { s: VarSuggestion; r: number }[] = []
  for (const name of DYNAMIC_VAR_NAMES) {
    const r = rank(name, needle)
    if (r < 0) continue
    dynamic.push({ s: { name, source: 'dynamic' }, r })
  }
  dynamic.sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name))

  return [...plain, ...dynamic].slice(0, limit).map((x) => x.s)
}

/** Write an accepted suggestion back into the text, with the new caret offset. */
export function applyVarSuggestion(value: string, q: VarQuery, name: string): { value: string; caret: number } {
  const inserted = `{{${name}}}`
  return {
    value: value.slice(0, q.start) + inserted + value.slice(q.end),
    caret: q.start + inserted.length
  }
}

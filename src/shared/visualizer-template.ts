/**
 * A tiny, SAFE, pure Mustache/Handlebars-ish template renderer.
 *
 * It powers the response "visualizer": a user-authored template is rendered
 * against response data and the resulting HTML is shown inside a locked-down
 * `<iframe sandbox>` (no `allow-scripts`). Even so, BOTH the template and the
 * data are treated as untrusted:
 *  - There is NO `eval`, NO `new Function`, and NO code execution of any kind —
 *    only a fixed grammar is interpreted.
 *  - Interpolations are HTML-escaped by default.
 *  - Path resolution refuses to traverse `__proto__`, `prototype`, or
 *    `constructor`, so no prototype data can leak into the output.
 *
 * Supported grammar (and ONLY this):
 *   {{ path }}            HTML-escaped value
 *   {{{ path }}}          RAW (unescaped) value — see security note below
 *   {{#each path}}..{{/each}}      iterate arrays / object values
 *   {{#if path}}..{{else}}..{{/if}}
 *   {{#unless path}}..{{else}}..{{/unless}}
 * Inside blocks: {{this}} / {{.}} = current item, {{@index}} = array index,
 * {{@key}} = object key. Dotted paths and array indices are supported
 * (e.g. {{a.b}}, {{items.0.name}}). Unknown paths render as ''.
 *
 * SECURITY NOTE on triple-stash `{{{ }}}`: it emits unescaped HTML. This is
 * only acceptable because the consumer renders the output in a script-disabled
 * sandboxed iframe. Do not feed this renderer's `{{{ }}}` output into a live DOM
 * without that sandbox.
 */

/** Path segments that must never be resolved, to prevent prototype leakage. */
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Escape the five significant HTML characters. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Coerce a resolved value to its string form for output. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  // Objects/arrays: JSON for a best-effort, non-throwing representation.
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/**
 * A rendering scope: the current data value plus iteration metadata that block
 * helpers expose via {{@index}} / {{@key}}. Scopes form a stack so nested
 * blocks can fall back to outer data when a key is not found locally.
 */
interface Scope {
  value: unknown
  index?: number
  key?: string
  parent?: Scope
}

/** Truthiness rules: false, 0, '', null, undefined, NaN, and [] are falsy. */
function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  return Boolean(value)
}

/**
 * Resolve a single property/index from a container without touching dangerous
 * keys or inherited prototype members.
 */
function getMember(container: unknown, segment: string): unknown {
  if (container === null || container === undefined) return undefined
  if (BLOCKED_KEYS.has(segment)) return undefined

  if (Array.isArray(container)) {
    // Only numeric indices are valid on arrays (avoid exposing .length, etc.).
    if (!/^\d+$/.test(segment)) return undefined
    const idx = Number(segment)
    return idx < container.length ? container[idx] : undefined
  }

  if (typeof container === 'object') {
    // Own, enumerable properties only — never inherited prototype members.
    if (Object.prototype.hasOwnProperty.call(container, segment)) {
      return (container as Record<string, unknown>)[segment]
    }
    return undefined
  }

  // Primitives have no traversable members for our purposes.
  return undefined
}

/**
 * Resolve a dotted path against the scope stack.
 * `this`, `.`, and the empty path all refer to the current scope value.
 */
function resolvePath(path: string, scope: Scope): unknown {
  const trimmed = path.trim()

  // Iteration metadata helpers.
  if (trimmed === '@index') return findIndex(scope)
  if (trimmed === '@key') return findKey(scope)

  if (trimmed === '' || trimmed === '.' || trimmed === 'this') return scope.value

  // A path may be rooted at `this`/`.` (e.g. `this.x`) — strip that prefix and
  // resolve the rest against the current scope value. Otherwise resolve against
  // the current value first, then walk up to parent scopes if the head segment
  // is not found locally (Handlebars-like lookup).
  let segments = trimmed.split('.')

  if (segments[0] === 'this' || segments[0] === '') {
    segments = segments.slice(1)
    return walk(scope.value, segments)
  }

  // Try the current scope, then ancestors, using the FIRST segment as the probe.
  for (let s: Scope | undefined = scope; s; s = s.parent) {
    const head = getMember(s.value, segments[0])
    if (head !== undefined) {
      return walk(s.value, segments)
    }
  }
  return undefined
}

function walk(root: unknown, segments: string[]): unknown {
  let current: unknown = root
  for (const seg of segments) {
    if (seg === '') continue
    current = getMember(current, seg)
    if (current === undefined) return undefined
  }
  return current
}

function findIndex(scope: Scope | undefined): number | undefined {
  for (let s = scope; s; s = s.parent) {
    if (s.index !== undefined) return s.index
  }
  return undefined
}

function findKey(scope: Scope | undefined): string | undefined {
  for (let s = scope; s; s = s.parent) {
    if (s.key !== undefined) return s.key
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { type: 'text'; value: string }
  | { type: 'raw'; path: string } // {{{ x }}}
  | { type: 'interp'; path: string } // {{ x }}
  | { type: 'open'; helper: 'each' | 'if' | 'unless'; path: string } // {{#each x}}
  | { type: 'else' } // {{else}}
  | { type: 'close'; helper: 'each' | 'if' | 'unless' } // {{/each}}
  | { type: 'comment' } // {{! ... }}

/**
 * Convert the template string into a flat token list. Unknown/garbled mustache
 * expressions are emitted as literal text (best-effort, never throws).
 */
function tokenize(template: string): Token[] {
  const tokens: Token[] = []
  const len = template.length
  let i = 0
  let textStart = 0

  const flushText = (end: number): void => {
    if (end > textStart) tokens.push({ type: 'text', value: template.slice(textStart, end) })
  }

  while (i < len) {
    const open = template.indexOf('{{', i)
    if (open === -1) break

    // Triple-stash {{{ ... }}} takes precedence over double.
    const isTriple = template[open + 2] === '{'
    const closeTag = isTriple ? '}}}' : '}}'
    const contentStart = open + (isTriple ? 3 : 2)
    const close = template.indexOf(closeTag, contentStart)

    if (close === -1) {
      // No closing tag: the rest is literal text.
      break
    }

    flushText(open)

    const inner = template.slice(contentStart, close)
    tokens.push(classify(inner, isTriple))

    i = close + closeTag.length
    textStart = i
  }

  flushText(len)
  return tokens
}

/** Turn the inside of a `{{ ... }}` into a token. */
function classify(innerRaw: string, isTriple: boolean): Token {
  const inner = innerRaw.trim()

  if (isTriple) {
    return { type: 'raw', path: inner }
  }

  if (inner.startsWith('!')) {
    return { type: 'comment' }
  }

  if (inner === 'else') {
    return { type: 'else' }
  }

  if (inner.startsWith('#')) {
    const body = inner.slice(1).trim()
    const sp = body.search(/\s/)
    const helper = (sp === -1 ? body : body.slice(0, sp)) as string
    const path = sp === -1 ? '' : body.slice(sp).trim()
    if (helper === 'each' || helper === 'if' || helper === 'unless') {
      return { type: 'open', helper, path }
    }
    // Unknown helper → render literally so nothing is silently dropped.
    return { type: 'text', value: `{{${innerRaw}}}` }
  }

  if (inner.startsWith('/')) {
    const helper = inner.slice(1).trim() as string
    if (helper === 'each' || helper === 'if' || helper === 'unless') {
      return { type: 'close', helper }
    }
    return { type: 'text', value: `{{${innerRaw}}}` }
  }

  // Plain interpolation (also handles a leading `&` Handlebars raw form).
  if (inner.startsWith('&')) {
    return { type: 'raw', path: inner.slice(1).trim() }
  }
  return { type: 'interp', path: inner }
}

// ---------------------------------------------------------------------------
// Parser → AST
// ---------------------------------------------------------------------------

type Node =
  | { type: 'text'; value: string }
  | { type: 'raw'; path: string }
  | { type: 'interp'; path: string }
  | { type: 'block'; helper: 'each' | 'if' | 'unless'; path: string; body: Node[]; alt: Node[] }

/**
 * Build a nested AST from the flat token list. Mismatched/dangling close tags
 * are tolerated; a block opened but never closed simply consumes the remaining
 * tokens.
 */
function parse(tokens: Token[]): Node[] {
  let pos = 0

  function parseList(stopHelper?: 'each' | 'if' | 'unless'): { nodes: Node[]; alt?: Node[] } {
    const nodes: Node[] = []
    let alt: Node[] | undefined

    while (pos < tokens.length) {
      const tok = tokens[pos]

      if (tok.type === 'close') {
        if (stopHelper && tok.helper === stopHelper) {
          pos++ // consume the matching close
          return { nodes, alt }
        }
        // A close with no matching open: skip it (best-effort).
        pos++
        continue
      }

      if (tok.type === 'else') {
        if (stopHelper) {
          pos++ // consume the else
          // Everything until the matching close belongs to the alternate branch.
          const altResult = parseList(stopHelper)
          return { nodes, alt: altResult.nodes }
        }
        // An else outside a block: ignore it.
        pos++
        continue
      }

      if (tok.type === 'comment') {
        pos++
        continue
      }

      if (tok.type === 'text') {
        nodes.push({ type: 'text', value: tok.value })
        pos++
        continue
      }

      if (tok.type === 'raw') {
        nodes.push({ type: 'raw', path: tok.path })
        pos++
        continue
      }

      if (tok.type === 'interp') {
        nodes.push({ type: 'interp', path: tok.path })
        pos++
        continue
      }

      if (tok.type === 'open') {
        const helper = tok.helper
        const path = tok.path
        pos++ // consume the open
        const inner = parseList(helper)
        nodes.push({ type: 'block', helper, path, body: inner.nodes, alt: inner.alt ?? [] })
        continue
      }

      // Should be unreachable, but advance to avoid an infinite loop.
      pos++
    }

    return { nodes, alt }
  }

  return parseList().nodes
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderNodes(nodes: Node[], scope: Scope): string {
  let out = ''
  for (const node of nodes) {
    out += renderNode(node, scope)
  }
  return out
}

function renderNode(node: Node, scope: Scope): string {
  switch (node.type) {
    case 'text':
      return node.value
    case 'interp':
      return escapeHtml(stringify(resolvePath(node.path, scope)))
    case 'raw':
      return stringify(resolvePath(node.path, scope))
    case 'block':
      return renderBlock(node, scope)
    default:
      return ''
  }
}

function renderBlock(
  node: Extract<Node, { type: 'block' }>,
  scope: Scope
): string {
  const value = resolvePath(node.path, scope)

  if (node.helper === 'if') {
    return isTruthy(value)
      ? renderNodes(node.body, scope)
      : renderNodes(node.alt, scope)
  }

  if (node.helper === 'unless') {
    return !isTruthy(value)
      ? renderNodes(node.body, scope)
      : renderNodes(node.alt, scope)
  }

  // each
  if (Array.isArray(value)) {
    if (value.length === 0) return renderNodes(node.alt, scope)
    let out = ''
    for (let idx = 0; idx < value.length; idx++) {
      out += renderNodes(node.body, { value: value[idx], index: idx, parent: scope })
    }
    return out
  }

  if (value !== null && typeof value === 'object') {
    // Iterate own enumerable keys (object iteration exposes {{@key}}).
    const keys = Object.keys(value as Record<string, unknown>).filter((k) => !BLOCKED_KEYS.has(k))
    if (keys.length === 0) return renderNodes(node.alt, scope)
    let out = ''
    for (const k of keys) {
      out += renderNodes(node.body, {
        value: (value as Record<string, unknown>)[k],
        key: k,
        parent: scope
      })
    }
    return out
  }

  // Not iterable → the {{else}} branch (empty if none).
  return renderNodes(node.alt, scope)
}

/**
 * Render a Mustache-ish template against `data`. Interpolations are HTML-escaped
 * by default; `{{{ }}}` emits raw. Never executes code and never throws.
 */
export function renderTemplate(template: string, data: unknown): string {
  if (typeof template !== 'string' || template.length === 0) return ''
  try {
    const tokens = tokenize(template)
    const ast = parse(tokens)
    return renderNodes(ast, { value: data })
  } catch {
    // Defensive: any unexpected error yields empty output rather than crashing
    // the visualizer / caller.
    return ''
  }
}

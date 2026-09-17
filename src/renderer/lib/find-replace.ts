/**
 * Workspace-wide find & replace (Postman's "Find and Replace").
 *
 * The module is pure: it turns collections, folders, environments and globals
 * into a flat list of addressable text fields, searches them, and writes a new
 * value back into a copy of the owning object. The store does the wiring, the
 * modal does the rendering — everything here is unit-testable.
 */
import type { CollectionFolderNode, CollectionNode, Environment, RequestModel, VariableDef } from '@shared/types'

/** Groups of fields a search can be limited to. */
export type FindArea = 'name' | 'url' | 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'description' | 'variables'

export const FIND_AREAS: { id: FindArea; label: string }[] = [
  { id: 'name', label: 'Названия' },
  { id: 'url', label: 'URL' },
  { id: 'params', label: 'Параметры' },
  { id: 'headers', label: 'Заголовки' },
  { id: 'body', label: 'Тело' },
  { id: 'auth', label: 'Авторизация' },
  { id: 'scripts', label: 'Скрипты и тесты' },
  { id: 'description', label: 'Описания' },
  { id: 'variables', label: 'Переменные' }
]

/** Where a field lives inside its owner — enough to write the new value back. */
export type FieldPath =
  | { t: 'name' }
  | { t: 'url' }
  | { t: 'description' }
  | { t: 'script'; which: 'pre' | 'test' }
  | { t: 'kv'; list: 'query' | 'headers' | 'pathVariables' | 'urlencoded' | 'formdata'; index: number; part: 'key' | 'value' }
  | { t: 'bodyRaw' }
  | { t: 'graphql'; part: 'query' | 'variables' }
  | { t: 'auth'; key: string }
  | { t: 'var'; index: number; part: 'key' | 'value' }

export type OwnerKind = 'request' | 'folder' | 'environment' | 'globals'

/** One editable string somewhere in the workspace. */
export interface Field {
  ownerKind: OwnerKind
  ownerId: string
  /** breadcrumb shown in the results list, e.g. "Acme API / Products / List" */
  ownerPath: string
  area: FindArea
  /** what this field is, e.g. "Заголовок · Authorization" */
  label: string
  path: FieldPath
  value: string
}

export interface Hit {
  /** stable across re-searches: owner + field address */
  id: string
  field: Field
  /** number of occurrences in this field */
  count: number
  /** the field's value after replacing every occurrence */
  replaced: string
}

export interface FindOptions {
  query: string
  matchCase: boolean
  wholeWord: boolean
  useRegex: boolean
  areas: FindArea[]
}

export const DEFAULT_AREAS: FindArea[] = FIND_AREAS.map((a) => a.id)

/* ============================================================
 * Matching
 * ============================================================ */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile the search into a global RegExp, or null when the query is empty or
 * an invalid user-written pattern (the UI shows that as "неверное выражение").
 */
export function buildMatcher(opts: Pick<FindOptions, 'query' | 'matchCase' | 'wholeWord' | 'useRegex'>): RegExp | null {
  if (!opts.query) return null
  let source = opts.useRegex ? opts.query : escapeRegex(opts.query)
  // \b only works next to word characters; for anything else it would never match.
  if (opts.wholeWord && /^\w/.test(opts.query) && /\w$/.test(opts.query)) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, opts.matchCase ? 'g' : 'gi')
  } catch {
    return null
  }
}

/**
 * Replacement text with regex group references ($1, $&) left intact for regex
 * searches, and taken literally otherwise — a plain-text search for "a$b"
 * must not turn "$b" into a capture reference.
 */
function replacementFor(replacement: string, useRegex: boolean): string {
  return useRegex ? replacement : replacement.replace(/\$/g, '$$$$')
}

/** Occurrences of `re` in `value`; the regex is rewound before and after. */
export function countMatches(re: RegExp, value: string): number {
  re.lastIndex = 0
  let n = 0
  // A pattern that can match the empty string would spin forever otherwise.
  for (let m = re.exec(value); m; m = re.exec(value)) {
    n++
    if (m[0] === '') re.lastIndex++
  }
  re.lastIndex = 0
  return n
}

/* ============================================================
 * Collecting fields
 * ============================================================ */

function kvFields(
  items: { key: string; value: string }[] | undefined,
  list: Extract<FieldPath, { t: 'kv' }>['list'],
  area: FindArea,
  label: string,
  base: Omit<Field, 'area' | 'label' | 'path' | 'value'>
): Field[] {
  const out: Field[] = []
  items?.forEach((item, index) => {
    for (const part of ['key', 'value'] as const) {
      const value = part === 'key' ? item.key : item.value
      if (!value) continue
      out.push({ ...base, area, label: `${label} · ${item.key || '—'}`, path: { t: 'kv', list, index, part }, value })
    }
  })
  return out
}

/** Every searchable string of one saved request. */
export function fieldsOfRequest(request: RequestModel, ownerPath: string): Field[] {
  const base = { ownerKind: 'request' as const, ownerId: request.id, ownerPath }
  const out: Field[] = []
  const push = (area: FindArea, label: string, path: FieldPath, value: string | undefined): void => {
    if (value) out.push({ ...base, area, label, path, value })
  }

  push('name', 'Название запроса', { t: 'name' }, request.name)
  push('url', 'URL', { t: 'url' }, request.url)
  push('description', 'Описание', { t: 'description' }, request.description)
  out.push(...kvFields(request.query, 'query', 'params', 'Параметр', base))
  out.push(...kvFields(request.pathVariables, 'pathVariables', 'params', 'Path-переменная', base))
  out.push(...kvFields(request.headers, 'headers', 'headers', 'Заголовок', base))

  const body = request.body
  if (body.type === 'raw') push('body', 'Тело запроса', { t: 'bodyRaw' }, body.text)
  else if (body.type === 'graphql') {
    push('body', 'GraphQL-запрос', { t: 'graphql', part: 'query' }, body.query)
    push('body', 'GraphQL-переменные', { t: 'graphql', part: 'variables' }, body.variables)
  } else if (body.type === 'urlencoded') out.push(...kvFields(body.items, 'urlencoded', 'body', 'Поле формы', base))
  else if (body.type === 'formdata') out.push(...kvFields(body.items, 'formdata', 'body', 'Поле формы', base))

  // Auth carries a different set of string fields per scheme; walking them
  // generically covers bearer, basic, api-key, OAuth 2 and the rest at once.
  for (const [key, value] of Object.entries(request.auth ?? {})) {
    if (key === 'type' || typeof value !== 'string') continue
    push('auth', `Авторизация · ${key}`, { t: 'auth', key }, value)
  }

  push('scripts', 'Pre-request скрипт', { t: 'script', which: 'pre' }, request.preRequestScript)
  push('scripts', 'Тесты', { t: 'script', which: 'test' }, request.testScript)
  return out
}

/** Searchable strings of a collection/folder node itself (not its children). */
export function fieldsOfFolder(node: CollectionFolderNode, ownerPath: string): Field[] {
  const base = { ownerKind: 'folder' as const, ownerId: node.id, ownerPath }
  const out: Field[] = []
  const isCollection = node.type === 'collection'
  if (node.name) out.push({ ...base, area: 'name', label: isCollection ? 'Название коллекции' : 'Название папки', path: { t: 'name' }, value: node.name })
  if (node.description) out.push({ ...base, area: 'description', label: 'Описание', path: { t: 'description' }, value: node.description })
  node.variables?.forEach((v, index) => {
    for (const part of ['key', 'value'] as const) {
      const value = part === 'key' ? v.key : v.value
      if (value) out.push({ ...base, area: 'variables', label: `Переменная коллекции · ${v.key || '—'}`, path: { t: 'var', index, part }, value })
    }
  })
  if (node.preRequestScript) out.push({ ...base, area: 'scripts', label: 'Pre-request скрипт', path: { t: 'script', which: 'pre' }, value: node.preRequestScript })
  if (node.testScript) out.push({ ...base, area: 'scripts', label: 'Тесты', path: { t: 'script', which: 'test' }, value: node.testScript })
  return out
}

/** Searchable strings of one environment (or the globals list). */
export function fieldsOfVariables(
  ownerKind: Extract<OwnerKind, 'environment' | 'globals'>,
  ownerId: string,
  ownerPath: string,
  name: string | null,
  variables: VariableDef[]
): Field[] {
  const base = { ownerKind, ownerId, ownerPath }
  const out: Field[] = []
  if (name) out.push({ ...base, area: 'name', label: 'Название окружения', path: { t: 'name' }, value: name })
  variables.forEach((v, index) => {
    for (const part of ['key', 'value'] as const) {
      const value = part === 'key' ? v.key : v.value
      // A secret's value never leaves the row it is stored in.
      if (!value || (part === 'value' && v.secret)) continue
      out.push({ ...base, area: 'variables', label: `Переменная · ${v.key || '—'}`, path: { t: 'var', index, part }, value })
    }
  })
  return out
}

/** Walk the collection tree, producing every field with a readable breadcrumb. */
export function fieldsOfCollections(collections: CollectionFolderNode[]): Field[] {
  const out: Field[] = []
  const walk = (node: CollectionNode, trail: string[]): void => {
    if (node.type === 'request') {
      out.push(...fieldsOfRequest(node.request, [...trail, node.request.name].filter(Boolean).join(' / ')))
      return
    }
    const path = [...trail, node.name].filter(Boolean)
    out.push(...fieldsOfFolder(node, path.join(' / ')))
    for (const child of node.children) walk(child, path)
  }
  for (const c of collections) walk(c, [])
  return out
}

/* ============================================================
 * Searching
 * ============================================================ */

export function fieldId(field: Field): string {
  const p = field.path
  const tail =
    p.t === 'kv'
      ? `kv:${p.list}:${p.index}:${p.part}`
      : p.t === 'var'
        ? `var:${p.index}:${p.part}`
        : p.t === 'script'
          ? `script:${p.which}`
          : p.t === 'auth'
            ? `auth:${p.key}`
            : p.t === 'graphql'
              ? `graphql:${p.part}`
              : p.t
  return `${field.ownerKind}:${field.ownerId}:${tail}`
}

/** Hits for the fields the options allow, in the order the fields came in. */
export function search(fields: Field[], opts: FindOptions, replacement: string): Hit[] {
  const re = buildMatcher(opts)
  if (!re) return []
  const allowed = new Set(opts.areas)
  const to = replacementFor(replacement, opts.useRegex)
  const hits: Hit[] = []
  for (const field of fields) {
    if (!allowed.has(field.area)) continue
    const count = countMatches(re, field.value)
    if (!count) continue
    re.lastIndex = 0
    hits.push({ id: fieldId(field), field, count, replaced: field.value.replace(re, to) })
    re.lastIndex = 0
  }
  return hits
}

/** First occurrence with up to `pad` characters of context on each side. */
export function previewOf(hit: Hit, opts: FindOptions, pad = 36): { before: string; match: string; after: string } {
  const re = buildMatcher(opts)
  const value = hit.field.value
  const m = re ? re.exec(value) : null
  if (!m) return { before: value.slice(0, pad), match: '', after: '' }
  const start = m.index
  const end = start + m[0].length
  return {
    before: (start > pad ? '…' : '') + value.slice(Math.max(0, start - pad), start),
    match: m[0],
    after: value.slice(end, end + pad) + (value.length > end + pad ? '…' : '')
  }
}

/* ============================================================
 * Writing values back
 * ============================================================ */

function setKv<T extends { key: string; value: string }>(items: T[], index: number, part: 'key' | 'value', value: string): T[] {
  return items.map((item, i) => (i === index ? { ...item, [part]: value } : item))
}

/** A copy of the request with one field replaced. Unknown paths return the input. */
export function applyToRequest(request: RequestModel, path: FieldPath, value: string): RequestModel {
  switch (path.t) {
    case 'name':
      return { ...request, name: value }
    case 'url':
      return { ...request, url: value }
    case 'description':
      return { ...request, description: value }
    case 'script':
      return path.which === 'pre' ? { ...request, preRequestScript: value } : { ...request, testScript: value }
    case 'bodyRaw':
      return request.body.type === 'raw' ? { ...request, body: { ...request.body, text: value } } : request
    case 'graphql':
      return request.body.type === 'graphql' ? { ...request, body: { ...request.body, [path.part]: value } } : request
    case 'auth':
      return { ...request, auth: { ...request.auth, [path.key]: value } as RequestModel['auth'] }
    case 'kv': {
      if (path.list === 'urlencoded') {
        return request.body.type === 'urlencoded'
          ? { ...request, body: { ...request.body, items: setKv(request.body.items, path.index, path.part, value) } }
          : request
      }
      if (path.list === 'formdata') {
        return request.body.type === 'formdata'
          ? { ...request, body: { ...request.body, items: setKv(request.body.items, path.index, path.part, value) } }
          : request
      }
      return { ...request, [path.list]: setKv(request[path.list], path.index, path.part, value) }
    }
    default:
      return request
  }
}

/** A copy of the collection/folder node with one field replaced. */
export function applyToFolder(node: CollectionFolderNode, path: FieldPath, value: string): CollectionFolderNode {
  switch (path.t) {
    case 'name':
      return { ...node, name: value }
    case 'description':
      return { ...node, description: value }
    case 'script':
      return path.which === 'pre' ? { ...node, preRequestScript: value } : { ...node, testScript: value }
    case 'var':
      return { ...node, variables: setKv(node.variables ?? [], path.index, path.part, value) }
    default:
      return node
  }
}

/** A copy of the variable list with one key/value replaced. */
export function applyToVariables(variables: VariableDef[], path: FieldPath, value: string): VariableDef[] {
  return path.t === 'var' ? setKv(variables, path.index, path.part, value) : variables
}

/** A copy of the environment with its name or one variable replaced. */
export function applyToEnvironment(env: Environment, path: FieldPath, value: string): Environment {
  if (path.t === 'name') return { ...env, name: value }
  return { ...env, variables: applyToVariables(env.variables, path, value) }
}

/**
 * Variable import: turn a file someone already has into Relay variables.
 *
 * Understood formats (detected from the text, no questions asked):
 *  - Postman environment / globals export (`values[]`, `_postman_variable_scope`);
 *  - a Postman collection — its collection variables (`variable[]`);
 *  - a JSON array of `{ key|name, value, enabled?, disabled?, secret?, type? }`;
 *  - a JSON object `{ "key": value }`; nested objects are flattened with dots
 *    (`{ "db": { "host": … } }` → `db.host`), the shape Insomnia environments use;
 *  - a `.env` file (`KEY=value`, `export`, quotes, comments);
 *  - CSV / TSV / semicolon tables, with or without a `key,value` header.
 *
 * Pure module — shared by the renderer dialog and the unit tests.
 */
import { makeId } from './id'
import type { VariableDef } from './types'

export type VarImportFormat = 'postman-environment' | 'postman-globals' | 'postman-collection' | 'json' | 'dotenv' | 'csv'

export interface VarImportResult {
  format: VarImportFormat
  /** name carried by the file (Postman environment name), if any */
  name?: string
  variables: VariableDef[]
  warnings: string[]
}

export type VarMergeMode = 'merge' | 'replace'

const MAX_VARS = 5000
const KEY_MAX = 256

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function toValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function variable(key: string, value: unknown, enabled = true, secret = false): VariableDef {
  const out: VariableDef = { id: makeId('var'), key: key.trim(), value: toValue(value), enabled }
  if (secret) out.secret = true
  return out
}

/** `{key|name, value, …}` entries as used by Postman, Insomnia and hand-written lists. */
function fromEntries(list: unknown[], warnings: string[]): VariableDef[] {
  const out: VariableDef[] = []
  list.forEach((raw, i) => {
    if (!isObj(raw)) return void warnings.push(`entry ${i + 1} is not an object — skipped`)
    const key = typeof raw.key === 'string' ? raw.key : typeof raw.name === 'string' ? raw.name : ''
    if (!key.trim()) return void warnings.push(`entry ${i + 1} has no key — skipped`)
    // Postman: `enabled: false` (environments) or `disabled: true` (collections).
    const enabled = raw.enabled !== false && raw.disabled !== true
    const secret = raw.type === 'secret' || raw.secret === true
    // Postman exports keep the shared value in `value`; some tools use `currentValue` / `initialValue`.
    const value = 'value' in raw ? raw.value : 'currentValue' in raw ? raw.currentValue : raw.initialValue
    out.push(variable(key, value, enabled, secret))
  })
  return out
}

/** Flatten nested objects to dotted keys; arrays stay JSON strings. */
function flatten(obj: Record<string, unknown>, prefix = '', out: VariableDef[] = []): VariableDef[] {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (isObj(v)) flatten(v, key, out)
    else out.push(variable(key, v))
  }
  return out
}

function parseJson(text: string): VarImportResult {
  let data: Json
  try {
    data = JSON.parse(text) as Json
  } catch {
    throw new Error('The text starts like JSON but is not valid JSON.')
  }
  const warnings: string[] = []
  if (isObj(data) && Array.isArray(data.values)) {
    const globals = data._postman_variable_scope === 'globals'
    return {
      format: globals ? 'postman-globals' : 'postman-environment',
      name: typeof data.name === 'string' ? data.name : undefined,
      variables: fromEntries(data.values, warnings),
      warnings
    }
  }
  if (isObj(data) && isObj(data.info) && (Array.isArray(data.variable) || Array.isArray(data.item))) {
    const list = Array.isArray(data.variable) ? data.variable : []
    if (!list.length) warnings.push('the collection has no collection variables')
    return {
      format: 'postman-collection',
      name: typeof data.info.name === 'string' ? data.info.name : undefined,
      variables: fromEntries(list, warnings),
      warnings
    }
  }
  if (Array.isArray(data)) return { format: 'json', variables: fromEntries(data, warnings), warnings }
  if (isObj(data)) {
    // An Insomnia environment export wraps its variables in `data`.
    const body = isObj(data.data) && Object.keys(data).every((k) => ['data', 'name', '_id', '_type', 'parentId', 'dataPropertyOrder', 'color', 'isPrivate', 'metaSortKey', 'modified', 'created'].includes(k)) ? data.data : data
    return { format: 'json', name: typeof data.name === 'string' && body !== data ? data.name : undefined, variables: flatten(body), warnings }
  }
  throw new Error('JSON must be an object or an array of variables.')
}

const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/

function unquoteDotenv(raw: string): string {
  const v = raw.trim()
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"')
    const inner = end > 0 ? v.slice(1, end) : v.slice(1)
    return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'")
    return end > 0 ? v.slice(1, end) : v.slice(1)
  }
  // Unquoted: an inline comment starts at " #".
  const hash = v.search(/\s#/)
  return (hash >= 0 ? v.slice(0, hash) : v).trim()
}

function parseDotenv(lines: string[]): VarImportResult {
  const warnings: string[] = []
  const variables: VariableDef[] = []
  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return
    const m = DOTENV_LINE.exec(line)
    if (!m) return void warnings.push(`line ${i + 1} is not KEY=value — skipped`)
    variables.push(variable(m[1], unquoteDotenv(m[2])))
  })
  return { format: 'dotenv', variables, warnings }
}

/**
 * CSV records of a whole text: quoted fields may hold the delimiter, `""`
 * and line breaks. Unquoted fields are trimmed, quoted ones kept verbatim.
 */
function csvRecords(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  let wasQuoted = false
  const endField = (): void => {
    row.push(wasQuoted ? cur : cur.trim())
    cur = ''
    wasQuoted = false
  }
  const endRow = (): void => {
    endField()
    if (row.some((f) => f !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"' && cur.trim() === '') {
      quoted = true
      wasQuoted = true
      cur = ''
    } else if (c === delim) endField()
    else if (c === '\n') endRow()
    else if (c !== '\r') cur += c
  }
  endRow()
  return rows
}

const truthy = (s: string | undefined): boolean => /^(1|true|yes|y|да|secret)$/i.test((s ?? '').trim())
const falsy = (s: string | undefined): boolean => /^(0|false|no|n|нет|disabled)$/i.test((s ?? '').trim())

function parseCsv(text: string): VarImportResult {
  const warnings: string[] = []
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const delim = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ','
  let rows = csvRecords(text, delim).filter((r) => !(r[0] ?? '').startsWith('#'))
  const head = rows[0].map((h) => h.toLowerCase())
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  let keyCol = col('key', 'name', 'variable', 'ключ', 'имя', 'переменная')
  let valueCol = col('value', 'current value', 'initial value', 'значение')
  const enabledCol = col('enabled', 'включена', 'включено')
  const secretCol = col('secret', 'type', 'секрет')
  if (keyCol >= 0) rows = rows.slice(1)
  else {
    keyCol = 0
    valueCol = 1
  }
  if (valueCol < 0) valueCol = keyCol === 0 ? 1 : 0
  const variables: VariableDef[] = []
  rows.forEach((r, i) => {
    const key = r[keyCol] ?? ''
    if (!key) return void warnings.push(`row ${i + 1} has no key — skipped`)
    const enabled = enabledCol >= 0 ? !falsy(r[enabledCol]) : true
    const secret = secretCol >= 0 ? truthy(r[secretCol]) : false
    variables.push(variable(key, r[valueCol] ?? '', enabled, secret))
  })
  return { format: 'csv', variables, warnings }
}

/** Parse any supported format; throws with an English message when nothing fits. */
export function parseVariables(text: string): VarImportResult {
  // A byte-order mark (Windows editors) is not part of the first key.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const trimmed = src.trim()
  if (!trimmed) throw new Error('Nothing to import: the text is empty.')
  let result: VarImportResult
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) result = parseJson(trimmed)
  else {
    const lines = src.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
    const envLike = lines.filter((l) => DOTENV_LINE.test(l)).length
    if (envLike && envLike >= lines.length / 2) result = parseDotenv(src.split(/\r?\n/))
    else if (lines.some((l) => /[,;\t]/.test(l))) result = parseCsv(src)
    else throw new Error('Unknown format. Use a Postman environment, JSON, a .env file or CSV.')
  }
  const tooLong = result.variables.filter((v) => v.key.length > KEY_MAX)
  if (tooLong.length) result.warnings.push(`${tooLong.length} keys are longer than ${KEY_MAX} characters — skipped`)
  result.variables = result.variables.filter((v) => v.key && v.key.length <= KEY_MAX).slice(0, MAX_VARS)
  return result
}

export interface MergeOutcome {
  variables: VariableDef[]
  added: number
  updated: number
  unchanged: number
}

/**
 * Apply imported variables to an existing list. `merge` keeps what is there,
 * updates keys that match (value, enabled, secret flag) and appends new ones;
 * `replace` swaps the whole list. A key repeated inside the import: last wins.
 */
export function mergeVariables(existing: VariableDef[], incoming: VariableDef[], mode: VarMergeMode): MergeOutcome {
  const lastByKey = new Map<string, VariableDef>()
  for (const v of incoming) lastByKey.set(v.key, v)
  const unique = [...lastByKey.values()]
  if (mode === 'replace') return { variables: unique, added: unique.length, updated: 0, unchanged: 0 }

  let updated = 0
  let unchanged = 0
  const seen = new Set<string>()
  const variables = existing.map((v) => {
    const inc = lastByKey.get(v.key)
    if (!inc || seen.has(v.key)) return v
    seen.add(v.key)
    const next: VariableDef = { ...v, value: inc.value, enabled: inc.enabled, secret: inc.secret || v.secret || undefined }
    if (!next.secret) delete next.secret
    if (next.value === v.value && next.enabled === v.enabled && !!next.secret === !!v.secret) unchanged++
    else updated++
    return next
  })
  const fresh = unique.filter((v) => !seen.has(v.key))
  return { variables: [...variables, ...fresh], added: fresh.length, updated, unchanged }
}

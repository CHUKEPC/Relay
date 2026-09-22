/**
 * Variable export — the mirror of `var-import.ts`: every format written here
 * is read back by `parseVariables` without loss (tested as a round trip).
 *
 *  - `postman` — a Postman environment / globals export, importable in Postman;
 *  - `json`    — a flat `{ "key": "value" }` object of the enabled variables;
 *  - `dotenv`  — `KEY=value` lines, quoted where needed (enabled variables);
 *  - `csv`     — `key,value,enabled,secret` with a header row.
 *
 * Secret values are left out (written empty) unless the caller asks for them,
 * so a shared file never carries a token by accident.
 */
import { makeId } from './id'
import type { VariableDef } from './types'

export type VarExportFormat = 'postman' | 'json' | 'dotenv' | 'csv'

export interface VarExportOptions {
  /** name written into the file (Postman) and used for the file name */
  name: string
  /** Postman scope marker: globals stay globals when re-imported */
  scope: 'environment' | 'globals'
  /** write secret values instead of empty strings */
  includeSecrets: boolean
  /** app name/version for Postman's `_postman_exported_using` */
  exportedUsing?: string
}

export interface VarExportResult {
  content: string
  fileName: string
  /** for the save dialog filter */
  extension: string
  /** how many secret values were blanked */
  secretsOmitted: number
}

export const VAR_EXPORT_FORMATS: { id: VarExportFormat; label: string; extension: string }[] = [
  { id: 'postman', label: 'Postman', extension: 'json' },
  { id: 'json', label: 'JSON', extension: 'json' },
  { id: 'dotenv', label: '.env', extension: 'env' },
  { id: 'csv', label: 'CSV', extension: 'csv' }
]

const valueOf = (v: VariableDef, includeSecrets: boolean): string => (v.secret && !includeSecrets ? '' : v.value ?? '')

/** `.env` value: bare when safe, otherwise double-quoted with escapes. */
function dotenvValue(s: string): string {
  if (s === '' || /^[\w@%+=:,./~-]+$/.test(s)) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

/** A CSV field, quoted when it holds a delimiter, quote or line break. */
function csvField(s: string): string {
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** File-name friendly version of a display name. */
function slug(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || 'variables'
}

export function exportVariables(vars: VariableDef[], format: VarExportFormat, opts: VarExportOptions): VarExportResult {
  const list = vars.filter((v) => v.key.trim())
  const secretsOmitted = opts.includeSecrets ? 0 : list.filter((v) => v.secret && v.value).length
  const base = slug(opts.name)

  switch (format) {
    case 'postman': {
      const doc = {
        id: makeId('env'),
        name: opts.name,
        values: list.map((v) => ({
          key: v.key,
          value: valueOf(v, opts.includeSecrets),
          type: v.secret ? 'secret' : 'default',
          enabled: v.enabled
        })),
        _postman_variable_scope: opts.scope,
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: opts.exportedUsing ?? 'Relay'
      }
      const suffix = opts.scope === 'globals' ? 'postman_globals' : 'postman_environment'
      return { content: JSON.stringify(doc, null, 2) + '\n', fileName: `${base}.${suffix}.json`, extension: 'json', secretsOmitted }
    }
    case 'json': {
      const obj: Record<string, string> = {}
      for (const v of list) if (v.enabled) obj[v.key] = valueOf(v, opts.includeSecrets)
      return { content: JSON.stringify(obj, null, 2) + '\n', fileName: `${base}.json`, extension: 'json', secretsOmitted }
    }
    case 'dotenv': {
      const lines = [`# ${opts.name} — exported from ${opts.exportedUsing ?? 'Relay'}`]
      for (const v of list) if (v.enabled) lines.push(`${v.key}=${dotenvValue(valueOf(v, opts.includeSecrets))}`)
      return { content: lines.join('\n') + '\n', fileName: `${base}.env`, extension: 'env', secretsOmitted }
    }
    case 'csv': {
      const rows = ['key,value,enabled,secret']
      for (const v of list) rows.push([csvField(v.key), csvField(valueOf(v, opts.includeSecrets)), v.enabled ? 'true' : 'false', v.secret ? 'true' : 'false'].join(','))
      return { content: rows.join('\n') + '\n', fileName: `${base}.csv`, extension: 'csv', secretsOmitted }
    }
  }
}

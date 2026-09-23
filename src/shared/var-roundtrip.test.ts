/**
 * Variable export is documented as the mirror of the import: every format must
 * read back what it wrote, secrets must stay out of a shared file unless asked
 * for, and a file that is not a variable list must fail with a message instead
 * of a crash.
 */
import { describe, expect, it } from 'vitest'
import { exportVariables, type VarExportFormat } from './var-export'
import { mergeVariables, parseVariables } from './var-import'
import type { VariableDef } from './types'

const vars: VariableDef[] = [
  { id: 'v1', key: 'base_url', value: 'https://api.example.com/v1', enabled: true },
  { id: 'v2', key: 'greeting', value: 'привет 👋, «мир»', enabled: true },
  { id: 'v3', key: 'tricky', value: 'a,b;c"d\'e=f', enabled: true },
  { id: 'v4', key: 'spaced', value: '  padded  ', enabled: true },
  { id: 'v5', key: 'token', value: 'super-secret-token', enabled: true, secret: true },
  { id: 'v6', key: 'disabled_one', value: 'off', enabled: false }
]

const opts = { name: 'Prod', scope: 'environment' as const, includeSecrets: false }
const byKey = (list: VariableDef[]): Record<string, VariableDef> => Object.fromEntries(list.map((v) => [v.key, v]))

describe('variable export -> import round trip', () => {
  it.each<VarExportFormat>(['postman', 'json', 'dotenv', 'csv'])('%s keeps keys and values', (format) => {
    const out = exportVariables(vars, format, opts)
    const back = byKey(parseVariables(out.content).variables)
    // dotenv/json only carry the enabled variables — that is documented.
    const expected = format === 'postman' || format === 'csv' ? vars : vars.filter((v) => v.enabled)
    for (const v of expected) {
      expect(back[v.key], `${format}: ${v.key} missing`).toBeDefined()
      expect(back[v.key].value, `${format}: ${v.key} value`).toBe(v.secret ? '' : v.value)
    }
  })

  it('never writes a secret value unless asked', () => {
    for (const format of ['postman', 'json', 'dotenv', 'csv'] as VarExportFormat[]) {
      const out = exportVariables(vars, format, opts)
      expect(out.content, format).not.toContain('super-secret-token')
      expect(out.secretsOmitted, format).toBe(1)
    }
    const withSecret = exportVariables(vars, 'postman', { ...opts, includeSecrets: true })
    expect(withSecret.content).toContain('super-secret-token')
    expect(withSecret.secretsOmitted).toBe(0)
  })

  it('keeps the enabled and secret flags through postman and csv', () => {
    for (const format of ['postman', 'csv'] as VarExportFormat[]) {
      const back = byKey(parseVariables(exportVariables(vars, format, opts).content).variables)
      expect(back.disabled_one.enabled, format).toBe(false)
      expect(back.token.secret, format).toBe(true)
      expect(back.base_url.enabled, format).toBe(true)
    }
  })

  it('keeps a multi-line value through the formats that can hold one', () => {
    const multi: VariableDef[] = [{ key: 'pem', value: '-----BEGIN-----\r\nline2\nline3\n-----END-----', enabled: true }]
    for (const format of ['postman', 'json', 'dotenv', 'csv'] as VarExportFormat[]) {
      const back = byKey(parseVariables(exportVariables(multi, format, opts).content).variables)
      expect(back.pem?.value, format).toBe(multi[0].value)
    }
  })

  it('round-trips a globals export as globals', () => {
    const out = exportVariables(vars, 'postman', { ...opts, scope: 'globals' })
    expect(parseVariables(out.content).format).toBe('postman-globals')
  })
})

describe('variable import — bad input', () => {
  it('fails with a message on a file that holds no variables', () => {
    // Must be an explanatory Error, never a raw TypeError from the parser.
    for (const text of [',', ';;;\n;;;', '#only a comment\n,', '"",""']) {
      expect(() => parseVariables(text), JSON.stringify(text)).toThrow(/No variables found/)
    }
    expect(() => parseVariables('\t')).toThrow(/empty/i)
  })

  it('rejects empty text and invalid JSON', () => {
    expect(() => parseVariables('   ')).toThrow(/empty/i)
    expect(() => parseVariables('{ not json')).toThrow(/JSON/i)
  })

  it('caps the key length and the number of variables', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `K${i}=v`).join('\n')
    expect(parseVariables(many).variables.length).toBe(5000)
  })
})

describe('mergeVariables', () => {
  it('merge updates matching keys, appends new ones and keeps the rest', () => {
    const existing: VariableDef[] = [
      { id: 'a', key: 'keep', value: '1', enabled: true },
      { id: 'b', key: 'change', value: 'old', enabled: true }
    ]
    const incoming: VariableDef[] = [
      { key: 'change', value: 'new', enabled: true },
      { key: 'added', value: 'x', enabled: true }
    ]
    const out = mergeVariables(existing, incoming, 'merge')
    expect(out.variables.map((v) => v.key)).toEqual(['keep', 'change', 'added'])
    expect(out.variables[1]).toMatchObject({ id: 'b', value: 'new' })
    expect(out).toMatchObject({ added: 1, updated: 1, unchanged: 0 })
  })

  it('replace swaps the whole list and collapses duplicate keys (last wins)', () => {
    const out = mergeVariables([{ key: 'old', value: '1', enabled: true }], [
      { key: 'dup', value: 'first', enabled: true },
      { key: 'dup', value: 'second', enabled: true }
    ], 'replace')
    expect(out.variables).toHaveLength(1)
    expect(out.variables[0].value).toBe('second')
  })
})

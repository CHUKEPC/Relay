import { describe, expect, it } from 'vitest'
import { exportVariables, type VarExportFormat } from './var-export'
import { parseVariables } from './var-import'
import type { VariableDef } from './types'

const vars: VariableDef[] = [
  { id: '1', key: 'baseUrl', value: 'https://api.example.com/v1', enabled: true },
  { id: '2', key: 'token', value: 's3cr3t "quoted"', enabled: true, secret: true },
  { id: '3', key: 'multi', value: 'line one\nline two, with comma', enabled: true },
  { id: '4', key: 'spaced', value: '  padded  ', enabled: true },
  { id: '5', key: 'db.host', value: 'localhost', enabled: true },
  { id: '6', key: 'off', value: 'x=y # not a comment', enabled: false },
  { id: '7', key: 'empty', value: '', enabled: true }
]
const opts = { name: 'Stage', scope: 'environment' as const, includeSecrets: true }
const shape = (list: VariableDef[]) => list.map((v) => [v.key, v.value, v.enabled, !!v.secret])

describe('exportVariables', () => {
  it('Postman: a real environment export that round-trips exactly', () => {
    const out = exportVariables(vars, 'postman', opts)
    const doc = JSON.parse(out.content)
    expect(doc._postman_variable_scope).toBe('environment')
    expect(doc.values[1]).toMatchObject({ key: 'token', type: 'secret', enabled: true })
    expect(out.fileName).toBe('Stage.postman_environment.json')
    const back = parseVariables(out.content)
    expect(back.format).toBe('postman-environment')
    expect(back.name).toBe('Stage')
    expect(shape(back.variables)).toEqual(shape(vars))
  })

  it('Postman globals stay globals', () => {
    const out = exportVariables(vars, 'postman', { ...opts, scope: 'globals', name: 'Globals' })
    expect(parseVariables(out.content).format).toBe('postman-globals')
    expect(out.fileName).toBe('Globals.postman_globals.json')
  })

  it('CSV keeps every field, flag and awkward value', () => {
    const back = parseVariables(exportVariables(vars, 'csv', opts).content)
    expect(back.format).toBe('csv')
    expect(shape(back.variables)).toEqual(shape(vars))
  })

  it.each<VarExportFormat>(['json', 'dotenv'])('%s keeps the enabled variables and their exact values', (format) => {
    const back = parseVariables(exportVariables(vars, format, opts).content)
    const enabled = vars.filter((v) => v.enabled).map((v) => [v.key, v.value])
    expect(back.variables.map((v) => [v.key, v.value])).toEqual(enabled)
  })

  it('leaves secret values out unless asked', () => {
    const out = exportVariables(vars, 'postman', { ...opts, includeSecrets: false })
    expect(out.content).not.toContain('s3cr3t')
    expect(out.secretsOmitted).toBe(1)
    const back = parseVariables(out.content)
    expect(back.variables.find((v) => v.key === 'token')).toMatchObject({ value: '', secret: true })
  })

  it('makes a safe file name', () => {
    expect(exportVariables(vars, 'dotenv', { ...opts, name: 'a/b:c*?' }).fileName).toBe('abc.env')
  })
})

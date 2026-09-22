import { describe, expect, it } from 'vitest'
import { mergeVariables, parseVariables } from './var-import'
import type { VariableDef } from './types'

const kv = (r: { variables: VariableDef[] }) => r.variables.map((v) => [v.key, v.value, v.enabled, !!v.secret])

describe('parseVariables', () => {
  it('reads a Postman environment export', () => {
    const r = parseVariables(
      JSON.stringify({
        name: 'Stage',
        _postman_variable_scope: 'environment',
        values: [
          { key: 'baseUrl', value: 'https://stage.example.com', enabled: true, type: 'default' },
          { key: 'token', value: 's3cr3t', enabled: true, type: 'secret' },
          { key: 'old', value: '1', enabled: false }
        ]
      })
    )
    expect(r.format).toBe('postman-environment')
    expect(r.name).toBe('Stage')
    expect(kv(r)).toEqual([
      ['baseUrl', 'https://stage.example.com', true, false],
      ['token', 's3cr3t', true, true],
      ['old', '1', false, false]
    ])
  })

  it('tells Postman globals apart', () => {
    const r = parseVariables(JSON.stringify({ _postman_variable_scope: 'globals', values: [{ key: 'a', value: 'b' }] }))
    expect(r.format).toBe('postman-globals')
  })

  it('takes collection variables from a Postman collection', () => {
    const r = parseVariables(
      JSON.stringify({ info: { name: 'Shop' }, item: [], variable: [{ key: 'id', value: 7 }, { key: 'off', value: 'x', disabled: true }] })
    )
    expect(r.format).toBe('postman-collection')
    expect(kv(r)).toEqual([
      ['id', '7', true, false],
      ['off', 'x', false, false]
    ])
  })

  it('flattens a nested JSON object (Insomnia style)', () => {
    const r = parseVariables('{"base_url":"http://x","db":{"host":"h","port":5432},"tags":["a","b"],"none":null}')
    expect(kv(r)).toEqual([
      ['base_url', 'http://x', true, false],
      ['db.host', 'h', true, false],
      ['db.port', '5432', true, false],
      ['tags', '["a","b"]', true, false],
      ['none', '', true, false]
    ])
  })

  it('unwraps an Insomnia environment resource', () => {
    const r = parseVariables('{"_type":"environment","name":"Local","data":{"host":"localhost"}}')
    expect(r.name).toBe('Local')
    expect(kv(r)).toEqual([['host', 'localhost', true, false]])
  })

  it('reads a JSON list of entries', () => {
    const r = parseVariables('[{"name":"a","value":1},{"key":"b","value":"2","secret":true},{"value":"no key"}]')
    expect(kv(r)).toEqual([
      ['a', '1', true, false],
      ['b', '2', true, true]
    ])
    expect(r.warnings).toHaveLength(1)
  })

  it('reads a .env file', () => {
    const r = parseVariables(
      ['# comment', 'export API_URL=https://api.example.com', 'TOKEN="line1\\nline2"', "RAW='a # not a comment'", 'PLAIN=value # comment', 'EMPTY='].join('\n')
    )
    expect(r.format).toBe('dotenv')
    expect(kv(r)).toEqual([
      ['API_URL', 'https://api.example.com', true, false],
      ['TOKEN', 'line1\nline2', true, false],
      ['RAW', 'a # not a comment', true, false],
      ['PLAIN', 'value', true, false],
      ['EMPTY', '', true, false]
    ])
  })

  it('reads CSV with a header, quotes and flags', () => {
    const r = parseVariables('key,value,secret,enabled\nbaseUrl,"https://x/a,b",no,yes\ntoken,"say ""hi""",yes,no\n')
    expect(kv(r)).toEqual([
      ['baseUrl', 'https://x/a,b', true, false],
      ['token', 'say "hi"', false, true]
    ])
  })

  it('reads TSV and semicolon tables without a header', () => {
    expect(kv(parseVariables('a\t1\nb\t2'))).toEqual([
      ['a', '1', true, false],
      ['b', '2', true, false]
    ])
    expect(kv(parseVariables('host;localhost'))).toEqual([['host', 'localhost', true, false]])
  })

  it('rejects text it cannot read', () => {
    expect(() => parseVariables('')).toThrow()
    expect(() => parseVariables('{ not json')).toThrow(/not valid JSON/)
    expect(() => parseVariables('just some words')).toThrow(/Unknown format/)
  })
})

describe('mergeVariables', () => {
  const existing: VariableDef[] = [
    { id: '1', key: 'a', value: 'old', enabled: true },
    { id: '2', key: 'b', value: 'same', enabled: true },
    { id: '3', key: 'keep', value: 'k', enabled: true, secret: true }
  ]
  const incoming: VariableDef[] = [
    { id: 'x', key: 'a', value: 'new', enabled: true },
    { id: 'y', key: 'b', value: 'same', enabled: true },
    { id: 'z', key: 'c', value: 'fresh', enabled: true },
    { id: 'w', key: 'c', value: 'fresher', enabled: true }
  ]

  it('merges: updates, keeps, appends; last duplicate wins', () => {
    const out = mergeVariables(existing, incoming, 'merge')
    expect(out.variables.map((v) => [v.id, v.key, v.value])).toEqual([
      ['1', 'a', 'new'],
      ['2', 'b', 'same'],
      ['3', 'keep', 'k'],
      ['w', 'c', 'fresher']
    ])
    expect(out).toMatchObject({ added: 1, updated: 1, unchanged: 1 })
    expect(out.variables[2].secret).toBe(true)
  })

  it('replaces the whole list', () => {
    const out = mergeVariables(existing, incoming, 'replace')
    expect(out.variables.map((v) => v.key)).toEqual(['a', 'b', 'c'])
    expect(out.added).toBe(3)
  })
})

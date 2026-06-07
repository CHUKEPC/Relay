import { describe, it, expect } from 'vitest'
import type { RequestModel } from '@shared/types'
import { CODE_TARGETS, generateCode, type CodeTarget } from './codegen'

const HOST = 'api.example.com'

function baseRequest(over: Partial<RequestModel>): RequestModel {
  return {
    id: 'r1',
    name: 'Sample',
    method: 'GET',
    url: `https://${HOST}/v1/items`,
    query: [],
    headers: [{ key: 'X-Custom-Header', value: 'hello', enabled: true }],
    pathVariables: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    ...over
  }
}

const sampleGet = baseRequest({
  method: 'GET',
  query: [{ key: 'page', value: '2', enabled: true }]
})

const samplePostJson = baseRequest({
  method: 'POST',
  body: { type: 'raw', language: 'json', text: '{"name":"Ada","active":true}' }
})

const ALL_TARGETS: CodeTarget[] = CODE_TARGETS.map((t) => t.id)

// The new generators added in this change.
const NEW_TARGETS: CodeTarget[] = [
  'java',
  'csharp',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'rust',
  'powershell',
  'httpie'
]

describe('CODE_TARGETS registry', () => {
  it('includes every new language with a label and lang', () => {
    for (const id of NEW_TARGETS) {
      const t = CODE_TARGETS.find((x) => x.id === id)
      expect(t, `missing target ${id}`).toBeTruthy()
      expect(t!.label.length).toBeGreaterThan(0)
      expect(t!.lang.length).toBeGreaterThan(0)
    }
  })

  it('preserves the original targets', () => {
    for (const id of ['curl', 'javascript', 'python', 'node', 'go'] as CodeTarget[]) {
      expect(CODE_TARGETS.some((x) => x.id === id)).toBe(true)
    }
  })

  it('has unique ids', () => {
    const ids = CODE_TARGETS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// Idiomatic output may capitalize the verb differently (Ruby: Net::HTTP::Post,
// Rust: .post(...)), so match the method case-insensitively.
function containsMethod(code: string, method: string): boolean {
  return code.toLowerCase().includes(method.toLowerCase())
}

describe('generateCode — GET sample', () => {
  for (const id of ALL_TARGETS) {
    it(`${id} emits method + host + header`, () => {
      const code = generateCode(id, sampleGet)
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(containsMethod(code, 'GET')).toBe(true)
      expect(code).toContain(HOST)
      expect(code).toContain('X-Custom-Header')
      expect(code).toContain('hello')
      // query string must be carried through
      expect(code).toContain('page=2')
    })
  }
})

describe('generateCode — POST with JSON body', () => {
  for (const id of ALL_TARGETS) {
    it(`${id} emits method + host + header + body`, () => {
      const code = generateCode(id, samplePostJson)
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(containsMethod(code, 'POST')).toBe(true)
      expect(code).toContain(HOST)
      expect(code).toContain('X-Custom-Header')
      // JSON payload should appear in the generated source
      expect(code).toContain('Ada')
    })
  }
})

describe('auth is applied consistently', () => {
  const withBearer = baseRequest({ method: 'GET', auth: { type: 'bearer', token: 'TKN123' } })
  for (const id of ALL_TARGETS) {
    it(`${id} includes the bearer Authorization header`, () => {
      const code = generateCode(id, withBearer)
      expect(code).toContain('Authorization')
      expect(code).toContain('Bearer TKN123')
    })
  }
})

describe('urlencoded body support', () => {
  const urlenc = baseRequest({
    method: 'POST',
    body: {
      type: 'urlencoded',
      items: [
        { key: 'grant_type', value: 'client_credentials', enabled: true },
        { key: 'scope', value: 'read', enabled: true }
      ]
    }
  })
  for (const id of NEW_TARGETS) {
    it(`${id} carries urlencoded fields`, () => {
      const code = generateCode(id, urlenc)
      expect(code.length).toBeGreaterThan(0)
      expect(code).toContain('grant_type')
      expect(code).toContain('client_credentials')
    })
  }
})

describe('formdata is handled best-effort with a note', () => {
  const fd = baseRequest({
    method: 'POST',
    body: {
      type: 'formdata',
      items: [
        { key: 'field', type: 'text', value: 'val', enabled: true },
        { key: 'file', type: 'file', value: '', filePath: '/tmp/x.png', enabled: true }
      ]
    }
  })
  for (const id of NEW_TARGETS) {
    it(`${id} produces output (best-effort) for formdata`, () => {
      const code = generateCode(id, fd)
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      expect(code).toContain(HOST)
    })
  }
})

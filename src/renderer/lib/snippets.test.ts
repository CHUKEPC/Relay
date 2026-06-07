import { describe, it, expect } from 'vitest'
import { SNIPPETS, type Snippet } from './snippets'

describe('SNIPPETS', () => {
  it('is non-empty', () => {
    expect(SNIPPETS.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = SNIPPETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses stable kebab-case ids', () => {
    for (const s of SNIPPETS) {
      expect(s.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('every snippet has a non-empty code string', () => {
    for (const s of SNIPPETS) {
      expect(typeof s.code).toBe('string')
      expect(s.code.length).toBeGreaterThan(0)
    }
  })

  it('every snippet code ends with a trailing newline', () => {
    for (const s of SNIPPETS) {
      expect(s.code.endsWith('\n')).toBe(true)
    }
  })

  it('every snippet has a non-empty label', () => {
    for (const s of SNIPPETS) {
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
    }
  })

  it('every snippet has a valid phase', () => {
    const valid: Snippet['phase'][] = ['pre', 'test', 'both']
    for (const s of SNIPPETS) {
      expect(valid).toContain(s.phase)
    }
  })

  it('has a status-200 snippet asserting status 200', () => {
    const snippet = SNIPPETS.find((s) => s.id === 'status-200')
    expect(snippet).toBeDefined()
    expect(snippet!.code).toContain('pm.response.to.have.status(200)')
  })

  it('covers the expected Postman-parity snippet set', () => {
    const expectedIds = [
      'status-200',
      'status-2xx',
      'status-code-name',
      'response-time-200ms',
      'body-contains-string',
      'body-equals-string',
      'body-json-value-check',
      'body-to-json',
      'header-content-type-present',
      'header-content-type-check',
      'env-set',
      'env-get',
      'global-set',
      'save-response-field-to-var',
      'env-clear',
      'pre-set-timestamp'
    ]
    const ids = new Set(SNIPPETS.map((s) => s.id))
    for (const id of expectedIds) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

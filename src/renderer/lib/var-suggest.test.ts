import { describe, it, expect } from 'vitest'
import { applyVarSuggestion, suggestVars, varQueryAt } from './var-suggest'

const scope = {
  collection: { base_url: 'https://api.example.com', col_only: '1' },
  environment: { base_url: 'https://staging.example.com', token: 'abc' },
  global: { user_agent: 'relay', token: 'never-wins' }
}

describe('varQueryAt', () => {
  it('finds an unclosed reference the caret sits in', () => {
    const v = 'https://x/{{ba'
    expect(varQueryAt(v, v.length)).toEqual({ start: 10, end: 14, query: 'ba' })
  })

  it('offers everything right after the braces', () => {
    expect(varQueryAt('{{', 2)).toEqual({ start: 0, end: 2, query: '' })
  })

  it('replaces the whole reference when the caret is inside a complete one', () => {
    // '{{ba|se}}/users' — accepting a suggestion must not nest inside it.
    const q = varQueryAt('{{base}}/users', 4)
    expect(q).toEqual({ start: 0, end: 8, query: 'ba' })
  })

  it('stays quiet outside a reference', () => {
    expect(varQueryAt('https://example.com', 19)).toBeNull()
    expect(varQueryAt('{{base}}/users', 12)).toBeNull()
  })

  it('stops at a brace between the opening and the caret', () => {
    expect(varQueryAt('{{a}}b', 6)).toBeNull()
  })
})

describe('suggestVars', () => {
  it('lists each name once, attributed to the scope that wins', () => {
    const names = suggestVars('', scope).map((s) => `${s.name}:${s.source}`)
    expect(names).toContain('base_url:collection')
    expect(names).toContain('token:environment')
    expect(names.filter((n) => n.startsWith('token:'))).toHaveLength(1)
  })

  it('narrows as the name is typed, prefix matches first', () => {
    const got = suggestVars('to', scope).map((s) => s.name)
    expect(got[0]).toBe('token')
    expect(got).not.toContain('base_url')
  })

  it('matches on a substring too', () => {
    expect(suggestVars('url', scope).map((s) => s.name)).toContain('base_url')
  })

  it('carries the value and the secret flag for the preview', () => {
    const [first] = suggestVars('token', scope, { secrets: new Set(['token']) })
    expect(first).toMatchObject({ name: 'token', value: 'abc', secret: true })
  })

  it('puts dynamic variables last, and alone once $ is typed', () => {
    const mixed = suggestVars('', scope)
    const firstDynamic = mixed.findIndex((s) => s.source === 'dynamic')
    expect(mixed.slice(0, firstDynamic).every((s) => s.source !== 'dynamic')).toBe(true)
    const dyn = suggestVars('$gu', scope)
    expect(dyn.map((s) => s.name)).toEqual(['$guid'])
  })

  it('offers the built-ins Postman users reach for', () => {
    const names = suggestVars('$random', scope).map((s) => s.name)
    expect(names).toContain('$randomEmail')
    expect(names).toContain('$randomInt')
  })

  it('works with no scope at all (dynamic variables still resolve)', () => {
    expect(suggestVars('$time', undefined).map((s) => s.name)).toEqual(['$timestamp'])
  })
})

describe('applyVarSuggestion', () => {
  it('completes an unclosed reference and puts the caret after it', () => {
    const value = 'https://x/{{ba'
    const q = varQueryAt(value, value.length)!
    expect(applyVarSuggestion(value, q, 'base_url')).toEqual({
      value: 'https://x/{{base_url}}',
      caret: 22
    })
  })

  it('replaces an existing reference in place', () => {
    const q = varQueryAt('{{base}}/users', 4)!
    expect(applyVarSuggestion('{{base}}/users', q, 'base_url')).toEqual({
      value: '{{base_url}}/users',
      caret: 12
    })
  })
})

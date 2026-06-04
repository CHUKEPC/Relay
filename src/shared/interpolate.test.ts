import { describe, it, expect } from 'vitest'
import { resolveString, interpolate, extractTokens, flattenVariables } from './interpolate'
import type { VariableScope } from './types'

const scope: VariableScope = {
  collection: { base_url: 'https://collection.example', shared: 'col' },
  environment: { base_url: 'https://env.example', token: 'abc' },
  global: { base_url: 'https://global.example', region: 'eu' }
}

describe('variable interpolation', () => {
  it('resolves {{var}} tokens', () => {
    expect(interpolate('{{base_url}}/v1', scope)).toBe('https://collection.example/v1')
  })

  it('honors precedence collection > environment > global', () => {
    expect(interpolate('{{base_url}}', scope)).toBe('https://collection.example')
    expect(interpolate('{{token}}', scope)).toBe('abc') // from environment
    expect(interpolate('{{region}}', scope)).toBe('eu') // from global
  })

  it('flags unresolved variables and leaves them literal', () => {
    const r = resolveString('{{missing}}/x', scope)
    expect(r.value).toBe('{{missing}}/x')
    expect(r.unresolved).toContain('missing')
  })

  it('reports the source of each token', () => {
    const r = resolveString('{{shared}}-{{region}}', scope)
    const sources = Object.fromEntries(r.tokens.map((t) => [t.name, t.source]))
    expect(sources.shared).toBe('collection')
    expect(sources.region).toBe('global')
  })

  it('supports dynamic variables', () => {
    expect(interpolate('{{$timestamp}}', scope)).toMatch(/^\d+$/)
    expect(interpolate('{{$guid}}', scope)).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number(interpolate('{{$randomInt}}', scope))).toBeGreaterThanOrEqual(0)
  })

  it('resolves nested variables', () => {
    const nested: VariableScope = { environment: { a: '{{b}}', b: 'final' } }
    expect(interpolate('{{a}}', nested)).toBe('final')
  })

  it('leaves a self-referential variable literal instead of duplicating it', () => {
    const s: VariableScope = { environment: { a: 'x {{a}} y' } }
    const r = resolveString('{{a}}', s)
    expect(r.value).toBe('x {{a}} y')
    expect(r.unresolved).toContain('a')
  })

  it('detects mutual reference cycles', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: '{{a}}' } }
    const r = resolveString('{{a}}', s)
    expect(r.unresolved.length).toBeGreaterThan(0)
  })

  it('resolves a chain deeper than the old 5-level limit', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: '{{c}}', c: '{{d}}', d: '{{e}}', e: '{{f}}', f: 'DONE' } }
    expect(interpolate('{{a}}', s)).toBe('DONE')
  })

  it('does not treat inherited Object.prototype names as variables (no crash)', () => {
    const s: VariableScope = { environment: { real: 'x' } }
    const r = resolveString('{{constructor}}/{{toString}}/{{__proto__}}', s)
    expect(r.value).toBe('{{constructor}}/{{toString}}/{{__proto__}}')
    expect(r.unresolved).toContain('constructor')
  })

  it('reports the fully resolved value for a nested token', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: 'final' } }
    const r = resolveString('{{a}}', s)
    expect(r.tokens.find((t) => t.name === 'a')?.value).toBe('final')
  })

  it('extracts token names', () => {
    expect(extractTokens('{{a}}/{{b}}')).toEqual(['a', 'b'])
  })

  it('flattens enabled variables only', () => {
    const flat = flattenVariables([
      { key: 'on', value: '1', enabled: true },
      { key: 'off', value: '2', enabled: false }
    ])
    expect(flat).toEqual({ on: '1' })
  })
})

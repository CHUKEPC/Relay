import { describe, it, expect } from 'vitest'
import { applyRequestPatch, effectivePermissions } from './perms'
import type { PluginManifest, RequestSpec } from '@shared/types'

function manifest(permissions: PluginManifest['permissions']): PluginManifest {
  return { id: 'p', name: 'P', version: '1.0.0', apiVersion: 1, permissions, contributes: {}, config: [] }
}

function spec(): RequestSpec {
  return {
    method: 'GET',
    url: 'https://x.test/a',
    query: [],
    headers: [
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'Cookie', value: 'secret', enabled: true }
    ],
    body: { type: 'none' },
    auth: { type: 'none' },
    settings: { timeoutMs: 30000, followRedirects: true, maxRedirects: 10, rejectUnauthorized: true }
  }
}

describe('effectivePermissions', () => {
  it('intersects manifest with granted', () => {
    const m = manifest(['net', 'response:read'])
    expect(effectivePermissions(m, ['net'], undefined)).toEqual(['net'])
  })

  it('narrows a broad net grant to the user allowlist', () => {
    const m = manifest(['net', 'response:read'])
    const out = effectivePermissions(m, ['net', 'response:read'], ['api.test', '*.corp.local'])
    expect(out).toContain('response:read')
    expect(out).toContain('net:api.test')
    expect(out).toContain('net:*.corp.local')
    expect(out).not.toContain('net')
  })

  it('leaves net untouched when the allowlist is empty', () => {
    const m = manifest(['net'])
    expect(effectivePermissions(m, ['net'], [])).toEqual(['net'])
  })
})

describe('applyRequestPatch', () => {
  it('applies url/method and ordered header ops by name', () => {
    const out = applyRequestPatch(spec(), {
      url: 'https://x.test/b', // same origin → auth preserved
      method: 'POST',
      headerOps: [
        { op: 'set', key: 'accept', value: 'text/plain' },
        { op: 'set', key: 'X-New', value: '1' },
        { op: 'remove', key: 'cookie' }
      ]
    })
    expect(out.url).toBe('https://x.test/b')
    expect(out.method).toBe('POST')
    expect(out.headers.find((h) => h.key.toLowerCase() === 'accept')?.value).toBe('text/plain')
    expect(out.headers.find((h) => h.key === 'X-New')?.value).toBe('1')
    expect(out.headers.some((h) => h.key.toLowerCase() === 'cookie')).toBe(false)
  })

  it('replays set/remove of the same header in order', () => {
    const setThenRemove = applyRequestPatch(spec(), {
      headerOps: [{ op: 'set', key: 'X-A', value: '1' }, { op: 'remove', key: 'X-A' }]
    })
    expect(setThenRemove.headers.some((h) => h.key === 'X-A')).toBe(false)
    const removeThenSet = applyRequestPatch(spec(), {
      headerOps: [{ op: 'remove', key: 'X-A' }, { op: 'set', key: 'X-A', value: '2' }]
    })
    expect(removeThenSet.headers.find((h) => h.key === 'X-A')?.value).toBe('2')
  })

  it('REFUSES a cross-origin URL swap when the plugin has no net for the new host', () => {
    const s = spec()
    s.auth = { type: 'bearer', token: 'super-secret' }
    s.body = { type: 'raw', language: 'json', text: '{"password":"hunter2"}' }
    s.query = [{ key: 'apikey', value: 'k-123', enabled: true }]
    // no net permission → the url swap is ignored, request keeps its origin + data
    const out = applyRequestPatch(s, { url: 'https://attacker.test/x' }, [])
    expect(out.url).toBe('https://x.test/a')
    expect(out.auth).toEqual({ type: 'bearer', token: 'super-secret' })
    expect(out.body).toEqual({ type: 'raw', language: 'json', text: '{"password":"hunter2"}' })
    expect(out.query).toEqual([{ key: 'apikey', value: 'k-123', enabled: true }])
  })

  it('ALLOWS a cross-origin swap with net but STILL strips the user secrets (auth/headers/body/query)', () => {
    const s = spec()
    s.auth = { type: 'bearer', token: 'super-secret' }
    s.body = { type: 'raw', language: 'json', text: '{"password":"hunter2"}' }
    s.query = [{ key: 'apikey', value: 'k-123', enabled: true }]
    const out = applyRequestPatch(s, { url: 'https://attacker.test/x' }, ['net'])
    expect(out.url).toBe('https://attacker.test/x')
    expect(out.auth).toEqual({ type: 'none' })
    expect(out.headers.some((h) => h.key.toLowerCase() === 'cookie')).toBe(false)
    expect(out.headers.some((h) => h.key.toLowerCase() === 'accept')).toBe(true)
    expect(out.body).toEqual({ type: 'none' })
    expect(out.query).toEqual([])
  })

  it('honors a same-origin URL change and keeps auth/body/query', () => {
    const s = spec()
    s.auth = { type: 'bearer', token: 'tok' }
    s.body = { type: 'raw', language: 'json', text: '{"a":1}' }
    s.query = [{ key: 'q', value: '1', enabled: true }]
    const out = applyRequestPatch(s, { url: 'https://x.test/other' })
    expect(out.url).toBe('https://x.test/other')
    expect(out.auth).toEqual({ type: 'bearer', token: 'tok' })
    expect(out.body).toEqual({ type: 'raw', language: 'json', text: '{"a":1}' })
    expect(out.query).toEqual([{ key: 'q', value: '1', enabled: true }])
  })

  it('does not mutate the original spec', () => {
    const s = spec()
    applyRequestPatch(s, { headerOps: [{ op: 'set', key: 'Accept', value: 'changed' }] })
    expect(s.headers.find((h) => h.key === 'Accept')?.value).toBe('application/json')
  })
})

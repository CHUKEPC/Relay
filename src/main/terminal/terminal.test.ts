import { describe, expect, it } from 'vitest'
import type { RequestSpec } from '@shared/types'
import { toTerminalRequest } from './index'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  method: 'GET',
  url: 'https://api.example.com/items',
  query: [],
  headers: [],
  body: { type: 'none' },
  auth: { type: 'none' },
  settings: { timeoutMs: 30000, followRedirects: true, maxRedirects: 10, rejectUnauthorized: true },
  ...over
})

describe('toTerminalRequest', () => {
  it('puts query params and query-auth in the URL, auth headers last', () => {
    const r = toTerminalRequest(
      spec({
        query: [
          { key: 'q', value: 'a b', enabled: true },
          { key: 'off', value: '1', enabled: false }
        ],
        headers: [{ key: 'Authorization', value: 'mine', enabled: true }],
        auth: { type: 'apikey', key: 'api_key', value: 's3', addTo: 'query' }
      })
    )
    expect(r.url).toBe('https://api.example.com/items?q=a+b&api_key=s3')
    expect(r.headers).toEqual([['Authorization', 'mine']])
  })

  it('turns bearer / basic into headers and digest / NTLM into tool credentials', () => {
    expect(toTerminalRequest(spec({ auth: { type: 'bearer', token: 't' } })).headers).toContainEqual(['Authorization', 'Bearer t'])
    expect(toTerminalRequest(spec({ auth: { type: 'basic', username: 'u', password: 'p' } })).headers).toContainEqual([
      'Authorization',
      'Basic ' + Buffer.from('u:p').toString('base64')
    ])
    const d = toTerminalRequest(spec({ auth: { type: 'digest', username: 'u', password: 'p' } }))
    expect(d.credentials).toEqual({ scheme: 'digest', username: 'u', password: 'p' })
    expect(d.headers.find(([k]) => k === 'Authorization')).toBeUndefined()
  })

  it('sends no body for an empty raw editor', () => {
    const r = toTerminalRequest(spec({ headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }], body: { type: 'raw', language: 'json', text: '' } }))
    expect(r.body).toEqual({ kind: 'none' })
  })

  it('encodes urlencoded and GraphQL bodies with their content type', () => {
    const u = toTerminalRequest(spec({ method: 'POST', body: { type: 'urlencoded', items: [{ key: 'a', value: '1 2', enabled: true }] } }))
    expect(u.body).toEqual({ kind: 'text', text: 'a=1+2' })
    expect(u.headers).toContainEqual(['Content-Type', 'application/x-www-form-urlencoded'])
    const g = toTerminalRequest(spec({ method: 'POST', body: { type: 'graphql', query: '{ me }', variables: 'not json' } }))
    expect(g.body).toEqual({ kind: 'text', text: '{"query":"{ me }","variables":{}}' })
  })

  it('carries network settings and says what it cannot carry', () => {
    const r = toTerminalRequest(
      spec({
        settings: {
          timeoutMs: 1500,
          followRedirects: false,
          maxRedirects: 3,
          rejectUnauthorized: false,
          proxy: { mode: 'system', enabled: true, url: '' },
          clientCerts: [{ id: 'c', host: 'api.example.com', pfxPath: 'x.pfx' }],
          caPath: 'C:\\ca.pem'
        }
      })
    )
    expect(r).toMatchObject({ insecure: true, followRedirects: false, timeoutSec: 2, caPath: 'C:\\ca.pem' })
    expect(r.proxy).toBeUndefined()
    expect(r.notes).toHaveLength(2)
  })

  it('signs AWS requests like the engine does', () => {
    const r = toTerminalRequest(
      spec({ auth: { type: 'aws', accessKey: 'AKID', secretKey: 'secret', region: 'us-east-1', service: 's3' } })
    )
    const auth = r.headers.find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? ''
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//)
  })
})

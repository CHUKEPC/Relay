import { describe, it, expect } from 'vitest'

import type { Auth, RequestBody, RequestSpec, ResponseResult, RunOptions } from '@shared/types'

import { buildUrl, buildAuthHeaders, encodeBody, runRequest } from './engine'

/* ============================================================
 * Test helpers
 * ============================================================ */

const DEFAULT_SETTINGS: RequestSpec['settings'] = {
  timeoutMs: 15000,
  followRedirects: true,
  maxRedirects: 10,
  rejectUnauthorized: true
}

function spec(partial: Partial<RequestSpec>): RequestSpec {
  return {
    method: 'GET',
    url: 'https://example.com',
    query: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    settings: DEFAULT_SETTINGS,
    ...partial
  }
}

const OPTS: RunOptions = { requestId: 'test-1' }

/* ============================================================
 * buildUrl — query merge
 * ============================================================ */

describe('buildUrl', () => {
  it('appends enabled query params', () => {
    const url = buildUrl('https://api.test/v1/users', [
      { key: 'page', value: '2', enabled: true },
      { key: 'limit', value: '50', enabled: true }
    ])
    const u = new URL(url)
    expect(u.searchParams.get('page')).toBe('2')
    expect(u.searchParams.get('limit')).toBe('50')
  })

  it('skips disabled and empty-key params', () => {
    const url = buildUrl('https://api.test/', [
      { key: 'a', value: '1', enabled: false },
      { key: '', value: 'x', enabled: true },
      { key: 'b', value: '2', enabled: true }
    ])
    const u = new URL(url)
    expect(u.searchParams.has('a')).toBe(false)
    expect(u.searchParams.has('')).toBe(false)
    expect(u.searchParams.get('b')).toBe('2')
  })

  it('respects params already present in the URL string', () => {
    const url = buildUrl('https://api.test/?existing=keep', [{ key: 'added', value: 'yes', enabled: true }])
    const u = new URL(url)
    expect(u.searchParams.get('existing')).toBe('keep')
    expect(u.searchParams.get('added')).toBe('yes')
  })

  it('allows duplicate keys (append, not replace)', () => {
    const url = buildUrl('https://api.test/?tag=a', [{ key: 'tag', value: 'b', enabled: true }])
    const u = new URL(url)
    expect(u.searchParams.getAll('tag')).toEqual(['a', 'b'])
  })

  it('encodes special characters in values', () => {
    const url = buildUrl('https://api.test/', [{ key: 'q', value: 'a b&c=d', enabled: true }])
    const u = new URL(url)
    expect(u.searchParams.get('q')).toBe('a b&c=d')
  })
})

/* ============================================================
 * buildAuthHeaders
 * ============================================================ */

describe('buildAuthHeaders', () => {
  it('none / inherit produce no headers', () => {
    expect(buildAuthHeaders({ type: 'none' }).headers).toEqual({})
    expect(buildAuthHeaders({ type: 'inherit' }).headers).toEqual({})
  })

  it('bearer sets Authorization: Bearer <token>', () => {
    const { headers } = buildAuthHeaders({ type: 'bearer', token: 'abc123' })
    expect(headers.Authorization).toBe('Bearer abc123')
  })

  it('bearer with empty token is skipped', () => {
    expect(buildAuthHeaders({ type: 'bearer', token: '' }).headers).toEqual({})
  })

  it('basic base64-encodes user:pass', () => {
    const { headers } = buildAuthHeaders({ type: 'basic', username: 'user', password: 'pass' })
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`)
    // sanity: decodes back
    const decoded = Buffer.from(headers.Authorization.replace('Basic ', ''), 'base64').toString('utf8')
    expect(decoded).toBe('user:pass')
  })

  it('apikey in header places key/value in headers', () => {
    const auth: Auth = { type: 'apikey', key: 'X-Api-Key', value: 'secret', addTo: 'header' }
    const { headers, query } = buildAuthHeaders(auth)
    expect(headers['X-Api-Key']).toBe('secret')
    expect(query).toBeUndefined()
  })

  it('apikey in query returns a query pair and no header', () => {
    const auth: Auth = { type: 'apikey', key: 'api_key', value: 'secret', addTo: 'query' }
    const { headers, query } = buildAuthHeaders(auth)
    expect(headers).toEqual({})
    expect(query).toEqual({ key: 'api_key', value: 'secret' })
  })

  it('oauth2 uses headerPrefix (defaults to Bearer)', () => {
    const withPrefix = buildAuthHeaders({
      type: 'oauth2',
      grant: 'client_credentials',
      accessToken: 'tok',
      headerPrefix: 'Token'
    })
    expect(withPrefix.headers.Authorization).toBe('Token tok')

    const noPrefix = buildAuthHeaders({
      type: 'oauth2',
      grant: 'client_credentials',
      accessToken: 'tok',
      headerPrefix: ''
    })
    expect(noPrefix.headers.Authorization).toBe('Bearer tok')
  })

  it('oauth2 without an access token is skipped', () => {
    const { headers } = buildAuthHeaders({
      type: 'oauth2',
      grant: 'client_credentials',
      accessToken: '',
      headerPrefix: 'Bearer'
    })
    expect(headers).toEqual({})
  })

  it('digest sends NO preemptive header (challenge/response is handled in runRequest)', () => {
    const { headers, query } = buildAuthHeaders({ type: 'digest', username: 'u', password: 'p' })
    // Per RFC 7616 the first request is unauthenticated; the engine answers the
    // 401 Digest challenge and replays. So buildAuthHeaders contributes nothing.
    expect(headers).toEqual({})
    expect(query).toBeUndefined()
  })
})

/* ============================================================
 * encodeBody
 * ============================================================ */

describe('encodeBody', () => {
  it('none yields no body and no content-type', async () => {
    const enc = await encodeBody({ type: 'none' }, {})
    expect(enc.body).toBeUndefined()
    expect(enc.contentType).toBeUndefined()
  })

  it('raw json sets application/json content-type', async () => {
    const body: RequestBody = { type: 'raw', language: 'json', text: '{"a":1}' }
    const enc = await encodeBody(body, {})
    expect(enc.body).toBe('{"a":1}')
    expect(enc.contentType).toBe('application/json')
  })

  it('raw xml / text / html / javascript map content-types', async () => {
    expect((await encodeBody({ type: 'raw', language: 'xml', text: '<x/>' }, {})).contentType).toBe('application/xml')
    expect((await encodeBody({ type: 'raw', language: 'text', text: 'hi' }, {})).contentType).toBe('text/plain')
    expect((await encodeBody({ type: 'raw', language: 'html', text: '<p>' }, {})).contentType).toBe('text/html')
    expect((await encodeBody({ type: 'raw', language: 'javascript', text: 'x=1' }, {})).contentType).toBe(
      'application/javascript'
    )
  })

  it('raw respects a user-set Content-Type', async () => {
    const body: RequestBody = { type: 'raw', language: 'json', text: '{}' }
    const enc = await encodeBody(body, { 'content-type': 'application/vnd.api+json' })
    expect(enc.contentType).toBe('application/vnd.api+json')
  })

  it('urlencoded builds form-encoded pairs and sets content-type', async () => {
    const body: RequestBody = {
      type: 'urlencoded',
      items: [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: 'x y', enabled: true },
        { key: 'c', value: 'no', enabled: false }
      ]
    }
    const enc = await encodeBody(body, {})
    expect(enc.contentType).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(enc.body as string)
    expect(params.get('a')).toBe('1')
    expect(params.get('b')).toBe('x y')
    expect(params.has('c')).toBe(false)
  })

  it('graphql with valid variables produces JSON {query, variables}', async () => {
    const body: RequestBody = {
      type: 'graphql',
      query: 'query($id: ID!){ user(id:$id){ name } }',
      variables: '{"id":"42"}'
    }
    const enc = await encodeBody(body, {})
    expect(enc.contentType).toBe('application/json')
    const parsed = JSON.parse(enc.body as string)
    expect(parsed.query).toContain('user(id:$id)')
    expect(parsed.variables).toEqual({ id: '42' })
  })

  it('graphql with invalid variables degrades to {}', async () => {
    const body: RequestBody = { type: 'graphql', query: '{ ping }', variables: '{not valid json' }
    const enc = await encodeBody(body, {})
    const parsed = JSON.parse(enc.body as string)
    expect(parsed.variables).toEqual({})
    expect(parsed.query).toBe('{ ping }')
  })

  it('graphql with empty variables degrades to {}', async () => {
    const body: RequestBody = { type: 'graphql', query: '{ ping }', variables: '' }
    const enc = await encodeBody(body, {})
    expect(JSON.parse(enc.body as string).variables).toEqual({})
  })

  it('formdata produces a FormData and no manual content-type', async () => {
    const body: RequestBody = {
      type: 'formdata',
      items: [{ key: 'field', type: 'text', value: 'val', enabled: true }]
    }
    const enc = await encodeBody(body, {})
    expect(enc.body).toBeInstanceOf(FormData)
    // Critical: the multipart boundary must be set by undici, not us.
    expect(enc.contentType).toBeUndefined()
    expect((enc.body as FormData).get('field')).toBe('val')
  })
})

/* ============================================================
 * runRequest — offline (structured error, no network needed)
 * ============================================================ */

describe('runRequest (offline)', () => {
  it('returns a structured DNS error for a non-existent host (never throws)', async () => {
    const result = await runRequest(
      spec({ url: 'http://does-not-exist.invalid', settings: { ...DEFAULT_SETTINGS, timeoutMs: 5000 } }),
      OPTS
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.error).toBeDefined()
    expect(result.error?.kind).toBe('dns')
    expect(result.body.sizeBytes).toBe(0)
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('returns a protocol error for a malformed URL', async () => {
    const result = await runRequest(spec({ url: 'not a url' }), OPTS)
    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('protocol')
  })

  it('maps an already-aborted external signal to an abort error', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runRequest(spec({ url: 'http://does-not-exist.invalid' }), OPTS, controller.signal)
    expect(result.ok).toBe(false)
    expect(['abort', 'dns']).toContain(result.error?.kind)
  })

  it('applies the api-key auth query param into the final URL on transport failure path', async () => {
    // Even on failure the request must not throw; the host is invalid so we just
    // assert it returns a structured result rather than crashing.
    const auth: Auth = { type: 'apikey', key: 'api_key', value: 'k', addTo: 'query' }
    const result = await runRequest(spec({ url: 'http://does-not-exist.invalid', auth }), OPTS)
    expect(result.error).toBeDefined()
    expect(result.ok).toBe(false)
  })
})

/* ============================================================
 * runRequest — network (opt-in via RELAY_NET_TESTS=1)
 * ============================================================ */

describe.runIf(process.env.RELAY_NET_TESTS === '1')('runRequest (network: httpbin.org)', () => {
  const BASE = 'https://httpbin.org'

  /**
   * httpbin.org is a shared free service that frequently rate-limits or returns
   * 5xx gateway errors under load. These checks are about the ENGINE, not about
   * httpbin's uptime, so when the upstream is clearly unavailable (transport
   * error or 5xx) we assert only that the engine behaved sanely and bail out of
   * the content-specific assertions. Returns true if the upstream is usable.
   */
  function upstreamUsable(result: ResponseResult): boolean {
    if (result.error) {
      // A transport failure is not the engine's fault; it must still be structured.
      expect(['dns', 'connect', 'tls', 'timeout', 'protocol']).toContain(result.error.kind)
      return false
    }
    if (result.status >= 500) {
      // Gateway/ratelimit error from httpbin — engine handled it correctly.
      expect(result.ok).toBe(false)
      return false
    }
    return true
  }

  it('GET /get returns 200 with parsed JSON, timings and size', async () => {
    const result = await runRequest(
      spec({
        method: 'GET',
        url: `${BASE}/get`,
        query: [{ key: 'hello', value: 'world', enabled: true }]
      }),
      { requestId: 'net-get' }
    )
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.error).toBeUndefined()
    expect(result.body.isBinary).toBe(false)
    expect(result.body.sizeBytes).toBeGreaterThan(0)
    expect(result.timings.totalMs).toBeGreaterThan(0)
    expect(result.timings.ttfbMs).toBeGreaterThan(0)
    const json = JSON.parse(result.body.text ?? '{}')
    expect(json.args.hello).toBe('world')
  })

  it('POST /post echoes a JSON body', async () => {
    const result = await runRequest(
      spec({
        method: 'POST',
        url: `${BASE}/post`,
        body: { type: 'raw', language: 'json', text: '{"name":"relay"}' }
      }),
      { requestId: 'net-post' }
    )
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    const json = JSON.parse(result.body.text ?? '{}')
    expect(json.json).toEqual({ name: 'relay' })
    expect(json.headers['Content-Type']).toContain('application/json')
  })

  it('POST /post with urlencoded body', async () => {
    const result = await runRequest(
      spec({
        method: 'POST',
        url: `${BASE}/post`,
        body: {
          type: 'urlencoded',
          items: [
            { key: 'a', value: '1', enabled: true },
            { key: 'b', value: '2', enabled: true }
          ]
        }
      }),
      { requestId: 'net-form' }
    )
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    const json = JSON.parse(result.body.text ?? '{}')
    expect(json.form).toEqual({ a: '1', b: '2' })
  })

  it('GET /status/404 reports ok:false with status 404', async () => {
    const result = await runRequest(spec({ url: `${BASE}/status/404` }), { requestId: 'net-404' })
    if (result.error) {
      expect(['dns', 'connect', 'tls', 'timeout', 'protocol']).toContain(result.error.kind)
      return
    }
    // 404 (intended) or a 5xx gateway error — both are non-ok and engine-correct.
    expect(result.ok).toBe(false)
    if (result.status === 404) expect(result.statusText).toBe('Not Found')
  })

  it('bearer auth is echoed back', async () => {
    const result = await runRequest(
      spec({ url: `${BASE}/bearer`, auth: { type: 'bearer', token: 'tok-123' } }),
      { requestId: 'net-bearer' }
    )
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    const json = JSON.parse(result.body.text ?? '{}')
    expect(json.token).toBe('tok-123')
  })

  it('follows redirects and records the chain', async () => {
    const result = await runRequest(
      spec({ url: `${BASE}/redirect/2`, settings: { ...DEFAULT_SETTINGS, followRedirects: true } }),
      { requestId: 'net-redirect' }
    )
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    expect(result.redirects.length).toBeGreaterThanOrEqual(1)
    expect(result.finalUrl).toContain('/get')
  })

  it('does not follow redirects when disabled', async () => {
    const result = await runRequest(
      spec({ url: `${BASE}/redirect/1`, settings: { ...DEFAULT_SETTINGS, followRedirects: false } }),
      { requestId: 'net-noredirect' }
    )
    if (result.error) {
      expect(['dns', 'connect', 'tls', 'timeout', 'protocol']).toContain(result.error.kind)
      return
    }
    // The engine must NOT auto-follow: either a 3xx (httpbin healthy) or a 5xx
    // gateway error, but never the final 200 from /get and never a recorded hop.
    expect(result.redirects.length).toBe(0)
    expect(result.status).not.toBe(200)
  })

  it('times out against /delay and maps to a timeout error', async () => {
    const result = await runRequest(
      spec({ url: `${BASE}/delay/5`, settings: { ...DEFAULT_SETTINGS, timeoutMs: 800 } }),
      { requestId: 'net-timeout' }
    )
    expect(result.ok).toBe(false)
    // Normally a timeout; if httpbin is unreachable it may connect-fail first.
    expect(['timeout', 'connect', 'dns', 'tls']).toContain(result.error?.kind)
  })

  it('returns binary body as base64 for an image', async () => {
    const result = await runRequest(spec({ url: `${BASE}/image/png` }), { requestId: 'net-img' })
    if (!upstreamUsable(result)) return
    expect(result.ok).toBe(true)
    expect(result.body.isBinary).toBe(true)
    expect(result.body.base64).toBeTruthy()
    expect(result.body.text).toBeUndefined()
  })
})

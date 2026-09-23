import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Auth, RequestSpec, RunOptions } from '@shared/types'
import { signAwsV4 } from '../auth/awsv4'
import { runRequest } from './engine'

/**
 * End-to-end checks that the request-bound signatures (AWS SigV4, OAuth 1.0a)
 * the engine attaches actually describe the request that goes out on the wire —
 * including after a redirect, where the method and path change underneath them.
 *
 * Everything runs against a throwaway node:http server on 127.0.0.1.
 */

interface Capture {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

let server: Server
let base = ''
let captures: Capture[] = []
let handler: (req: IncomingMessage, capture: Capture) => { status: number; headers?: Record<string, string>; body?: string }

beforeEach(async () => {
  captures = []
  handler = () => ({ status: 200, body: 'ok' })
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const capture: Capture = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks).toString('utf8')
      }
      captures.push(capture)
      const out = handler(req, capture)
      res.statusCode = out.status
      for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v)
      res.end(out.body ?? '')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function spec(partial: Partial<RequestSpec> & { auth: Auth }): RequestSpec {
  return {
    method: 'GET',
    url: base,
    query: [],
    headers: [],
    body: { type: 'none' },
    settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, rejectUnauthorized: true },
    ...partial
  }
}

const OPTS: RunOptions = { requestId: 'auth-signing' }

const AWS_AUTH: Auth = {
  type: 'aws',
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service'
}

/**
 * Re-derive the SigV4 Authorization from what the server actually received:
 * take the headers named in SignedHeaders, feed them back to the signer with the
 * X-Amz-Date that came in, and compare. A signature computed for a different
 * method/path/body cannot survive this.
 */
function awsSignatureIsValidFor(capture: Capture, url: string, method: string): boolean {
  const authorization = capture.headers['authorization'] ?? ''
  const signedList = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]
  const datetime = capture.headers['x-amz-date']
  if (!signedList || !datetime) return false
  const headers: Record<string, string> = {}
  for (const name of signedList.split(';')) {
    const value = capture.headers[name]
    if (value !== undefined) headers[name] = value
  }
  const expected = signAwsV4({
    method,
    url,
    headers,
    body: capture.body,
    accessKeyId: AWS_AUTH.type === 'aws' ? AWS_AUTH.accessKey : '',
    secretAccessKey: AWS_AUTH.type === 'aws' ? AWS_AUTH.secretKey : '',
    region: 'us-east-1',
    service: 'service',
    datetime
  })
  return expected.Authorization === authorization
}

describe('AWS SigV4 over the wire', () => {
  it('signs the first request so the server can verify it', async () => {
    const result = await runRequest(spec({ url: `${base}/things?b=2&a=1`, auth: AWS_AUTH }), OPTS)
    expect(result.status).toBe(200)
    expect(captures).toHaveLength(1)
    expect(awsSignatureIsValidFor(captures[0], `${base}/things?b=2&a=1`, 'GET')).toBe(true)
  })

  it('re-signs after a same-origin redirect so the signature covers the NEW path', async () => {
    handler = (_req, capture) =>
      capture.url.startsWith('/old')
        ? { status: 302, headers: { Location: '/new/path' } }
        : { status: 200, body: 'ok' }

    const result = await runRequest(spec({ url: `${base}/old`, auth: AWS_AUTH }), OPTS)

    expect(result.status).toBe(200)
    expect(captures).toHaveLength(2)
    // A stale signature would be byte-identical; a fresh one cannot be.
    expect(captures[1].headers['authorization']).not.toBe(captures[0].headers['authorization'])
    expect(awsSignatureIsValidFor(captures[1], `${base}/new/path`, 'GET')).toBe(true)
  })

  it('re-signs when a 303 downgrades POST to GET and drops the body', async () => {
    handler = (_req, capture) =>
      capture.url.startsWith('/submit')
        ? { status: 303, headers: { Location: '/done' } }
        : { status: 200, body: 'ok' }

    const result = await runRequest(
      spec({
        method: 'POST',
        url: `${base}/submit`,
        body: { type: 'raw', language: 'json', text: '{"a":1}' },
        auth: AWS_AUTH
      }),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(captures).toHaveLength(2)
    expect(captures[1].method).toBe('GET')
    expect(captures[1].body).toBe('')
    // The hop-2 signature must cover GET /done with an empty payload.
    expect(awsSignatureIsValidFor(captures[1], `${base}/done`, 'GET')).toBe(true)
  })
})

describe('AWS SigV4 and cross-origin redirects', () => {
  let other: Server
  let otherBase = ''
  let otherCaptures: Capture[] = []

  beforeEach(async () => {
    otherCaptures = []
    other = createServer((req, res) => {
      otherCaptures.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string>,
        body: ''
      })
      res.statusCode = 200
      res.end('other')
    })
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve))
    otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => other.close(() => resolve()))
  })

  it('never mints a signature for a host the credentials were not configured for', async () => {
    handler = () => ({ status: 302, headers: { Location: `${otherBase}/elsewhere` } })

    const result = await runRequest(spec({ url: `${base}/start`, auth: AWS_AUTH }), OPTS)

    expect(result.status).toBe(200)
    expect(otherCaptures).toHaveLength(1)
    // Neither the old signature nor a freshly computed one may reach the new host.
    expect(otherCaptures[0].headers['authorization']).toBeUndefined()
    expect(otherCaptures[0].headers['x-amz-date']).toBeUndefined()
    expect(otherCaptures[0].headers['x-amz-content-sha256']).toBeUndefined()
  })

  it('drops a plain Bearer token on a cross-origin redirect', async () => {
    handler = () => ({ status: 302, headers: { Location: `${otherBase}/elsewhere` } })

    await runRequest(
      spec({ url: `${base}/start`, auth: { type: 'bearer', token: 'super-secret' } }),
      OPTS
    )

    expect(otherCaptures[0].headers['authorization']).toBeUndefined()
  })

  it('keeps the Bearer token on a same-origin redirect', async () => {
    handler = (_req, capture) =>
      capture.url.startsWith('/start')
        ? { status: 302, headers: { Location: '/next' } }
        : { status: 200, body: 'ok' }

    await runRequest(
      spec({ url: `${base}/start`, auth: { type: 'bearer', token: 'super-secret' } }),
      OPTS
    )

    expect(captures).toHaveLength(2)
    expect(captures[1].headers['authorization']).toBe('Bearer super-secret')
  })
})

/**
 * Independent RFC 5849 verifier: rebuild the signature base string from what the
 * server received (query + form body + the oauth_* params out of the header) and
 * recompute the HMAC. Any parameter the client forgot to sign shows up here.
 */
function oauth1SignatureIsValid(
  capture: Capture,
  consumerSecret: string,
  tokenSecret: string
): boolean {
  const header = capture.headers['authorization'] ?? ''
  if (!header.startsWith('OAuth ')) return false

  const enc = (v: string): string =>
    encodeURIComponent(v).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  const dec = (v: string): string => decodeURIComponent(v.replace(/\+/g, ' '))

  const oauthParams: Array<[string, string]> = []
  let received = ''
  for (const part of header.slice('OAuth '.length).split(', ')) {
    const eq = part.indexOf('=')
    const key = dec(part.slice(0, eq))
    const value = dec(part.slice(eq + 1).replace(/^"|"$/g, ''))
    if (key === 'oauth_signature') received = value
    else if (key !== 'realm') oauthParams.push([key, value])
  }

  const pairs: Array<[string, string]> = [...oauthParams]
  const qIndex = capture.url.indexOf('?')
  const query = qIndex >= 0 ? capture.url.slice(qIndex + 1) : ''
  for (const source of [query, capture.body]) {
    if (!source) continue
    for (const part of source.split('&')) {
      if (!part) continue
      const eq = part.indexOf('=')
      pairs.push(eq < 0 ? [dec(part), ''] : [dec(part.slice(0, eq)), dec(part.slice(eq + 1))])
    }
  }

  const normalized = pairs
    .map(([k, v]) => [enc(k), enc(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const path = qIndex >= 0 ? capture.url.slice(0, qIndex) : capture.url
  const baseUrl = `http://${capture.headers['host']}${path}`
  const baseString = [capture.method.toUpperCase(), enc(baseUrl), enc(normalized)].join('&')
  const key = `${enc(consumerSecret)}&${enc(tokenSecret)}`
  return createHmac('sha1', key).update(baseString).digest('base64') === received
}

describe('OAuth 1.0a over the wire', () => {
  const auth: Auth = {
    type: 'oauth1',
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    token: 'access-token',
    tokenSecret: 'token-secret',
    signatureMethod: 'HMAC-SHA1',
    addTo: 'header'
  }

  it('signs a urlencoded body, including REPEATED keys', async () => {
    const result = await runRequest(
      spec({
        method: 'POST',
        url: `${base}/resource`,
        auth,
        body: {
          type: 'urlencoded',
          items: [
            { key: 'tag', value: 'alpha', enabled: true },
            { key: 'tag', value: 'beta', enabled: true },
            { key: 'name', value: 'value with spaces', enabled: true }
          ]
        }
      }),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(captures[0].body).toBe('tag=alpha&tag=beta&name=value+with+spaces')
    expect(oauth1SignatureIsValid(captures[0], 'consumer-secret', 'token-secret')).toBe(true)
  })

  it('signs a urlencoded item whose `enabled` flag is absent (it is still sent)', async () => {
    await runRequest(
      spec({
        method: 'POST',
        url: `${base}/resource`,
        auth,
        body: {
          type: 'urlencoded',
          items: [{ key: 'implicit', value: '1' } as never]
        }
      }),
      OPTS
    )

    expect(captures[0].body).toBe('implicit=1')
    expect(oauth1SignatureIsValid(captures[0], 'consumer-secret', 'token-secret')).toBe(true)
  })

  it('signs query parameters together with the body', async () => {
    await runRequest(
      spec({
        method: 'POST',
        url: `${base}/resource?b=2&a=1`,
        auth,
        body: { type: 'urlencoded', items: [{ key: 'c', value: '3', enabled: true }] }
      }),
      OPTS
    )

    expect(oauth1SignatureIsValid(captures[0], 'consumer-secret', 'token-secret')).toBe(true)
  })

  it('uses a fresh nonce for every request', async () => {
    await runRequest(spec({ url: `${base}/a`, auth }), OPTS)
    await runRequest(spec({ url: `${base}/a`, auth }), OPTS)
    const nonceOf = (c: Capture): string =>
      /oauth_nonce="([^"]+)"/.exec(c.headers['authorization'] ?? '')?.[1] ?? ''
    expect(nonceOf(captures[0])).not.toBe('')
    expect(nonceOf(captures[0])).not.toBe(nonceOf(captures[1]))
  })
})

/**
 * Independent Hawk verifier: rebuild the normalized request string from what the
 * server received and recompute the MAC (and the payload hash, when the client
 * sent one). Catches engine-side wiring mistakes — a payload hashed with the
 * wrong content-type, or a MAC over the wrong path.
 */
function hawkIsValid(capture: Capture, key: string): boolean {
  const header = capture.headers['authorization'] ?? ''
  if (!header.startsWith('Hawk ')) return false
  const attrs: Record<string, string> = {}
  for (const part of header.slice('Hawk '.length).split(', ')) {
    const eq = part.indexOf('=')
    attrs[part.slice(0, eq)] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }

  const [host, port] = (capture.headers['host'] ?? '').split(':')
  if (attrs.hash) {
    const contentType = (capture.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const payloadHash = createHash('sha256')
      .update(`hawk.1.payload\n${contentType}\n${capture.body}\n`)
      .digest('base64')
    if (payloadHash !== attrs.hash) return false
  }

  const normalized =
    'hawk.1.header\n' +
    `${attrs.ts}\n${attrs.nonce}\n${capture.method.toUpperCase()}\n` +
    `${capture.url}\n${host}\n${port ?? '80'}\n${attrs.hash ?? ''}\n${attrs.ext ?? ''}\n`
  return createHmac('sha256', key).update(normalized).digest('base64') === attrs.mac
}

describe('Hawk over the wire', () => {
  const auth: Auth = { type: 'hawk', id: 'dh37fgj492je', key: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn', algorithm: 'sha256', ext: 'some-app-ext-data' }

  it('MACs the exact method, path and query that are sent', async () => {
    const result = await runRequest(spec({ url: `${base}/resource/1?b=1&a=2`, auth }), OPTS)

    expect(result.status).toBe(200)
    expect(hawkIsValid(captures[0], auth.type === 'hawk' ? auth.key : '')).toBe(true)
    expect(captures[0].headers['authorization']).toContain('ext="some-app-ext-data"')
  })

  it('hashes a JSON payload with the normalized content-type', async () => {
    await runRequest(
      spec({
        method: 'POST',
        url: `${base}/resource`,
        auth,
        body: { type: 'raw', language: 'json', text: '{"thing":true}' }
      }),
      OPTS
    )

    expect(captures[0].headers['authorization']).toContain('hash="')
    expect(hawkIsValid(captures[0], auth.type === 'hawk' ? auth.key : '')).toBe(true)
  })

  it('re-MACs after a same-origin redirect', async () => {
    handler = (_req, capture) =>
      capture.url.startsWith('/old')
        ? { status: 302, headers: { Location: '/new' } }
        : { status: 200, body: 'ok' }

    await runRequest(spec({ url: `${base}/old`, auth }), OPTS)

    expect(captures).toHaveLength(2)
    expect(hawkIsValid(captures[1], auth.type === 'hawk' ? auth.key : '')).toBe(true)
  })
})

describe('an auth that cannot be produced stops the send', () => {
  it('refuses to send with a JWT payload that is not JSON', async () => {
    const res = await runRequest(
      spec({ url: `${base}/jwt`, auth: { type: 'jwt', algorithm: 'HS256', secret: 's', payload: '{ not json', headerPrefix: 'Bearer', addTo: 'header' } }),
      OPTS
    )
    expect(res.error?.kind).toBe('auth')
    expect(res.error?.message).toMatch(/JWT/)
    // Nothing reached the server: an unsigned request would have come back as an unexplained 401.
    expect(captures).toHaveLength(0)
  })

  it('refuses to send with an RS256 key that is not a PEM', async () => {
    const res = await runRequest(
      spec({ url: `${base}/rs`, auth: { type: 'jwt', algorithm: 'RS256', secret: 'not a key', payload: '{}', headerPrefix: 'Bearer', addTo: 'header' } }),
      OPTS
    )
    expect(res.error?.kind).toBe('auth')
    expect(captures).toHaveLength(0)
  })

  it('refuses to send with an ASAP private key that is not a PEM', async () => {
    const res = await runRequest(
      spec({ url: `${base}/asap`, auth: { type: 'asap', issuer: 'i', audience: 'a', keyId: 'k', privateKey: 'garbage' } }),
      OPTS
    )
    expect(res.error?.kind).toBe('auth')
    expect(captures).toHaveLength(0)
  })
})

describe('OAuth 2.0 auto-refresh', () => {
  it('replays with the refreshed token and hands it back to be stored', async () => {
    handler = (req, c) => {
      if (c.url === '/token') return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'fresh', refresh_token: 'r2' }) }
      return c.headers.authorization === 'Bearer fresh' ? { status: 200, body: 'ok' } : { status: 401, body: 'expired' }
    }
    const res = await runRequest(
      spec({
        url: `${base}/data`,
        auth: { type: 'oauth2', grant: 'client_credentials', accessToken: 'stale', headerPrefix: 'Bearer', tokenUrl: `${base}/token`, refreshToken: 'r1', autoRefresh: true, clientId: 'app' }
      }),
      OPTS
    )
    expect(res.status).toBe(200)
    expect(res.refreshedAuth).toEqual({ accessToken: 'fresh', refreshToken: 'r2' })
    expect(captures.map((c) => c.url)).toEqual(['/data', '/token', '/data'])
  })

  it('reports nothing to store when no refresh happened', async () => {
    const res = await runRequest(
      spec({ url: `${base}/ok`, auth: { type: 'oauth2', grant: 'client_credentials', accessToken: 'good', headerPrefix: 'Bearer', autoRefresh: true, refreshToken: 'r', tokenUrl: `${base}/token` } }),
      OPTS
    )
    expect(res.status).toBe(200)
    expect(res.refreshedAuth).toBeUndefined()
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Auth, RequestSpec, RunOptions } from '@shared/types'
import { runRequest } from './engine'

/**
 * RFC 7616 challenge/response driven by the engine against a real (local)
 * Digest server: the 401 round-trip, MD5 and SHA-256, qop=auth and auth-int,
 * opaque echoing, and the `stale=true` re-challenge.
 */

interface Attempt {
  authorization: string | undefined
  params: Record<string, string>
  method: string
  url: string
  body: string
}

type DigestAlgorithm = 'MD5' | 'SHA-256' | 'SHA-512-256'

interface ServerConfig {
  algorithm: DigestAlgorithm
  qop: string | undefined
  opaque: string | undefined
  /** nonces the server still accepts; anything else gets `stale=true` */
  validNonces: string[]
  nonce: string
  /** issue a brand-new nonce with every challenge and expire the first one */
  rotateNonce?: boolean
}

const USERNAME = 'Mufasa'
const PASSWORD = 'Circle Of Life'
const REALM = 'http-auth@example.org'

let server: Server
let base = ''
let attempts: Attempt[] = []
let config: ServerConfig
/** Nonces handed out in rotate mode, oldest first. */
let issued: string[] = []

const NODE_HASH: Record<DigestAlgorithm, string> = {
  MD5: 'md5',
  'SHA-256': 'sha256',
  'SHA-512-256': 'sha512-256'
}

function h(algorithm: DigestAlgorithm, data: string): string {
  return createHash(NODE_HASH[algorithm]).update(data, 'utf8').digest('hex')
}

/** Parse a Digest Authorization header into its parameters. */
function parseAuthorization(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = value.replace(/^Digest\s+/i, '')
  for (const part of body.split(/,\s*(?=[a-zA-Z]+=)/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, '')
  }
  return out
}

/** Recompute the expected `response` exactly as RFC 7616 §3.4.1 prescribes. */
function expectedResponse(a: Attempt, algorithm: DigestAlgorithm): string {
  const p = a.params
  const ha1 = h(algorithm, `${USERNAME}:${p.realm}:${PASSWORD}`)
  const ha2 =
    p.qop === 'auth-int'
      ? h(algorithm, `${a.method}:${p.uri}:${h(algorithm, a.body)}`)
      : h(algorithm, `${a.method}:${p.uri}`)
  return p.qop
    ? h(algorithm, `${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
    : h(algorithm, `${ha1}:${p.nonce}:${ha2}`)
}

beforeEach(async () => {
  attempts = []
  issued = []
  config = {
    algorithm: 'MD5',
    qop: 'auth',
    opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS',
    validNonces: ['7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v'],
    nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v'
  }

  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const authorization = req.headers['authorization']
      const attempt: Attempt = {
        authorization,
        params: authorization ? parseAuthorization(authorization) : {},
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf8')
      }
      attempts.push(attempt)

      const nextNonce = (): string => {
        if (!config.rotateNonce) return config.nonce
        issued.push(`rotated-nonce-${issued.length + 1}`)
        return issued[issued.length - 1]
      }
      const accepted = (nonce: string): boolean =>
        config.rotateNonce ? issued.indexOf(nonce) > 0 : config.validNonces.includes(nonce)

      const challenge = (stale: boolean): void => {
        const parts = [`realm="${REALM}"`, `nonce="${nextNonce()}"`]
        if (config.qop) parts.push(`qop="${config.qop}"`)
        if (config.opaque) parts.push(`opaque="${config.opaque}"`)
        parts.push(`algorithm=${config.algorithm}`)
        if (stale) parts.push('stale=true')
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', `Digest ${parts.join(', ')}`)
        res.end('unauthorized')
      }

      if (!authorization || !/^Digest\s/i.test(authorization)) {
        challenge(false)
        return
      }
      if (!accepted(attempt.params.nonce)) {
        // Known-good credentials, expired nonce → stale re-challenge.
        challenge(true)
        return
      }
      if (attempt.params.response !== expectedResponse(attempt, config.algorithm)) {
        challenge(false)
        return
      }
      res.statusCode = 200
      res.end('authenticated')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const OPTS: RunOptions = { requestId: 'digest' }

function spec(auth: Auth, partial: Partial<RequestSpec> = {}): RequestSpec {
  return {
    method: 'GET',
    url: `${base}/dir/index.html`,
    query: [],
    headers: [],
    body: { type: 'none' },
    auth,
    settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, rejectUnauthorized: true },
    ...partial
  }
}

const CREDS: Auth = { type: 'digest', username: USERNAME, password: PASSWORD }

describe('Digest — challenge/response round trip', () => {
  it('answers a 401 MD5 qop=auth challenge and succeeds on the replay', async () => {
    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts).toHaveLength(2)
    expect(attempts[0].authorization).toBeUndefined()
    const p = attempts[1].params
    expect(p.username).toBe(USERNAME)
    expect(p.realm).toBe(REALM)
    expect(p.uri).toBe('/dir/index.html')
    expect(p.qop).toBe('auth')
    expect(p.nc).toBe('00000001')
    expect(p.cnonce).toMatch(/^[0-9a-f]{32}$/)
    expect(p.algorithm).toBe('MD5')
    expect(p.opaque).toBe(config.opaque)
  })

  it('works with algorithm=SHA-256', async () => {
    config.algorithm = 'SHA-256'
    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts[1].params.algorithm).toBe('SHA-256')
  })

  it('works with algorithm=SHA-512-256 (RFC 7616 §3.9.2)', async () => {
    config.algorithm = 'SHA-512-256'
    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts[1].params.algorithm).toBe('SHA-512-256')
  })

  it('falls back to RFC 2069 (no qop) when the server offers none', async () => {
    config.qop = undefined
    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts[1].params.qop).toBeUndefined()
    expect(attempts[1].params.nc).toBeUndefined()
    expect(attempts[1].params.cnonce).toBeUndefined()
  })

  it('signs the body when the server only offers qop=auth-int', async () => {
    config.qop = 'auth-int'
    const result = await runRequest(
      spec(CREDS, {
        method: 'POST',
        body: { type: 'raw', language: 'json', text: '{"hello":"world"}' }
      }),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(attempts[1].params.qop).toBe('auth-int')
    expect(attempts[1].body).toBe('{"hello":"world"}')
  })

  it('prefers qop=auth when the server offers both', async () => {
    config.qop = 'auth,auth-int'
    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts[1].params.qop).toBe('auth')
  })

  it('puts path AND query into the uri parameter', async () => {
    const result = await runRequest(
      spec(CREDS, { url: `${base}/dir/index.html`, query: [{ key: 'a', value: '1', enabled: true }] }),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(attempts[1].params.uri).toBe('/dir/index.html?a=1')
  })

  it('uses a fresh cnonce on every request', async () => {
    await runRequest(spec(CREDS), OPTS)
    await runRequest(spec(CREDS), OPTS)
    expect(attempts[1].params.cnonce).not.toBe(attempts[3].params.cnonce)
  })

  it('surfaces the 401 (without looping) when the password is wrong', async () => {
    const result = await runRequest(spec({ ...CREDS, password: 'wrong' } as Auth), OPTS)

    expect(result.status).toBe(401)
    expect(attempts).toHaveLength(2)
  })
})

describe('Digest — preemptive mode and stale nonces', () => {
  it('sends credentials on the FIRST request when a challenge is configured', async () => {
    const result = await runRequest(
      spec({
        ...CREDS,
        preemptive: true,
        realm: REALM,
        nonce: config.nonce,
        qop: 'auth',
        opaque: config.opaque,
        algorithm: 'MD5'
      } as Auth),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(attempts).toHaveLength(1) // no 401 round-trip
    expect(attempts[0].params.nonce).toBe(config.nonce)
  })

  it('recovers from a stale nonce in preemptive mode (RFC 7616 §3.3)', async () => {
    // The user's saved nonce has expired; the server re-challenges with stale=true
    // and a fresh nonce. Without honoring `stale` this request can never succeed.
    const result = await runRequest(
      spec({
        ...CREDS,
        preemptive: true,
        realm: REALM,
        nonce: 'expired-nonce-from-last-week',
        qop: 'auth',
        algorithm: 'MD5'
      } as Auth),
      OPTS
    )

    expect(result.status).toBe(200)
    expect(attempts).toHaveLength(2)
    expect(attempts[0].params.nonce).toBe('expired-nonce-from-last-week')
    expect(attempts[1].params.nonce).toBe(config.nonce)
  })

  it('recovers when the nonce expires between the challenge and the replay', async () => {
    // The server issues a new nonce per challenge and treats the first one as
    // already expired: 401 (nonce 1) → stale 401 (nonce 2) → 200.
    config.rotateNonce = true

    const result = await runRequest(spec(CREDS), OPTS)

    expect(result.status).toBe(200)
    expect(attempts).toHaveLength(3)
    expect(attempts[1].params.nonce).toBe('rotated-nonce-1')
    expect(attempts[2].params.nonce).toBe('rotated-nonce-2')
  })

  it('retries a stale challenge at most once (never loops)', async () => {
    // Every nonce is rejected as stale: the engine must give up, not spin.
    config.validNonces = []
    const result = await runRequest(
      spec({ ...CREDS, preemptive: true, realm: REALM, nonce: 'n0', qop: 'auth', algorithm: 'MD5' } as Auth),
      OPTS
    )

    expect(result.status).toBe(401)
    expect(attempts).toHaveLength(2)
  })
})

/**
 * Self-consistency tests for Akamai EdgeGrid authentication.
 *
 * No public numeric vector is asserted here. Instead we (a) check structural
 * invariants of the produced header, and (b) re-derive the signature by hand —
 * mirroring the documented EdgeGrid algorithm independently of the module under
 * test — and assert it matches (cross-check). We also assert that changing the
 * POST body changes the signature.
 */
import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { edgeGridHeader, edgeGridTimestamp, type EdgeGridOptions } from './akamai'

// Fixed, deterministic inputs so the header is reproducible.
const TIMESTAMP = '20210101T12:00:00+0000'
const NONCE = 'nonce-0123456789'

const BASE: EdgeGridOptions = {
  method: 'GET',
  url: 'https://akab-xxxx.luna.akamaiapis.net/diagnostic-tools/v2/ghost-locations/available',
  clientToken: 'akab-client-token-xxx-xxxxxxxxxxxxxxxx',
  clientSecret: 'SOMESECRET=clientsecretvalue1234567890abcd',
  accessToken: 'akab-access-token-xxx-xxxxxxxxxxxxxxxx',
  timestamp: TIMESTAMP,
  nonce: NONCE
}

/** Independent re-implementation of the EdgeGrid signing algorithm. */
function recompute(opts: EdgeGridOptions): { authHeaderWithoutSig: string; signature: string } {
  const method = opts.method.toUpperCase()
  const u = new URL(opts.url)
  const scheme = u.protocol.replace(/:$/, '').toLowerCase()
  const host = u.host.toLowerCase()
  const relativeUrl = u.pathname + u.search
  const maxBody = opts.maxBody ?? 131072

  // Canonicalized headers.
  let canonicalHeaders = ''
  if (opts.headersToSign && opts.headersToSign.length > 0 && opts.headers) {
    const lookup: Record<string, string> = {}
    for (const [k, v] of Object.entries(opts.headers)) lookup[k.toLowerCase()] = v
    const segs: string[] = []
    for (const name of opts.headersToSign) {
      const val = lookup[name.toLowerCase()]
      if (val === undefined) continue
      segs.push(`${name.toLowerCase()}:${val.trim().replace(/\s+/g, ' ')}`)
    }
    canonicalHeaders = segs.join('\t')
  }

  // Content hash (POST/PUT only).
  let contentHash = ''
  if ((method === 'POST' || method === 'PUT') && opts.body) {
    const buf = Buffer.from(opts.body, 'utf8')
    const trunc = buf.length > maxBody ? buf.subarray(0, maxBody) : buf
    contentHash = createHash('sha256').update(trunc).digest('base64')
  }

  const authHeaderWithoutSig =
    `EG1-HMAC-SHA256 ` +
    `client_token=${opts.clientToken};` +
    `access_token=${opts.accessToken};` +
    `timestamp=${opts.timestamp};` +
    `nonce=${opts.nonce};`

  const dataToSign = [
    method,
    scheme,
    host,
    relativeUrl,
    canonicalHeaders,
    contentHash,
    authHeaderWithoutSig
  ].join('\t')

  const signingKey = createHmac('sha256', opts.clientSecret as string)
    .update(opts.timestamp as string, 'utf8')
    .digest('base64')
  const signature = createHmac('sha256', signingKey).update(dataToSign, 'utf8').digest('base64')

  return { authHeaderWithoutSig, signature }
}

/** Extract a "key=value" param from the EG1 header (params are ';'-separated). */
function parseHeader(header: string): Record<string, string> {
  const prefix = 'EG1-HMAC-SHA256 '
  const body = header.slice(prefix.length)
  const out: Record<string, string> = {}
  for (const part of body.split(';')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

describe('edgeGridHeader', () => {
  it('starts with the EG1-HMAC-SHA256 scheme', () => {
    const header = edgeGridHeader(BASE)
    expect(header.startsWith('EG1-HMAC-SHA256 ')).toBe(true)
  })

  it('contains client_token, access_token, timestamp, nonce, and signature', () => {
    const header = edgeGridHeader(BASE)
    const params = parseHeader(header)
    expect(params.client_token).toBe(BASE.clientToken)
    expect(params.access_token).toBe(BASE.accessToken)
    expect(params.timestamp).toBe(TIMESTAMP)
    expect(params.nonce).toBe(NONCE)
    expect(params.signature).toBeTruthy()
  })

  it('emits the params in the canonical order', () => {
    const header = edgeGridHeader(BASE)
    const idxClient = header.indexOf('client_token=')
    const idxAccess = header.indexOf('access_token=')
    const idxTs = header.indexOf('timestamp=')
    const idxNonce = header.indexOf('nonce=')
    const idxSig = header.indexOf('signature=')
    expect(idxClient).toBeLessThan(idxAccess)
    expect(idxAccess).toBeLessThan(idxTs)
    expect(idxTs).toBeLessThan(idxNonce)
    expect(idxNonce).toBeLessThan(idxSig)
  })

  it('signature is valid base64 of exactly 32 bytes (HMAC-SHA256 output)', () => {
    const header = edgeGridHeader(BASE)
    const { signature } = parseHeader(header)
    // Valid standard base64.
    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    const decoded = Buffer.from(signature, 'base64')
    expect(decoded.length).toBe(32)
    // Round-trips back to the same string (no stray padding/whitespace).
    expect(decoded.toString('base64')).toBe(signature)
  })

  it('cross-checks the signature against an independent re-implementation (GET)', () => {
    const header = edgeGridHeader(BASE)
    const { signature } = parseHeader(header)
    const mirror = recompute(BASE)
    expect(signature).toBe(mirror.signature)
    // The full header is exactly authHeaderWithoutSig + "signature=" + signature.
    expect(header).toBe(`${mirror.authHeaderWithoutSig}signature=${mirror.signature}`)
  })

  it('is deterministic for identical fixed inputs', () => {
    expect(edgeGridHeader(BASE)).toBe(edgeGridHeader(BASE))
  })

  it('cross-checks the signature for a POST with a body and signed headers', () => {
    const opts: EdgeGridOptions = {
      ...BASE,
      method: 'POST',
      url: 'https://akab-xxxx.luna.akamaiapis.net/identity-management/v3/user-profile',
      body: '{"name":"forge","value":42}',
      headersToSign: ['Content-Type', 'X-Custom'],
      headers: {
        'Content-Type': 'application/json',
        'X-Custom': '  multiple   spaces   here  ',
        'X-Ignored': 'not signed'
      }
    }
    const header = edgeGridHeader(opts)
    const { signature } = parseHeader(header)
    const mirror = recompute(opts)
    expect(signature).toBe(mirror.signature)
    expect(Buffer.from(signature, 'base64').length).toBe(32)
  })

  it('changes the signature when the POST body changes', () => {
    const a: EdgeGridOptions = {
      ...BASE,
      method: 'POST',
      url: 'https://example.akamaiapis.net/foo',
      body: 'body-A'
    }
    const b: EdgeGridOptions = { ...a, body: 'body-B' }
    const sigA = parseHeader(edgeGridHeader(a)).signature
    const sigB = parseHeader(edgeGridHeader(b)).signature
    expect(sigA).not.toBe(sigB)
  })

  it('produces the same signature for an empty-body POST and a GET differ only by method', () => {
    // Method is part of data-to-sign, so a GET and a POST (no body) must differ.
    const get: EdgeGridOptions = { ...BASE, method: 'GET', url: 'https://example.akamaiapis.net/x' }
    const post: EdgeGridOptions = { ...get, method: 'POST' }
    const sigGet = parseHeader(edgeGridHeader(get)).signature
    const sigPost = parseHeader(edgeGridHeader(post)).signature
    expect(sigGet).not.toBe(sigPost)
  })

  it('truncates the hashed body to maxBody (a change beyond maxBody is ignored)', () => {
    const base: EdgeGridOptions = {
      ...BASE,
      method: 'POST',
      url: 'https://example.akamaiapis.net/x',
      maxBody: 8,
      body: 'AAAAAAAA' + 'X'
    }
    const changedTail: EdgeGridOptions = { ...base, body: 'AAAAAAAA' + 'Y' }
    const sig1 = parseHeader(edgeGridHeader(base)).signature
    const sig2 = parseHeader(edgeGridHeader(changedTail)).signature
    // Bytes beyond the 8-byte limit are not hashed → same signature.
    expect(sig1).toBe(sig2)
    // But a change within the first 8 bytes does matter.
    const changedHead: EdgeGridOptions = { ...base, body: 'BAAAAAAA' + 'X' }
    expect(parseHeader(edgeGridHeader(changedHead)).signature).not.toBe(sig1)
  })

  it('does not hash a body for GET (content hash is empty)', () => {
    const withBody: EdgeGridOptions = {
      ...BASE,
      method: 'GET',
      url: 'https://example.akamaiapis.net/x',
      body: 'this body must be ignored for GET'
    }
    const withoutBody: EdgeGridOptions = { ...withBody, body: undefined }
    expect(parseHeader(edgeGridHeader(withBody)).signature).toBe(
      parseHeader(edgeGridHeader(withoutBody)).signature
    )
  })
})

describe('edgeGridTimestamp', () => {
  it("formats a Date as yyyyMMdd'T'HH:mm:ss+0000 in UTC", () => {
    const d = new Date(Date.UTC(2021, 0, 1, 12, 0, 0))
    expect(edgeGridTimestamp(d)).toBe('20210101T12:00:00+0000')
  })

  it('zero-pads month, day, hour, minute, second', () => {
    const d = new Date(Date.UTC(2009, 8, 5, 3, 4, 7))
    expect(edgeGridTimestamp(d)).toBe('20090905T03:04:07+0000')
  })
})

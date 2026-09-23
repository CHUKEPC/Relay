import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { edgeGridHeader } from './akamai'

/**
 * Akamai's EdgeGrid specification defines `content_hash` as "the base64-encoded
 * SHA-256 hash of the POST body" — for every other method, PUT included, the
 * field is empty. Both of Akamai's reference clients (edgegrid-python,
 * edgegrid-node) hash POST bodies only, so hashing a PUT body would make our
 * signature disagree with the edge server's and the request would 401.
 */
const CREDS = {
  clientToken: 'akab-client-token-xxx',
  clientSecret: 'SOMESECRET',
  accessToken: 'akab-access-token-xxx',
  timestamp: '20210101T12:00:00+0000',
  nonce: 'fixed-nonce'
}

function signatureOf(header: string): string {
  const m = /signature=(.+)$/.exec(header)
  if (!m) throw new Error(`no signature in ${header}`)
  return m[1]
}

/** Independent re-implementation of the EdgeGrid signature, from the spec. */
function reference(method: string, url: string, contentHash: string): string {
  const parsed = new URL(url)
  const authWithoutSig =
    'EG1-HMAC-SHA256 ' +
    `client_token=${CREDS.clientToken};` +
    `access_token=${CREDS.accessToken};` +
    `timestamp=${CREDS.timestamp};` +
    `nonce=${CREDS.nonce};`
  const signingKey = createHmac('sha256', CREDS.clientSecret).update(CREDS.timestamp).digest('base64')
  const data = [
    method.toUpperCase(),
    parsed.protocol.replace(':', ''),
    parsed.host,
    `${parsed.pathname}${parsed.search}`,
    '',
    contentHash,
    authWithoutSig
  ].join('\t')
  return createHmac('sha256', signingKey).update(data).digest('base64')
}

describe('edgeGridHeader — content hash is POST-only', () => {
  const url = 'https://akab-host.luna.akamaiapis.net/papi/v1/properties'
  const body = '{"propertyName":"example"}'

  it('hashes a POST body', () => {
    const header = edgeGridHeader({ method: 'POST', url, body, ...CREDS })
    const expected = createHash('sha256').update(body).digest('base64')
    expect(signatureOf(header)).toBe(reference('POST', url, expected))
  })

  it('does NOT hash a PUT body (empty content hash)', () => {
    const header = edgeGridHeader({ method: 'PUT', url, body, ...CREDS })
    expect(signatureOf(header)).toBe(reference('PUT', url, ''))
  })

  it('a PUT signs identically with and without a body', () => {
    const withBody = edgeGridHeader({ method: 'PUT', url, body, ...CREDS })
    const withoutBody = edgeGridHeader({ method: 'PUT', url, ...CREDS })
    expect(signatureOf(withBody)).toBe(signatureOf(withoutBody))
  })

  it('DELETE and PATCH bodies are not hashed either', () => {
    for (const method of ['DELETE', 'PATCH']) {
      const header = edgeGridHeader({ method, url, body, ...CREDS })
      expect(signatureOf(header)).toBe(reference(method, url, ''))
    }
  })
})

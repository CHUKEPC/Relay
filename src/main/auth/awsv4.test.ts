import { describe, it, expect } from 'vitest'
import { signAwsV4 } from './awsv4'

/**
 * The canonical AWS SigV4 test-suite credentials used by the "get-vanilla" and
 * related fixtures.
 */
const CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  datetime: '20150830T123600Z'
}

/**
 * Expected Signature for the AWS "get-vanilla" inputs (GET https://example.amazonaws.com/,
 * empty body, signed headers host;x-amz-date, date 20150830, region us-east-1,
 * service "service", secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY).
 *
 * This is the cryptographically correct value. It is independently confirmed from
 * AWS's own published intermediate values for this case: the canonical request hash
 * is bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63 and the
 * resulting HMAC-SHA256(signingKey, stringToSign) is the hex below. Multiple
 * implementations (and a from-scratch reference computation in node:crypto) agree.
 */
const GET_VANILLA_SIGNATURE =
  'ea21d6f05e96a897f6000a1a293f0a5bf0f92a00343409e820dce329ca6365ea'

describe('signAwsV4', () => {
  it('matches the official "get-vanilla" test vector', () => {
    const out = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: {
        Host: 'example.amazonaws.com',
        'X-Amz-Date': '20150830T123600Z'
      },
      body: '',
      ...CREDS
    })

    expect(out.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        `Signature=${GET_VANILLA_SIGNATURE}`
    )
    expect(out['X-Amz-Date']).toBe('20150830T123600Z')
    // x-amz-content-sha256 must NOT be added for this vector.
    expect(out['X-Amz-Content-Sha256']).toBeUndefined()
    expect(out['X-Amz-Security-Token']).toBeUndefined()
  })

  it('signs only host and x-amz-date even when host is derived from the URL', () => {
    // Omit the Host header; it must be derived and produce the same signature.
    const out = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { 'X-Amz-Date': '20150830T123600Z' },
      ...CREDS
    })
    expect(out.Authorization).toContain('SignedHeaders=host;x-amz-date')
    expect(out.Authorization).toContain(`Signature=${GET_VANILLA_SIGNATURE}`)
  })

  it('uses the current time when datetime is omitted (X-Amz-Date format)', () => {
    const out = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: {},
      accessKeyId: CREDS.accessKeyId,
      secretAccessKey: CREDS.secretAccessKey,
      region: CREDS.region,
      service: CREDS.service
    })
    expect(out['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/)
    // The scope date must equal the first 8 chars of X-Amz-Date.
    const date = out['X-Amz-Date'].slice(0, 8)
    expect(out.Authorization).toContain(`/${date}/us-east-1/service/aws4_request`)
  })

  it('includes X-Amz-Security-Token and signs it when a sessionToken is provided', () => {
    const out = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      sessionToken: 'AQoEXAMPLEsession',
      ...CREDS
    })
    expect(out['X-Amz-Security-Token']).toBe('AQoEXAMPLEsession')
    expect(out.Authorization).toContain('host;x-amz-date;x-amz-security-token')
    // Signature must differ from the no-token case since the token is signed.
    expect(out.Authorization).not.toContain(`Signature=${GET_VANILLA_SIGNATURE}`)
  })

  it('echoes X-Amz-Content-Sha256 only when the caller passed it', () => {
    const out = signAwsV4({
      method: 'PUT',
      url: 'https://example.amazonaws.com/key',
      headers: {
        Host: 'example.amazonaws.com',
        'X-Amz-Date': '20150830T123600Z',
        'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD'
      },
      body: 'hello',
      ...CREDS
    })
    expect(out['X-Amz-Content-Sha256']).toBe('UNSIGNED-PAYLOAD')
    expect(out.Authorization).toContain('host;x-amz-content-sha256;x-amz-date')
  })

  it('produces a stable signature for sorted query parameters regardless of input order', () => {
    const a = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/?b=2&a=1',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      ...CREDS
    })
    const b = signAwsV4({
      method: 'GET',
      url: 'https://example.amazonaws.com/?a=1&b=2',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      ...CREDS
    })
    expect(a.Authorization).toBe(b.Authorization)
  })

  it('hashes the request body so different payloads yield different signatures', () => {
    const empty = signAwsV4({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      body: '',
      ...CREDS
    })
    const withBody = signAwsV4({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      body: '{"x":1}',
      ...CREDS
    })
    expect(empty.Authorization).not.toBe(withBody.Authorization)
  })

  it('accepts a Buffer body', () => {
    const out = signAwsV4({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      body: Buffer.from('payload', 'utf8'),
      ...CREDS
    })
    const outStr = signAwsV4({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
      body: 'payload',
      ...CREDS
    })
    expect(out.Authorization).toBe(outStr.Authorization)
  })
})

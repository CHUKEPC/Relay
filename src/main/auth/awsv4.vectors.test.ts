import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { signAwsV4 } from './awsv4'

/**
 * AWS SigV4 conformance against the credentials and fixtures published in the
 * official "aws-sig-v4-test-suite": AKIDEXAMPLE signing for service "service"
 * in us-east-1 at 20150830T123600Z. Each expected Signature below is the value
 * from the fixture's `.authz` file.
 */
const SUITE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  datetime: '20150830T123600Z'
}

const HOST = 'example.amazonaws.com'
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

function signature(authorization: string): string {
  const m = /Signature=([0-9a-f]{64})/.exec(authorization)
  if (!m) throw new Error(`no signature in ${authorization}`)
  return m[1]
}

function signedHeaders(authorization: string): string {
  const m = /SignedHeaders=([^,]+)/.exec(authorization)
  if (!m) throw new Error(`no SignedHeaders in ${authorization}`)
  return m[1]
}

describe('signAwsV4 — official AWS test-suite vectors', () => {
  it('get-vanilla', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/`,
      headers: { Host: HOST },
      body: '',
      ...SUITE
    })
    expect(out.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })

  it('get-vanilla-query-order-key-case — the canonical query is sorted by encoded key', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/?Param2=value2&Param1=value1`,
      headers: { Host: HOST },
      body: '',
      ...SUITE
    })
    expect(signature(out.Authorization)).toBe(
      'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500'
    )
  })

  it('get-unreserved — RFC 3986 unreserved characters are never escaped', () => {
    const out = signAwsV4({
      method: 'GET',
      url:
        `https://${HOST}/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ` +
        'abcdefghijklmnopqrstuvwxyz',
      headers: { Host: HOST },
      body: '',
      ...SUITE
    })
    expect(signature(out.Authorization)).toBe(
      '07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f'
    )
  })
})

describe('signAwsV4 — path canonicalization', () => {
  it('get-space — a non-S3 path is URI-encoded twice (/%20 signs as /%2520)', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/%20`,
      headers: { Host: HOST },
      body: '',
      ...SUITE
    })
    expect(signature(out.Authorization)).toBe(
      '73b4673bc02d62bd45d8ef977729a69fc4f165df9972e1150c3241a08f5ca127'
    )
  })

  it('get-relative-relative — dot segments are resolved before signing', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/example1/example2/../..`,
      headers: { Host: HOST },
      body: '',
      ...SUITE
    })
    // Collapses to "/", so the signature equals get-vanilla's.
    expect(signature(out.Authorization)).toBe(
      '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })

  it('post-x-www-form-urlencoded — the body is hashed into the canonical request', () => {
    const out = signAwsV4({
      method: 'POST',
      url: `https://${HOST}/`,
      headers: { Host: HOST, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'Param1=value1',
      ...SUITE
    })
    expect(signedHeaders(out.Authorization)).toBe('content-type;host;x-amz-date')
    expect(signature(out.Authorization)).toBe(
      'ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a'
    )
  })

  it('derives the host header from the URL when the caller omits it', () => {
    const withHost = signAwsV4({ method: 'GET', url: `https://${HOST}/`, headers: { Host: HOST }, body: '', ...SUITE })
    const withoutHost = signAwsV4({ method: 'GET', url: `https://${HOST}/`, headers: {}, body: '', ...SUITE })
    expect(signature(withoutHost.Authorization)).toBe(signature(withHost.Authorization))
  })
})

describe('signAwsV4 — session token and unsigned payload', () => {
  it('signs and echoes x-amz-security-token for temporary credentials', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/`,
      headers: { Host: HOST },
      body: '',
      sessionToken: 'AQoDYXdzEJr-session',
      ...SUITE
    })
    expect(out['X-Amz-Security-Token']).toBe('AQoDYXdzEJr-session')
    expect(signedHeaders(out.Authorization)).toBe('host;x-amz-date;x-amz-security-token')
  })

  it('UNSIGNED-PAYLOAD is both the hashed payload and a signed header', () => {
    const out = signAwsV4({
      method: 'POST',
      url: `https://${HOST}/`,
      headers: { Host: HOST },
      unsignedPayload: true,
      ...SUITE
    })
    expect(out['X-Amz-Content-Sha256']).toBe('UNSIGNED-PAYLOAD')
    expect(signedHeaders(out.Authorization)).toBe('host;x-amz-content-sha256;x-amz-date')
  })
})

/**
 * S3 deviates from every other service in two ways that Relay must honor:
 *  - x-amz-content-sha256 is REQUIRED (S3 answers 400 "Missing required header
 *    for this request: x-amz-content-sha256" without it), and
 *  - the canonical URI is encoded exactly ONCE, not twice.
 */
describe('signAwsV4 — S3 rules', () => {
  const S3 = {
    accessKeyId: SUITE.accessKeyId,
    secretAccessKey: SUITE.secretAccessKey,
    region: 'us-east-1',
    datetime: SUITE.datetime
  }

  it('always sends and signs x-amz-content-sha256', () => {
    const out = signAwsV4({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: {},
      body: '',
      service: 's3',
      ...S3
    })
    expect(out['X-Amz-Content-Sha256']).toBe(EMPTY_SHA256)
    expect(signedHeaders(out.Authorization)).toBe('host;x-amz-content-sha256;x-amz-date')
  })

  it('carries the payload hash of a real body into x-amz-content-sha256', () => {
    const body = 'Welcome to Amazon S3.'
    const out = signAwsV4({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test.text',
      headers: {},
      body,
      service: 's3',
      ...S3
    })
    expect(out['X-Amz-Content-Sha256']).toBe(createHash('sha256').update(body).digest('hex'))
  })

  it('a non-S3 service still omits x-amz-content-sha256 unless the caller set it', () => {
    const out = signAwsV4({
      method: 'GET',
      url: `https://${HOST}/`,
      headers: {},
      body: '',
      ...SUITE
    })
    expect(out['X-Amz-Content-Sha256']).toBeUndefined()
  })

  it('signs the S3 path encoded ONCE — two spellings of one key agree', () => {
    const encoded = signAwsV4({
      method: 'GET',
      url: 'https://b.s3.amazonaws.com/my%20file.txt',
      headers: {},
      body: '',
      service: 's3',
      ...S3
    })
    const literal = signAwsV4({
      method: 'GET',
      url: 'https://b.s3.amazonaws.com/my file.txt',
      headers: {},
      body: '',
      service: 's3',
      ...S3
    })
    expect(signature(encoded.Authorization)).toBe(signature(literal.Authorization))
  })

  it('S3 and non-S3 disagree on the encoding depth of the same path', () => {
    const common = { method: 'GET' as const, url: 'https://b.s3.amazonaws.com/my%20file.txt', headers: {}, body: '' }
    const s3 = signAwsV4({ ...common, service: 's3', ...S3 })
    const other = signAwsV4({ ...common, service: 'execute-api', ...S3 })
    expect(signature(other.Authorization)).not.toBe(signature(s3.Authorization))
  })

  it('treats s3-prefixed endpoints (s3-object-lambda, s3-outposts) as S3', () => {
    const out = signAwsV4({
      method: 'GET',
      url: 'https://b.s3-object-lambda.us-east-1.amazonaws.com/k',
      headers: {},
      body: '',
      service: 's3-object-lambda',
      ...S3
    })
    expect(out['X-Amz-Content-Sha256']).toBe(EMPTY_SHA256)
  })
})

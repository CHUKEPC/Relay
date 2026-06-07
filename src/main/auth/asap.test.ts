import { describe, it, expect } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { asapToken } from './asap'

/** Decode a base64url JWT segment back into its JSON object. */
function decodeSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

describe('asapToken', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  const NOW = 1_700_000_000

  it('produces a valid RS256 JWT with the expected header, claims and signature', () => {
    const token = asapToken({
      issuer: 'micros/forge',
      audience: 'some-service',
      keyId: 'micros/forge/abc123',
      privateKeyPem,
      nowSeconds: NOW
    })

    // Compact JWT: header.payload.signature
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    const [headerSeg, claimsSeg, signatureSeg] = parts

    // Header assertions
    const header = decodeSegment(headerSeg)
    expect(header.alg).toBe('RS256')
    expect(header.typ).toBe('JWT')
    expect(header.kid).toBe('micros/forge/abc123')

    // Claim assertions
    const claims = decodeSegment(claimsSeg)
    expect(claims.iss).toBe('micros/forge')
    expect(claims.aud).toBe('some-service')
    expect(claims.sub).toBe('micros/forge') // defaults to issuer
    expect(claims.iat).toBe(NOW)
    expect(claims.exp).toBe(NOW + 3600)
    expect(claims.exp).toBe((claims.iat as number) + 3600)
    expect(typeof claims.jti).toBe('string')
    expect((claims.jti as string).length).toBeGreaterThan(0)

    // Signature must verify against the public key over the signing input.
    const signingInput = `${headerSeg}.${claimsSeg}`
    const signature = Buffer.from(
      signatureSeg.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    )
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signingInput)
    verifier.end()
    expect(verifier.verify(publicKey, signature)).toBe(true)
  })

  it('honors subject, custom expiry, array audience and additionalClaims', () => {
    const token = asapToken({
      issuer: 'issuer-x',
      audience: ['aud-a', 'aud-b'],
      keyId: 'kid-1',
      privateKeyPem,
      subject: 'sub-y',
      expirySeconds: 120,
      nowSeconds: NOW,
      additionalClaims: { scope: 'read', custom: 42 }
    })

    const claims = decodeSegment(token.split('.')[1])
    expect(claims.sub).toBe('sub-y')
    expect(claims.aud).toEqual(['aud-a', 'aud-b'])
    expect(claims.exp).toBe(NOW + 120)
    expect(claims.scope).toBe('read')
    expect(claims.custom).toBe(42)
  })

  it('does not let additionalClaims override reserved claims', () => {
    const token = asapToken({
      issuer: 'real-issuer',
      audience: 'real-aud',
      keyId: 'kid',
      privateKeyPem,
      nowSeconds: NOW,
      additionalClaims: { iss: 'spoofed', exp: 0, jti: 'fixed' }
    })

    const claims = decodeSegment(token.split('.')[1])
    expect(claims.iss).toBe('real-issuer')
    expect(claims.exp).toBe(NOW + 3600)
    expect(claims.jti).not.toBe('fixed')
  })

  it('emits a unique jti per call', () => {
    const base = {
      issuer: 'i',
      audience: 'a',
      keyId: 'k',
      privateKeyPem,
      nowSeconds: NOW
    }
    const a = decodeSegment(asapToken(base).split('.')[1])
    const b = decodeSegment(asapToken(base).split('.')[1])
    expect(a.jti).not.toBe(b.jti)
  })
})

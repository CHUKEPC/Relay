import { describe, it, expect } from 'vitest'
import {
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
  constants as cryptoConstants
} from 'node:crypto'
import { generateJwt } from './jwt'

/** Decode an RFC 7515 base64url string into a Buffer. */
function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

describe('generateJwt', () => {
  it('matches the canonical jwt.io HS256 example exactly', () => {
    const token = generateJwt({
      algorithm: 'HS256',
      secret: 'your-256-bit-secret',
      payload: { sub: '1234567890', name: 'John Doe', iat: 1516239022 }
    })

    expect(token).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
        '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
        '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    )
  })

  it('produces three base64url segments and the default header', () => {
    const token = generateJwt({
      algorithm: 'HS256',
      secret: 's',
      payload: { a: 1 }
    })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    // No base64url-illegal characters (no +, /, or = padding).
    expect(token).not.toMatch(/[+/=]/)
    const header = JSON.parse(fromBase64url(parts[0]).toString('utf8'))
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('merges and allows overriding header fields', () => {
    const token = generateJwt({
      algorithm: 'HS512',
      secret: 's',
      payload: { a: 1 },
      header: { kid: 'key-1', typ: 'at+jwt' }
    })
    const header = JSON.parse(fromBase64url(token.split('.')[0]).toString('utf8'))
    expect(header).toEqual({ alg: 'HS512', typ: 'at+jwt', kid: 'key-1' })
  })

  it('HS384 / HS512 round-trip verify with node crypto', () => {
    for (const algorithm of ['HS384', 'HS512'] as const) {
      const secret = 'super-secret'
      const token = generateJwt({ algorithm, secret, payload: { x: 42 } })
      const [h, p, sig] = token.split('.')
      const digest = algorithm === 'HS384' ? 'sha384' : 'sha512'
      // Recompute the HMAC and compare.
      const expected = createHmac(digest, secret).update(`${h}.${p}`).digest()
      expect(fromBase64url(sig).equals(expected)).toBe(true)
    }
  })

  it('throws on an unsupported algorithm', () => {
    expect(() =>
      generateJwt({
        // @ts-expect-error intentionally invalid
        algorithm: 'none',
        secret: 's',
        payload: {}
      })
    ).toThrow(/Unsupported JWT algorithm/)
  })

  it('RS256 sign + verify round-trip with a generated 2048-bit RSA key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })

    const payload = { sub: 'rsa-user', iat: 1516239022, role: 'admin' }
    const token = generateJwt({ algorithm: 'RS256', secret: privateKey, payload })

    const [h, p, sig] = token.split('.')
    const signingInput = Buffer.from(`${h}.${p}`, 'utf8')

    const valid = cryptoVerify(
      'sha256',
      signingInput,
      createPublicKey(publicKey),
      fromBase64url(sig)
    )
    expect(valid).toBe(true)

    // A tampered payload must fail verification.
    const tamperedValid = cryptoVerify(
      'sha256',
      Buffer.from(`${h}.${p}x`, 'utf8'),
      createPublicKey(publicKey),
      fromBase64url(sig)
    )
    expect(tamperedValid).toBe(false)

    // The decoded payload round-trips.
    expect(JSON.parse(fromBase64url(p).toString('utf8'))).toEqual(payload)
  })

  it('PS256 sign + verify round-trip with PSS padding and matching salt length', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })

    const token = generateJwt({
      algorithm: 'PS256',
      secret: privateKey,
      payload: { sub: 'pss-user' }
    })

    const [h, p, sig] = token.split('.')
    const valid = cryptoVerify(
      'sha256',
      Buffer.from(`${h}.${p}`, 'utf8'),
      {
        key: createPublicKey(publicKey),
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32
      },
      fromBase64url(sig)
    )
    expect(valid).toBe(true)
  })
})

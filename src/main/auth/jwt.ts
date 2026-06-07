/**
 * JSON Web Token (JWS, compact serialization) generation.
 *
 * Pure module: depends only on `node:crypto`. No Electron, no I/O, no global
 * state. Used by the request/auth layer to mint signed JWTs for Bearer-style
 * authentication schemes.
 *
 * Supported algorithms:
 *   - HS256 / HS384 / HS512 — HMAC with the corresponding SHA digest; `secret`
 *     is the shared symmetric key (UTF-8 string).
 *   - RS256 / RS384 / RS512 — RSASSA-PKCS1-v1_5; `secret` is a PEM-encoded RSA
 *     private key.
 *   - PS256 / PS384 / PS512 — RSASSA-PSS with MGF1 and a salt length equal to
 *     the digest length; `secret` is a PEM-encoded RSA private key.
 */
import {
  createHmac,
  createPrivateKey,
  sign as cryptoSign,
  constants as cryptoConstants
} from 'node:crypto'

export type JwtAlg =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'

export interface JwtOptions {
  algorithm: JwtAlg
  /** HMAC secret for HS algorithms, or a PEM-encoded RSA private key for RS/PS. */
  secret: string
  /** Claims set. Key order is preserved in the encoded payload. */
  payload: Record<string, unknown>
  /** Extra header fields merged after the default {alg, typ}. */
  header?: Record<string, unknown>
}

/** Map an algorithm to its underlying digest. */
const DIGEST: Record<JwtAlg, 'sha256' | 'sha384' | 'sha512'> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  PS256: 'sha256',
  PS384: 'sha384',
  PS512: 'sha512'
}

/** Digest output length in bytes, used as the PSS salt length for PS*. */
const DIGEST_BYTES: Record<'sha256' | 'sha384' | 'sha512', number> = {
  sha256: 32,
  sha384: 48,
  sha512: 64
}

/** RFC 7515 base64url: standard base64 with +/ → -_ and no padding. */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/**
 * Generate a compact JWS: "base64url(header).base64url(payload).base64url(sig)".
 *
 * The header is `{ alg, typ: 'JWT', ...opts.header }` — note the default fields
 * come first so a typical `{"alg":...,"typ":"JWT"}` ordering is preserved, and
 * caller-supplied header fields can override them.
 */
export function generateJwt(opts: JwtOptions): string {
  const { algorithm, secret, payload, header } = opts

  const digest = DIGEST[algorithm]
  if (!digest) {
    throw new Error(`Unsupported JWT algorithm: ${algorithm}`)
  }

  const fullHeader = { alg: algorithm, typ: 'JWT', ...(header ?? {}) }

  const encodedHeader = base64url(JSON.stringify(fullHeader))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  let signature: Buffer

  if (algorithm.startsWith('HS')) {
    signature = createHmac(digest, secret).update(signingInput).digest()
  } else {
    const key = createPrivateKey(secret)
    if (algorithm.startsWith('PS')) {
      signature = cryptoSign(digest, Buffer.from(signingInput, 'utf8'), {
        key,
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: DIGEST_BYTES[digest]
      })
    } else {
      // RS*: RSASSA-PKCS1-v1_5
      signature = cryptoSign(digest, Buffer.from(signingInput, 'utf8'), { key })
    }
  }

  return `${signingInput}.${base64url(signature)}`
}

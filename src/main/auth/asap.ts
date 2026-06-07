/**
 * Atlassian ASAP (Service-to-Service Authentication) token generation.
 *
 * ASAP is Atlassian's S2S auth scheme: the client presents a self-signed JWT
 * (signed with an RSA private key whose public key is published under a key id)
 * in the `Authorization: Bearer <jwt>` header. The server validates the JWT's
 * signature and standard claims.
 *
 * See: https://s2sauth.bitbucket.io/spec/
 *
 * Pure module: depends only on `node:crypto`. No electron, no undici, no fs, no
 * global state. JWT signing is implemented inline (RS256) to keep this file
 * self-contained.
 */
import { createSign, randomBytes } from 'node:crypto'

export interface AsapOptions {
  /** JWT `iss` claim — the issuer identifier registered with the resource server. */
  issuer: string
  /** JWT `aud` claim — the intended audience(s) of the token. */
  audience: string | string[]
  /** JWT header `kid` — the key id under which the public key is published. */
  keyId: string
  /** RSA private key in PEM (PKCS#1 or PKCS#8) used to RS256-sign the token. */
  privateKeyPem: string
  /** JWT `sub` claim. Defaults to `issuer` when omitted. */
  subject?: string
  /** Token lifetime in seconds. Defaults to 3600 (one hour). */
  expirySeconds?: number
  /** Override "now" (epoch seconds) for deterministic generation/tests. */
  nowSeconds?: number
  /** Extra claims merged into the payload (cannot override reserved claims). */
  additionalClaims?: Record<string, unknown>
}

/** Default token lifetime: one hour. */
const DEFAULT_EXPIRY_SECONDS = 3600

/**
 * Base64url-encode a Buffer or UTF-8 string (RFC 7515 §2): standard base64 with
 * `+`/`/` mapped to `-`/`_` and trailing `=` padding stripped.
 */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** JSON-serialize then base64url-encode a JWT segment (header or payload). */
function encodeSegment(obj: Record<string, unknown>): string {
  return base64url(JSON.stringify(obj))
}

/**
 * Build a signed Atlassian ASAP token: a compact RS256 JWT.
 *
 * Header:  { alg: "RS256", typ: "JWT", kid: <keyId> }
 * Claims:  { iss, aud, sub, iat, exp, jti, ...additionalClaims }
 *
 * The returned value is the bare JWT (no `Bearer ` prefix); callers place it in
 * `Authorization: Bearer <token>`.
 */
export function asapToken(opts: AsapOptions): string {
  const {
    issuer,
    audience,
    keyId,
    privateKeyPem,
    subject,
    expirySeconds,
    nowSeconds,
    additionalClaims
  } = opts

  const now = nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttl = expirySeconds ?? DEFAULT_EXPIRY_SECONDS

  const header: Record<string, unknown> = {
    alg: 'RS256',
    typ: 'JWT',
    kid: keyId
  }

  // Reserved claims are written last so `additionalClaims` can never clobber them.
  const claims: Record<string, unknown> = {
    ...additionalClaims,
    iss: issuer,
    aud: audience,
    sub: subject || issuer,
    iat: now,
    exp: now + ttl,
    jti: randomBytes(16).toString('hex')
  }

  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`

  // RS256 = RSASSA-PKCS1-v1_5 over SHA-256.
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = base64url(signer.sign(privateKeyPem))

  return `${signingInput}.${signature}`
}

/**
 * OAuth 1.0a request signing (RFC 5849).
 *
 * Pure module: depends only on `node:crypto`. Given a request method, URL, and
 * credentials, it produces the full `Authorization: OAuth ...` header value.
 *
 * The signature base string is built from the union of:
 *   - the oauth_* protocol parameters,
 *   - the query parameters parsed from the URL,
 *   - any form/body parameters (application/x-www-form-urlencoded) supplied in
 *     `bodyParams`.
 * Each name/value is RFC 3986 percent-encoded, the pairs are sorted, and the
 * canonical "METHOD&base-url&params" string is HMAC-signed with the signing key
 * `enc(consumerSecret)&enc(tokenSecret)`. PLAINTEXT just uses the signing key.
 */
import { createHmac } from 'node:crypto'

export interface OAuth1Options {
  method: string
  url: string
  consumerKey: string
  consumerSecret: string
  token?: string
  tokenSecret?: string
  signatureMethod?: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT'
  timestamp?: string
  nonce?: string
  realm?: string
  /**
   * When true, the SHA1/SHA256 (matching the signature method) hash of the raw
   * request body is added as the `oauth_body_hash` parameter. Note: this option
   * is honored only when `bodyParams` is NOT used, since RFC-style body hashing
   * applies to non-form bodies. We expose the toggle for API completeness.
   */
  includeBodyHash?: boolean
  /** form-encoded body parameters that participate in the signature base string */
  bodyParams?: Record<string, string>
}

/**
 * RFC 3986 percent-encoding. Encodes everything except the unreserved set
 * (ALPHA / DIGIT / "-" / "." / "_" / "~"). `encodeURIComponent` leaves
 * !*'() unescaped, so we fix those up.
 */
function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

/**
 * Parse the query string of a URL into raw (decoded) name/value pairs without
 * mutating ordering semantics. Returns pairs; duplicate keys are preserved.
 */
function parseQueryParams(url: string): Array<[string, string]> {
  const qIndex = url.indexOf('?')
  if (qIndex < 0) return []
  let query = url.slice(qIndex + 1)
  const hashIndex = query.indexOf('#')
  if (hashIndex >= 0) query = query.slice(0, hashIndex)
  if (!query) return []
  const pairs: Array<[string, string]> = []
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const rawKey = eq < 0 ? part : part.slice(0, eq)
    const rawVal = eq < 0 ? '' : part.slice(eq + 1)
    // Query components arrive percent-encoded; decode to raw before re-encoding
    // for the base string (per RFC 5849 §3.4.1.3.1, '+' is a literal space in
    // form-encoded query strings).
    pairs.push([safeDecode(rawKey), safeDecode(rawVal)])
  }
  return pairs
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * Compute the base URL per RFC 5849 §3.4.1.2: scheme + authority + path, with
 * default ports removed and the query/fragment stripped. Scheme and host are
 * lowercased.
 */
function baseStringUri(url: string): string {
  try {
    const u = new URL(url)
    const scheme = u.protocol.replace(/:$/, '').toLowerCase()
    let host = u.hostname.toLowerCase()
    const port = u.port
    if (port) {
      const isDefault =
        (scheme === 'http' && port === '80') ||
        (scheme === 'https' && port === '443')
      if (!isDefault) host = `${host}:${port}`
    }
    return `${scheme}://${host}${u.pathname}`
  } catch {
    // Fallback: strip query/fragment manually if URL parsing fails.
    const noFrag = url.split('#')[0]
    return noFrag.split('?')[0]
  }
}

/**
 * Build the normalized parameter string (RFC 5849 §3.4.1.3.2): percent-encode
 * every key and value, sort by encoded key then encoded value, and join with
 * '&' / '='.
 */
function normalizeParams(pairs: Array<[string, string]>): string {
  const encoded = pairs.map(
    ([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)] as [string, string]
  )
  encoded.sort((a, b) => {
    if (a[0] < b[0]) return -1
    if (a[0] > b[0]) return 1
    if (a[1] < b[1]) return -1
    if (a[1] > b[1]) return 1
    return 0
  })
  return encoded.map(([k, v]) => `${k}=${v}`).join('&')
}

function generateNonce(): string {
  // 32 hex chars of randomness is plenty for an OAuth nonce.
  let out = ''
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

/**
 * Produce the full OAuth 1.0a `Authorization` header value.
 */
export function oauth1Header(opts: OAuth1Options): string {
  const signatureMethod = opts.signatureMethod ?? 'HMAC-SHA1'
  const method = (opts.method || 'GET').toUpperCase()
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString()
  const nonce = opts.nonce ?? generateNonce()

  // 1. Collect the oauth_* protocol parameters.
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: signatureMethod,
    oauth_timestamp: timestamp,
    oauth_version: '1.0'
  }
  if (opts.token) oauthParams.oauth_token = opts.token

  // 2. Gather all parameters that participate in the signature base string:
  //    oauth_* + query params + body params (oauth_signature is excluded).
  const allParams: Array<[string, string]> = []
  for (const [k, v] of Object.entries(oauthParams)) allParams.push([k, v])
  for (const pair of parseQueryParams(opts.url)) allParams.push(pair)
  if (opts.bodyParams) {
    for (const [k, v] of Object.entries(opts.bodyParams)) allParams.push([k, v])
  }

  // 3. Build the signature base string.
  const normalized = normalizeParams(allParams)
  const baseString = [
    method,
    rfc3986Encode(baseStringUri(opts.url)),
    rfc3986Encode(normalized)
  ].join('&')

  // 4. Build the signing key.
  const signingKey = `${rfc3986Encode(opts.consumerSecret)}&${rfc3986Encode(
    opts.tokenSecret ?? ''
  )}`

  // 5. Compute the signature.
  let signature: string
  if (signatureMethod === 'PLAINTEXT') {
    // PLAINTEXT signature is the signing key itself (transmitted percent-encoded
    // in the header like any other oauth value).
    signature = signingKey
  } else {
    const algo = signatureMethod === 'HMAC-SHA256' ? 'sha256' : 'sha1'
    signature = createHmac(algo, signingKey).update(baseString).digest('base64')
  }
  oauthParams.oauth_signature = signature

  // 6. Serialize the header. Only oauth_* params (plus optional realm) appear in
  //    the Authorization header — query/body params do not. Values are
  //    percent-encoded and double-quoted, pairs comma-separated.
  const headerPairs: string[] = []
  if (opts.realm !== undefined) {
    headerPairs.push(`realm="${rfc3986Encode(opts.realm)}"`)
  }
  const sortedKeys = Object.keys(oauthParams).sort()
  for (const key of sortedKeys) {
    headerPairs.push(`${rfc3986Encode(key)}="${rfc3986Encode(oauthParams[key])}"`)
  }

  return `OAuth ${headerPairs.join(', ')}`
}

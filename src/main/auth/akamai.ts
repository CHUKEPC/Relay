/**
 * Akamai EdgeGrid authentication (per Akamai's "Authenticate with EdgeGrid" spec).
 *
 * Pure module: depends only on `node:crypto`. No electron, no undici, no fs, no
 * global state. Given a normalized request (method, url, the three EdgeGrid
 * credentials, optional headers/body), `edgeGridHeader` returns the full
 * `Authorization` header value:
 *
 *   EG1-HMAC-SHA256 client_token=..;access_token=..;timestamp=..;nonce=..;signature=..
 *
 * Algorithm (Akamai EdgeGrid signing):
 *   1. auth header WITHOUT the signature, terminated with ';':
 *        "EG1-HMAC-SHA256 client_token=..;access_token=..;timestamp=..;nonce=..;"
 *   2. signing key  = base64( HMAC-SHA256(clientSecret, timestamp) )
 *   3. content hash = base64( SHA-256(body) ) for POST/PUT (body truncated to
 *      maxBody, default 131072 bytes), otherwise the empty string
 *   4. data-to-sign = join with '\t' (tab) of, each followed by a trailing '\n':
 *        METHOD (uppercase)
 *        scheme (lowercase, e.g. "https")
 *        host   (lowercase authority incl. non-default port)
 *        relativeUrl (path + query, no leading scheme/host)
 *        canonicalizedHeaders
 *        contentHash
 *        authHeaderWithoutSig
 *      ...but the LAST field (authHeaderWithoutSig) has NO trailing newline.
 *   5. signature = base64( HMAC-SHA256(signingKey, dataToSign) )
 *   6. final header = authHeaderWithoutSig + "signature=" + signature
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'

export interface EdgeGridOptions {
  method: string
  url: string
  clientToken: string
  clientSecret: string
  accessToken: string
  /** Header names to include in the signature, in the given order. */
  headersToSign?: string[]
  /** Request headers, used together with `headersToSign`. */
  headers?: Record<string, string>
  /** Request body (only signed for POST/PUT). */
  body?: string
  /** Max body bytes to hash; bodies are truncated to this length. Default 131072. */
  maxBody?: number
  /** Override for deterministic tests; format yyyyMMdd'T'HH:mm:ss+0000. */
  timestamp?: string
  /** Override for deterministic tests; otherwise a random UUID is generated. */
  nonce?: string
}

const DEFAULT_MAX_BODY = 131072

/**
 * Format a Date as Akamai's EdgeGrid timestamp: yyyyMMdd'T'HH:mm:ss+0000 (UTC).
 * e.g. 20210101T12:00:00+0000
 */
export function edgeGridTimestamp(date: Date = new Date()): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  const yyyy = date.getUTCFullYear()
  const MM = p(date.getUTCMonth() + 1)
  const dd = p(date.getUTCDate())
  const HH = p(date.getUTCHours())
  const mm = p(date.getUTCMinutes())
  const ss = p(date.getUTCSeconds())
  return `${yyyy}${MM}${dd}T${HH}:${mm}:${ss}+0000`
}

/** RFC 4122 random nonce. Uses crypto randomness; no global state. */
function randomNonce(): string {
  return randomUUID()
}

/** base64( HMAC-SHA256(key, data) ) */
function hmacBase64(key: string | Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('base64')
}

/** base64( SHA-256(data) ) */
function sha256Base64(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('base64')
}

/**
 * Canonicalize the headers to sign, per EdgeGrid:
 *   - only headers named in `headersToSign` are included, in that order
 *   - name is lowercased
 *   - value has leading/trailing whitespace trimmed and internal runs of
 *     whitespace collapsed to a single space
 *   - each becomes "name:value" joined by '\t' (tab)
 * Missing headers are skipped. Returns '' when nothing is signed.
 */
function canonicalizeHeaders(
  headersToSign: string[] | undefined,
  headers: Record<string, string> | undefined
): string {
  if (!headersToSign || headersToSign.length === 0 || !headers) return ''

  // Build a case-insensitive lookup of the provided headers.
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v
  }

  const parts: string[] = []
  for (const name of headersToSign) {
    const key = name.toLowerCase()
    const raw = lower[key]
    if (raw === undefined) continue
    const value = raw.trim().replace(/\s+/g, ' ')
    parts.push(`${key}:${value}`)
  }
  return parts.join('\t')
}

/**
 * Compute the content hash for the request body. Only POST and PUT bodies are
 * hashed; the body is truncated to `maxBody` bytes first. Returns '' when there
 * is nothing to hash.
 */
function contentHash(method: string, body: string | undefined, maxBody: number): string {
  const m = method.toUpperCase()
  if (m !== 'POST' && m !== 'PUT') return ''
  if (!body) return ''

  // Truncate by BYTES (not characters): Akamai limits the hashed body length in
  // bytes. We use Buffer to honor multi-byte UTF-8 boundaries safely.
  const buf = Buffer.from(body, 'utf8')
  const truncated = buf.length > maxBody ? buf.subarray(0, maxBody) : buf
  return createHash('sha256').update(truncated).digest('base64')
}

/**
 * Build the Akamai EdgeGrid `Authorization` header value.
 *
 * The result is a complete header value beginning with "EG1-HMAC-SHA256 " and
 * ending with the computed "signature=..".
 */
export function edgeGridHeader(opts: EdgeGridOptions): string {
  const method = (opts.method ?? 'GET').toUpperCase()
  const timestamp = opts.timestamp ?? edgeGridTimestamp()
  const nonce = opts.nonce ?? randomNonce()
  const maxBody = opts.maxBody ?? DEFAULT_MAX_BODY

  const parsed = new URL(opts.url)
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase() // "https"
  const host = parsed.host.toLowerCase() // authority incl. non-default port
  // relativeUrl = path + query (and any leading-slash path is preserved).
  const relativeUrl = `${parsed.pathname}${parsed.search}`

  // 1. The auth header without the signature, terminated with ';'.
  const authHeaderWithoutSig =
    `EG1-HMAC-SHA256 ` +
    `client_token=${opts.clientToken};` +
    `access_token=${opts.accessToken};` +
    `timestamp=${timestamp};` +
    `nonce=${nonce};`

  // 2. Signing key derived from the client secret + timestamp.
  const signingKey = hmacBase64(opts.clientSecret, timestamp)

  // 3. Content hash (POST/PUT only).
  const cHash = contentHash(method, opts.body, maxBody)

  // 4. Data-to-sign: tab-joined fields, each line terminated by '\n' EXCEPT the
  //    last (authHeaderWithoutSig). Akamai's reference builds this as a list of
  //    "field\t" segments followed by a single '\n' between segments; the net
  //    serialization is each field followed by '\n', except the trailing one.
  const canonicalHeaders = canonicalizeHeaders(opts.headersToSign, opts.headers)
  const dataToSign =
    `${method}\t` +
    `${scheme}\t` +
    `${host}\t` +
    `${relativeUrl}\t` +
    `${canonicalHeaders}\t` +
    `${cHash}\t` +
    `${authHeaderWithoutSig}`

  // 5. Signature over the data using the derived signing key.
  const signature = hmacBase64(signingKey, dataToSign)

  // 6. Append "signature=..".
  return `${authHeaderWithoutSig}signature=${signature}`
}

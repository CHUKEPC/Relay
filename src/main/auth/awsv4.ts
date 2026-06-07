/**
 * AWS Signature Version 4 — header-based signing.
 *
 * Pure module: depends only on `node:crypto`. No electron, no undici, no fs, no
 * global state. The HTTP engine calls `signAwsV4` with the request it is about to
 * send and merges the returned headers into the outgoing request.
 *
 * Reference: AWS "Signing AWS API requests" (Signature Version 4). The signing
 * pipeline is:
 *   1. Canonical request  = method \n canonicalUri \n canonicalQuery \n
 *                            canonicalHeaders \n signedHeaders \n hashedPayload
 *   2. String to sign     = "AWS4-HMAC-SHA256" \n datetime \n scope \n
 *                            sha256hex(canonicalRequest)
 *   3. Signing key        = HMAC chain over (secret -> date -> region -> service ->
 *                            "aws4_request")
 *   4. Signature          = HMAC-SHA256(signingKey, stringToSign) as hex
 *   5. Authorization      = "AWS4-HMAC-SHA256 Credential=.../scope,
 *                            SignedHeaders=...,Signature=..."
 */
import { createHash, createHmac } from 'node:crypto'

export interface AwsV4Options {
  method: string
  url: string
  headers: Record<string, string>
  body?: string | Buffer
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  service: string
  /** Override the signing time, formatted as YYYYMMDDTHHMMSSZ. */
  datetime?: string
  /** Sign with UNSIGNED-PAYLOAD when the body can't be hashed (e.g. multipart). */
  unsignedPayload?: boolean
}

const ALGORITHM = 'AWS4-HMAC-SHA256'

/** sha256 of `data`, lowercase hex. */
function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** HMAC-SHA256(key, data), raw bytes. */
function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** Current UTC time as YYYYMMDDTHHMMSSZ (used when `datetime` is not supplied). */
function defaultDatetime(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * URI-encode per RFC 3986 as AWS expects. Unreserved characters
 * (A-Z a-z 0-9 - _ . ~) are left as-is; everything else is percent-encoded with
 * uppercase hex. `encodeURIComponent` is the base but it leaves !*'() unescaped,
 * so we encode those too.
 */
function uriEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

/**
 * Build the canonical URI: the URL path, percent-encoded segment-by-segment
 * (so "/" separators survive), normalized to "/" when empty.
 */
function canonicalUri(pathname: string): string {
  if (!pathname || pathname === '') return '/'
  return pathname
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/')
}

/**
 * Build the canonical query string: parameters sorted by encoded key (ties broken
 * by encoded value), each `key=value` with both sides URI-encoded.
 */
function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = []
  for (const [key, value] of searchParams.entries()) {
    pairs.push([uriEncode(key), uriEncode(value)])
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

/**
 * Sign an AWS request with SigV4 (header-based) and return the headers to ADD:
 *   - Authorization
 *   - X-Amz-Date
 *   - X-Amz-Security-Token  (only when a sessionToken is provided)
 *   - X-Amz-Content-Sha256  (only when included in the signed headers — see below)
 *
 * We sign exactly the caller-supplied headers (lowercased + trimmed) plus the
 * `x-amz-date` we set here, and `x-amz-security-token` when present. We do NOT add
 * `x-amz-content-sha256` to the signed set by default (it is optional for many
 * services), so it is omitted from the returned headers unless the caller already
 * passed it in `headers` — in which case it is signed and echoed back.
 */
export function signAwsV4(opts: AwsV4Options): Record<string, string> {
  const {
    method,
    url,
    headers,
    body,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    region,
    service
  } = opts

  const datetime = opts.datetime ?? defaultDatetime()
  const date = datetime.slice(0, 8) // YYYYMMDD

  const parsed = new URL(url)

  // Collect the headers to sign. Names are lowercased and values trimmed
  // (internal runs of whitespace are also collapsed, per the spec).
  const signing: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue
    const key = name.toLowerCase().trim()
    signing[key] = String(value).trim().replace(/\s+/g, ' ')
  }

  // Ensure a host header exists; if the caller omitted it, derive from the URL.
  if (!signing['host']) {
    signing['host'] = parsed.host
  }

  // x-amz-date is always part of the signature.
  signing['x-amz-date'] = datetime

  // x-amz-security-token is signed when a session token is in play.
  if (sessionToken) {
    signing['x-amz-security-token'] = sessionToken
  }

  // For an unhashable body (multipart/form-data, whose bytes undici generates
  // internally), use UNSIGNED-PAYLOAD so the signature is valid without hashing
  // the body; the marker must also be a signed header.
  const payloadHash = opts.unsignedPayload ? 'UNSIGNED-PAYLOAD' : sha256Hex(body ?? '')
  if (opts.unsignedPayload) signing['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD'

  // Sorted, lowercased header names form the SignedHeaders list.
  const sortedHeaderNames = Object.keys(signing).sort()
  const signedHeaders = sortedHeaderNames.join(';')

  const canonicalHeaders =
    sortedHeaderNames.map((name) => `${name}:${signing[name]}`).join('\n') + '\n'

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(parsed.pathname),
    canonicalQuery(parsed.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const scope = `${date}/${region}/${service}/aws4_request`

  const stringToSign = [ALGORITHM, datetime, scope, sha256Hex(canonicalRequest)].join('\n')

  // Derive the signing key: secret -> date -> region -> service -> "aws4_request".
  const kDate = hmac(`AWS4${secretAccessKey}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')

  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization =
    `${ALGORITHM} ` +
    `Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`

  // Headers to add to the outgoing request.
  const result: Record<string, string> = {
    Authorization: authorization,
    'X-Amz-Date': datetime
  }
  if (sessionToken) {
    result['X-Amz-Security-Token'] = sessionToken
  }
  // Only surface x-amz-content-sha256 when it was part of what we signed.
  if (signing['x-amz-content-sha256'] !== undefined) {
    result['X-Amz-Content-Sha256'] = signing['x-amz-content-sha256']
  }

  return result
}

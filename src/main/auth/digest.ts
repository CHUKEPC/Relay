/**
 * HTTP Digest Access Authentication (RFC 7616, back-compatible with RFC 2617 / 2069).
 *
 * Pure module: depends only on `node:crypto`. No electron, no undici, no fs, no
 * global state. The HTTP engine drives the challenge/response flow:
 *   1. send the request, get a 401 with `WWW-Authenticate: Digest ...`
 *   2. `parseDigestChallenge` the header
 *   3. `buildDigestAuthHeader` and replay the request with `Authorization`
 *
 * We implement qop="auth" (and legacy no-qop RFC 2069) plus qop="auth-int".
 * Supported algorithms: MD5, SHA-256, and their -sess variants.
 */
import { createHash, randomBytes } from 'node:crypto'

export interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string // e.g. "auth" or "auth,auth-int" — we only honor "auth"/"auth-int"
  opaque?: string
  algorithm?: string // "MD5" | "SHA-256" | "MD5-sess" | "SHA-256-sess" (default MD5)
  domain?: string
  stale?: boolean
}

export interface DigestAuthInput {
  username: string
  password: string
  method: string // HTTP method, e.g. "GET"
  uri: string // request-target: path + query (e.g. "/dir/index.html")
  challenge: DigestChallenge
  /** override for deterministic tests; otherwise a random hex cnonce is generated */
  cnonce?: string
  /** nonce count, defaults to 1 → formatted as 8 hex digits "00000001" */
  nc?: number
  /** body, only needed for qop=auth-int (optional; we primarily support qop=auth) */
  entityBody?: string
}

/**
 * Split a comma-separated parameter list while respecting double-quoted values.
 * RFC 7616 allows commas inside quoted strings (e.g. qop="auth,auth-int" or a
 * realm/nonce that happens to contain a comma), so a naive `split(',')` is wrong.
 */
function splitParams(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      // Honor backslash-escaped quotes inside a quoted-string (RFC 7230 quoted-pair).
      const prev = raw[i - 1]
      if (!(inQuotes && prev === '\\')) inQuotes = !inQuotes
      current += ch
    } else if (ch === ',' && !inQuotes) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** Strip surrounding double quotes and unescape quoted-pairs (\" and \\). */
function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return v
}

/**
 * Parse a `WWW-Authenticate` header value. Returns null when it is not a Digest
 * challenge (or is malformed: missing realm or nonce).
 *
 * Tolerates other schemes sharing the header (e.g. `Basic realm="x", Digest ...`)
 * by locating the `Digest` token (case-insensitive) and parsing the params that
 * follow it. Values may be quoted or unquoted.
 */
export function parseDigestChallenge(headerValue: string): DigestChallenge | null {
  if (!headerValue) return null

  // Find the "Digest" scheme token. It must be a standalone token (start of the
  // header or preceded by a comma/whitespace, and followed by whitespace), so we
  // don't false-match a substring inside another scheme's parameter value.
  const schemeRegex = /(?:^|[,\s])Digest\s+/i
  const match = schemeRegex.exec(headerValue)
  if (!match) return null

  const paramsBlob = headerValue.slice(match.index + match[0].length)

  const params: Record<string, string> = {}
  for (const segment of splitParams(paramsBlob)) {
    const eq = segment.indexOf('=')
    if (eq === -1) continue
    const key = segment.slice(0, eq).trim().toLowerCase()
    const rawVal = segment.slice(eq + 1)
    if (!key) continue
    // Stop if we accidentally walked into the next auth scheme's token (a bare
    // word with no '=' would have been skipped above; a scheme like
    // "Negotiate" followed by base64 is its own segment without '=').
    params[key] = unquote(rawVal)
  }

  if (!params.realm || !params.nonce) return null

  const challenge: DigestChallenge = {
    realm: params.realm,
    nonce: params.nonce
  }
  if (params.qop !== undefined) challenge.qop = params.qop
  if (params.opaque !== undefined) challenge.opaque = params.opaque
  if (params.algorithm !== undefined) challenge.algorithm = params.algorithm
  if (params.domain !== undefined) challenge.domain = params.domain
  if (params.stale !== undefined) challenge.stale = /^true$/i.test(params.stale.trim())

  return challenge
}

/** Map a Digest `algorithm` token to the crypto hash name and -sess flag. */
function resolveAlgorithm(algorithm?: string): {
  hashName: 'md5' | 'sha256'
  sess: boolean
  /** Canonical token to echo back in the Authorization header. */
  token: 'MD5' | 'SHA-256' | 'MD5-sess' | 'SHA-256-sess'
} {
  const raw = (algorithm ?? 'MD5').trim()
  const sess = /-sess$/i.test(raw)
  const base = raw.replace(/-sess$/i, '').toUpperCase()

  // RFC 7616 registers SHA-256 and SHA-512-256; we support MD5 and SHA-256.
  // SHA-512-256 maps to Node's 'sha512-256' if/when needed, but per scope we
  // restrict to MD5 / SHA-256 and fall back to MD5 for anything unrecognized.
  let hashName: 'md5' | 'sha256' = 'md5'
  let canonicalBase: 'MD5' | 'SHA-256' = 'MD5'
  if (base === 'SHA-256' || base === 'SHA256') {
    hashName = 'sha256'
    canonicalBase = 'SHA-256'
  }

  const token = (sess ? `${canonicalBase}-sess` : canonicalBase) as
    | 'MD5'
    | 'SHA-256'
    | 'MD5-sess'
    | 'SHA-256-sess'
  return { hashName, sess, token }
}

/** Format the nonce count as 8 lowercase hex digits, e.g. 1 → "00000001". */
function formatNc(nc: number): string {
  const n = Number.isFinite(nc) && nc > 0 ? Math.floor(nc) : 1
  return (n >>> 0).toString(16).padStart(8, '0')
}

/**
 * Pick the qop to use from a (possibly comma-separated, possibly quoted) server
 * qop list. We prefer "auth"; we accept "auth-int" only if it is the sole offer
 * and a body is available. Returns undefined for legacy no-qop mode.
 */
function selectQop(qop: string | undefined, hasBody: boolean): 'auth' | 'auth-int' | undefined {
  if (!qop) return undefined
  const offered = qop
    .split(',')
    .map((q) => unquote(q).trim().toLowerCase())
    .filter(Boolean)
  if (offered.includes('auth')) return 'auth'
  // auth-int is only usable when we actually have the entity body to hash;
  // otherwise (multipart/binary body we can't hash) fall back to legacy no-qop
  // rather than sending a wrong body hash the server will reject.
  if (offered.includes('auth-int') && hasBody) return 'auth-int'
  // Unknown qop tokens only, or auth-int with no body → RFC 2069 fallback.
  return undefined
}

/** Quote and escape a string for use as a Digest quoted-string parameter value. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Build the full `Authorization` header value, including the leading "Digest ".
 *
 * Throws only for programmer errors (missing realm/nonce on the challenge); all
 * supported challenges produce a deterministic header given a fixed cnonce/nc.
 */
export function buildDigestAuthHeader(input: DigestAuthInput): string {
  const { username, password, method, uri, challenge } = input
  if (!challenge || !challenge.realm || !challenge.nonce) {
    throw new Error('buildDigestAuthHeader: challenge requires realm and nonce')
  }

  const { hashName, sess, token } = resolveAlgorithm(challenge.algorithm)
  const h = (data: string): string => createHash(hashName).update(data, 'utf8').digest('hex')

  const cnonce = input.cnonce ?? randomBytes(16).toString('hex')
  const nc = formatNc(input.nc ?? 1)
  const qop = selectQop(challenge.qop, input.entityBody !== undefined)

  // HA1 = H(username:realm:password); -sess folds in nonce + cnonce.
  let ha1 = h(`${username}:${challenge.realm}:${password}`)
  if (sess) {
    ha1 = h(`${ha1}:${challenge.nonce}:${cnonce}`)
  }

  // HA2 = H(method:uri); for qop=auth-int it also hashes the entity body.
  let ha2: string
  if (qop === 'auth-int') {
    const bodyHash = h(input.entityBody ?? '')
    ha2 = h(`${method}:${uri}:${bodyHash}`)
  } else {
    ha2 = h(`${method}:${uri}`)
  }

  // response: with qop → H(HA1:nonce:nc:cnonce:qop:HA2); legacy → H(HA1:nonce:HA2).
  let response: string
  if (qop) {
    response = h(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
  } else {
    response = h(`${ha1}:${challenge.nonce}:${ha2}`)
  }

  // Assemble parameters. Quote string params; leave algorithm/qop/nc as tokens.
  const params: string[] = [
    `username=${quote(username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`
  ]

  // Echo algorithm only when the server specified one (RFC 7616 §3.4).
  if (challenge.algorithm !== undefined) {
    params.push(`algorithm=${token}`)
  }

  if (qop) {
    params.push(`qop=${qop}`)
    params.push(`nc=${nc}`)
    params.push(`cnonce=${quote(cnonce)}`)
  }

  params.push(`response=${quote(response)}`)

  if (challenge.opaque !== undefined) {
    params.push(`opaque=${quote(challenge.opaque)}`)
  }

  return `Digest ${params.join(', ')}`
}

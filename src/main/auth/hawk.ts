/**
 * Hawk (HTTP Holder-Of-Key) request authorization.
 *
 * Hawk is an HTTP authentication scheme using a MAC algorithm to provide partial
 * cryptographic verification of HTTP requests. This module builds the value for the
 * `Authorization` header that a client sends with a request.
 *
 * Pure module: depends only on `node:crypto`. No electron, no undici, no fs, no
 * global state.
 *
 * The normalized request string that is MAC'd has the canonical Hawk layout:
 *
 *   hawk.1.header\n
 *   {timestamp}\n
 *   {nonce}\n
 *   {METHOD}\n
 *   {path + query}\n
 *   {host}\n
 *   {port}\n
 *   {payload-hash or ""}\n
 *   {ext or ""}\n
 *
 * When `app` (and optionally `dlg`) is supplied (Oz delegation), two extra lines are
 * appended after `ext`:
 *
 *   {app}\n
 *   {dlg or ""}\n
 *
 * If a payload is provided, the payload hash is computed over its own normalized form:
 *
 *   hawk.1.payload\n
 *   {content-type}\n
 *   {payload}\n
 *
 * Reference: https://github.com/hueniverse/hawk
 */
import { createHash, createHmac } from 'node:crypto'

export interface HawkOptions {
  /** HTTP method, e.g. "GET" (case-insensitive; normalized to upper-case). */
  method: string
  /** Full request URL, e.g. "http://example.com:8000/resource/1?b=1&a=2". */
  url: string
  /** Hawk credentials id. */
  id: string
  /** Hawk credentials key (the shared secret). */
  key: string
  /** MAC algorithm; defaults to "sha256". */
  algorithm?: 'sha256' | 'sha1'
  /** UNIX timestamp in seconds; defaults to the current time. */
  timestamp?: number
  /** Per-request nonce; defaults to a random value. */
  nonce?: string
  /** Optional application-specific "ext" data. */
  ext?: string
  /** Request body; when supplied, a payload hash is computed and included. */
  payload?: string
  /** Content-Type for the payload hash (lower-cased, parameters stripped). */
  contentType?: string
  /** Oz application id (optional delegation extension). */
  app?: string
  /** Oz delegated-by id (optional; only meaningful together with `app`). */
  dlg?: string
}

/** Map our public algorithm names to Node's digest names. */
function nodeAlgorithm(algorithm: 'sha256' | 'sha1'): string {
  return algorithm === 'sha1' ? 'sha1' : 'sha256'
}

/**
 * Default port resolution per scheme, matching Hawk: http → 80, https → 443,
 * with an explicit port in the URL always taking precedence.
 */
function resolvePort(parsed: URL): string {
  if (parsed.port) return parsed.port
  return parsed.protocol === 'https:' ? '443' : '80'
}

/**
 * Normalize a Content-Type to just the media type, lower-cased, with any
 * parameters (e.g. "; charset=utf-8") removed — this is what Hawk hashes.
 */
function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

/**
 * Compute the base64 payload hash for request body integrity.
 * Hash is over: "hawk.1.payload\n" + contentType + "\n" + payload + "\n".
 */
export function calculatePayloadHash(
  algorithm: 'sha256' | 'sha1',
  payload: string,
  contentType: string
): string {
  const hash = createHash(nodeAlgorithm(algorithm))
  hash.update('hawk.1.payload\n')
  hash.update(`${normalizeContentType(contentType)}\n`)
  hash.update(`${payload}\n`)
  return hash.digest('base64')
}

/** Build the canonical, newline-delimited normalized request string for the MAC. */
function normalizeString(
  opts: Required<Pick<HawkOptions, 'method' | 'id' | 'key'>> & {
    ts: number
    nonce: string
    path: string
    host: string
    port: string
    hash: string
    ext: string
    app: string
    dlg: string
  }
): string {
  let normalized =
    'hawk.1.header\n' +
    `${opts.ts}\n` +
    `${opts.nonce}\n` +
    `${opts.method}\n` +
    `${opts.path}\n` +
    `${opts.host}\n` +
    `${opts.port}\n` +
    `${opts.hash}\n` +
    `${opts.ext}\n`

  // Oz delegation extension: only present when an application id is given.
  if (opts.app) {
    normalized += `${opts.app}\n` + `${opts.dlg}\n`
  }

  return normalized
}

/**
 * Escape a value for inclusion inside a Hawk header attribute. Hawk attribute
 * values are double-quoted; backslashes and double quotes must be escaped so the
 * server can parse the header unambiguously.
 */
function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Build the full `Authorization` header value for a Hawk-authenticated request,
 * e.g. `Hawk id="dh37fgj492je", ts="1353832234", nonce="j4h3g2", mac="..."`.
 */
export function hawkHeader(opts: HawkOptions): string {
  if (!opts.id) throw new Error('hawkHeader: "id" is required')
  if (!opts.key) throw new Error('hawkHeader: "key" is required')
  if (!opts.method) throw new Error('hawkHeader: "method" is required')
  if (!opts.url) throw new Error('hawkHeader: "url" is required')

  const algorithm: 'sha256' | 'sha1' = opts.algorithm ?? 'sha256'
  const method = opts.method.toUpperCase()

  let parsed: URL
  try {
    parsed = new URL(opts.url)
  } catch {
    throw new Error(`hawkHeader: invalid url "${opts.url}"`)
  }

  // Request-target: path + query (path is always present, query may be empty).
  const path = `${parsed.pathname}${parsed.search}`
  const host = parsed.hostname.toLowerCase()
  const port = resolvePort(parsed)

  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const nonce = opts.nonce ?? randomNonce()
  const ext = opts.ext ?? ''
  const app = opts.app ?? ''
  const dlg = opts.dlg ?? ''

  // Optional payload hash for request-body integrity.
  let hash = ''
  if (opts.payload !== undefined) {
    hash = calculatePayloadHash(algorithm, opts.payload, opts.contentType ?? '')
  }

  const normalized = normalizeString({
    method,
    id: opts.id,
    key: opts.key,
    ts,
    nonce,
    path,
    host,
    port,
    hash,
    ext,
    app,
    dlg,
  })

  const mac = createHmac(nodeAlgorithm(algorithm), opts.key).update(normalized).digest('base64')

  // Assemble the header. Order follows the Hawk reference output.
  const attributes: string[] = [
    `id="${escapeAttribute(opts.id)}"`,
    `ts="${ts}"`,
    `nonce="${escapeAttribute(nonce)}"`,
  ]
  if (hash) attributes.push(`hash="${escapeAttribute(hash)}"`)
  if (ext) attributes.push(`ext="${escapeAttribute(ext)}"`)
  attributes.push(`mac="${escapeAttribute(mac)}"`)
  if (app) {
    attributes.push(`app="${escapeAttribute(app)}"`)
    if (dlg) attributes.push(`dlg="${escapeAttribute(dlg)}"`)
  }

  return `Hawk ${attributes.join(', ')}`
}

/**
 * Generate a short, URL-safe random nonce. Used only when the caller does not
 * supply an explicit nonce. Uses `node:crypto` to stay within the pure-module
 * dependency budget.
 */
function randomNonce(): string {
  // 6 base64url characters of randomness, matching Hawk's default nonce length.
  return createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
}

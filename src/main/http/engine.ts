/**
 * Relay HTTP request engine — pure, testable core (NO electron imports).
 *
 * `runRequest(spec, opts)` takes a fully variable-interpolated RequestSpec and
 * returns a normalized ResponseResult. It never throws: transport failures are
 * mapped to a structured `HttpError` and returned on the result.
 *
 * Runs in the Electron main process (Node) where there is no CORS. Uses undici
 * for fine-grained control over redirects (recorded manually), TLS verification,
 * timing (start -> TTFB -> end) and cancellation.
 */
import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { gunzipSync, brotliDecompressSync, inflateSync, inflateRawSync } from 'node:zlib'
import { request as undiciRequest, Agent } from 'undici'
import type { Dispatcher } from 'undici'
import { Cookie } from 'tough-cookie'

import { RAW_LANGUAGE_CONTENT_TYPE } from '@shared/constants'
import type {
  Auth,
  HttpError,
  HttpErrorKind,
  KV,
  RedirectHop,
  RequestBody,
  RequestSpec,
  ResponseCookie,
  ResponseResult,
  RunOptions
} from '@shared/types'

/* ============================================================
 * Constants
 * ============================================================ */

/** Hard cap so a misconfigured maxRedirects can never loop forever. */
const ABSOLUTE_MAX_REDIRECTS = 50

/** HTTP status codes that represent a redirect. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** User headers that may carry credentials — stripped on cross-origin redirects. */
const CREDENTIAL_HEADER_RE = /(authorization|api[-_]?key|token|secret|credential|password|auth|cookie)/i

/**
 * Content-type fragments we treat as text (decoded to `text`). Anything else is
 * exposed as base64 with `isBinary: true`.
 */
const TEXTY_CONTENT_TYPE_RE =
  /(?:json|text\/|xml|html|javascript|ecmascript|csv|x-www-form-urlencoded|\+xml|\+json|svg|x-ndjson|graphql)/i

/* ============================================================
 * Pure helpers (exported for unit testing without network)
 * ============================================================ */

/**
 * Merge enabled `query` KV pairs into the URL's search params. Params already
 * present in the URL string are preserved; engine-added params are appended
 * (duplicates are allowed, matching how Postman sends repeated keys).
 *
 * Returns the absolute URL string. Throws only for an unparseable URL — callers
 * inside runRequest translate that into a `protocol` error.
 */
export function buildUrl(url: string, query: KV[]): string {
  const u = new URL(url)
  for (const kv of query) {
    if (!kv || kv.enabled === false) continue
    if (!kv.key) continue
    u.searchParams.append(kv.key, kv.value ?? '')
  }
  return u.toString()
}

/**
 * Compute the headers contributed by the auth config. Values are assumed to be
 * already interpolated. Returns a plain object of header name -> value plus an
 * optional query param (for API keys placed in the query string).
 *
 * Auth is applied LAST by the caller so it overrides user headers of the same
 * name (e.g. an explicit Authorization wins via the auth tab, as in Postman).
 */
export function buildAuthHeaders(auth: Auth | undefined): {
  headers: Record<string, string>
  query?: { key: string; value: string }
} {
  if (!auth) return { headers: {} }

  switch (auth.type) {
    case 'none':
    case 'inherit':
      // Inheritance is resolved upstream; by the time the spec reaches the
      // engine an `inherit` auth means "no explicit auth".
      return { headers: {} }

    case 'bearer': {
      if (!auth.token) return { headers: {} }
      return { headers: { Authorization: `Bearer ${auth.token}` } }
    }

    case 'basic': {
      const raw = `${auth.username ?? ''}:${auth.password ?? ''}`
      const encoded = Buffer.from(raw, 'utf8').toString('base64')
      return { headers: { Authorization: `Basic ${encoded}` } }
    }

    case 'apikey': {
      if (!auth.key) return { headers: {} }
      if (auth.addTo === 'query') {
        return { headers: {}, query: { key: auth.key, value: auth.value ?? '' } }
      }
      return { headers: { [auth.key]: auth.value ?? '' } }
    }

    case 'oauth2': {
      // Token acquisition (the grant flows) happens out-of-band; the engine
      // just attaches whatever access token it was given.
      if (!auth.accessToken) return { headers: {} }
      const prefix = auth.headerPrefix && auth.headerPrefix.trim() ? auth.headerPrefix.trim() : 'Bearer'
      return { headers: { Authorization: `${prefix} ${auth.accessToken}` } }
    }

    case 'digest': {
      // TODO(P1): full RFC 7616 digest requires a challenge/response round-trip
      // (read WWW-Authenticate, hash with nonce/cnonce/qop). For now we attach a
      // best-effort Basic credential so the request is at least authenticated on
      // servers that also accept Basic; never crash.
      const raw = `${auth.username ?? ''}:${auth.password ?? ''}`
      const encoded = Buffer.from(raw, 'utf8').toString('base64')
      return { headers: { Authorization: `Basic ${encoded}` } }
    }

    default:
      return { headers: {} }
  }
}

/** Safely parse GraphQL variables; invalid JSON degrades to `{}`. */
function parseGraphqlVariables(variables: string | undefined): unknown {
  if (!variables || !variables.trim()) return {}
  try {
    return JSON.parse(variables)
  } catch {
    return {}
  }
}

/** Case-insensitive lookup of a header value from a plain record. */
function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k]
  }
  return undefined
}

/** Case-insensitive header set (replaces any existing casing of `name`). */
function setHeaderCI(headers: Record<string, string>, name: string, value: string): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) {
      headers[k] = value
      return
    }
  }
  headers[name] = value
}

/** Case-insensitive header delete (removes every casing of `name`). */
function deleteHeaderCI(headers: Record<string, string>, name: string): void {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) delete headers[k]
  }
}

/** Same scheme + host (origin) — used to decide whether to forward credentials. */
function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.protocol === ub.protocol && ua.host === ub.host
  } catch {
    return false
  }
}

/** Accumulate Set-Cookie values (name=value) into a simple per-request jar. */
function addSetCookies(jar: Map<string, string>, lines: string[]): void {
  for (const line of lines) {
    const c = Cookie.parse(line)
    if (c && c.key) jar.set(c.key, c.value)
  }
}

/** Serialize the jar into a Cookie request header value. */
function jarHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Decompress a response body per Content-Encoding. `undici.request` does NOT
 * auto-decode, so without this gzip/br/deflate bodies would be returned as raw
 * compressed bytes (garbage text + wrong size).
 *
 * Returns `decoded: true` ONLY when every listed encoding was fully removed; on
 * an unknown encoding or a decode failure it returns the ORIGINAL bytes with
 * `decoded: false`, so the caller leaves Content-Encoding/Length headers intact
 * and body/headers stay consistent (never a half-decoded body with stripped
 * headers).
 */
function decodeContentEncoding(buf: Buffer, encoding: string | undefined): { buf: Buffer; decoded: boolean } {
  if (!encoding || buf.length === 0) return { buf, decoded: false }
  // A comma-separated list applies encodings in order; decode in reverse.
  const encodings = encoding
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  let out = buf
  for (let i = encodings.length - 1; i >= 0; i--) {
    const enc = encodings[i]
    try {
      if (enc === 'gzip' || enc === 'x-gzip') out = gunzipSync(out)
      else if (enc === 'br') out = brotliDecompressSync(out)
      else if (enc === 'deflate') {
        try {
          out = inflateSync(out)
        } catch {
          out = inflateRawSync(out)
        }
      } else if (enc === 'identity') {
        /* no-op */
      } else {
        return { buf, decoded: false } // unknown encoding — return original untouched
      }
    } catch {
      return { buf, decoded: false } // corrupt/partial data — return original untouched
    }
  }
  return { buf: out, decoded: out !== buf }
}

/**
 * Encoded request body plus the content-type the engine wants to set.
 *
 * - `contentType: undefined` means "do not set a Content-Type" (the no-body
 *   case, or formdata where undici must set the multipart boundary itself).
 * - `body: undefined` means no payload.
 */
export interface EncodedBody {
  body: string | Buffer | FormData | undefined
  /** Content-Type to apply, or undefined to leave header handling to caller/runtime. */
  contentType?: string
}

/**
 * Encode a RequestBody into something undici can send. `headers` is the set of
 * already-applied (enabled, user) headers so we can avoid overriding a
 * Content-Type the user set explicitly.
 *
 * File reads (`formdata` file fields, `binary`) are async, hence the Promise.
 */
export async function encodeBody(body: RequestBody | undefined, headers: Record<string, string>): Promise<EncodedBody> {
  if (!body || body.type === 'none') return { body: undefined }

  const userContentType = findHeader(headers, 'content-type')

  switch (body.type) {
    case 'raw': {
      const text = body.text ?? ''
      const contentType = userContentType ?? RAW_LANGUAGE_CONTENT_TYPE[body.language] ?? 'text/plain'
      return { body: text, contentType }
    }

    case 'urlencoded': {
      const params = new URLSearchParams()
      for (const kv of body.items ?? []) {
        if (!kv || kv.enabled === false || !kv.key) continue
        params.append(kv.key, kv.value ?? '')
      }
      // A user-set content-type wins, but the encoded shape is still urlencoded.
      const contentType = userContentType ?? 'application/x-www-form-urlencoded'
      return { body: params.toString(), contentType }
    }

    case 'formdata': {
      const form = new FormData()
      for (const field of body.items ?? []) {
        if (!field || field.enabled === false || !field.key) continue
        if (field.type === 'file') {
          if (!field.filePath) continue
          const buf = await readFile(field.filePath)
          const fileName = field.fileName || basename(field.filePath)
          const blob = field.contentType
            ? new Blob([buf], { type: field.contentType })
            : new Blob([buf])
          form.append(field.key, blob, fileName)
        } else {
          form.append(field.key, field.value ?? '')
        }
      }
      // IMPORTANT: do NOT set Content-Type for multipart — undici computes the
      // boundary from the FormData instance. Returning undefined signals that.
      return { body: form, contentType: undefined }
    }

    case 'binary': {
      const filePath = body.filePath
      if (!filePath) return { body: undefined }
      const buf = await readFile(filePath)
      const contentType = body.contentType ?? userContentType ?? 'application/octet-stream'
      return { body: buf, contentType }
    }

    case 'graphql': {
      const payload = JSON.stringify({
        query: body.query ?? '',
        variables: parseGraphqlVariables(body.variables)
      })
      const contentType = userContentType ?? 'application/json'
      return { body: payload, contentType }
    }

    default:
      return { body: undefined }
  }
}

/* ============================================================
 * Header / cookie normalization
 * ============================================================ */

/**
 * Collect enabled user headers into a plain record (last value wins for
 * duplicate names). Header names are kept as the user typed them.
 */
function collectUserHeaders(headers: KV[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const kv of headers ?? []) {
    if (!kv || kv.enabled === false || !kv.key) continue
    out[kv.key] = kv.value ?? ''
  }
  return out
}

/** Normalize undici's IncomingHttpHeaders into a [name, value][] array. */
function normalizeResponseHeaders(raw: Record<string, string | string[] | undefined>): [string, string][] {
  const out: [string, string][] = []
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) out.push([key, v])
    } else {
      out.push([key, value])
    }
  }
  return out
}

/** Extract the raw Set-Cookie header values (undici always gives an array form). */
function extractSetCookie(raw: Record<string, string | string[] | undefined>): string[] {
  const value = raw['set-cookie'] ?? raw['Set-Cookie']
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Parse Set-Cookie strings into structured ResponseCookie entries. */
function parseCookies(setCookie: string[]): ResponseCookie[] {
  const out: ResponseCookie[] = []
  for (const line of setCookie) {
    const parsed = Cookie.parse(line)
    if (!parsed) continue
    out.push({
      name: parsed.key,
      value: parsed.value,
      domain: parsed.domain ?? undefined,
      path: parsed.path ?? undefined,
      expires:
        parsed.expires && parsed.expires !== 'Infinity'
          ? (parsed.expires as Date).toISOString()
          : undefined,
      httpOnly: parsed.httpOnly || undefined,
      secure: parsed.secure || undefined,
      sameSite: parsed.sameSite ?? undefined
    })
  }
  return out
}

/* ============================================================
 * Error mapping
 * ============================================================ */

interface ErrnoLike {
  code?: string
  name?: string
  message?: string
  cause?: unknown
}

/** Walk `.cause` chain collecting code/name/message to classify the failure. */
function classifyError(err: unknown): HttpError {
  let node: unknown = err
  let depth = 0
  const codes: string[] = []
  let lastName = ''
  let lastMessage = ''

  while (node && depth < 6) {
    const e = node as ErrnoLike
    if (e.code) codes.push(e.code)
    if (e.name) lastName = e.name
    if (e.message) lastMessage = e.message
    node = e.cause
    depth++
  }

  const codeStr = codes.join(' ')
  const upper = `${codeStr} ${lastName} ${lastMessage}`.toUpperCase()
  let kind: HttpErrorKind = 'unknown'

  if (/ENOTFOUND|EAI_AGAIN|ENODATA|EAI_FAIL/.test(upper)) {
    kind = 'dns'
  } else if (
    /CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS|UNABLE_TO_GET_ISSUER_CERT/.test(
      upper
    )
  ) {
    kind = 'tls'
  } else if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|ECONNABORTED|UND_ERR_SOCKET/.test(upper)) {
    kind = 'connect'
  } else if (/UND_ERR_HEADERS_OVERFLOW|UND_ERR_RESPONSE|HPE_|ERR_INVALID_HTTP/.test(upper)) {
    kind = 'protocol'
  }

  return {
    kind,
    message: lastMessage || lastName || codeStr || 'Unknown request error',
    code: codes[0]
  }
}

/* ============================================================
 * The engine
 * ============================================================ */

/** A response with no usable body — used as the body field on transport errors. */
function emptyBody(): ResponseResult['body'] {
  return { contentType: '', isBinary: false, sizeBytes: 0 }
}

/** Build the failed ResponseResult for a transport-level error. */
function errorResult(error: HttpError, startedAt: number, finalUrl: string, redirects: RedirectHop[]): ResponseResult {
  return {
    ok: false,
    status: 0,
    statusText: '',
    headers: [],
    cookies: [],
    body: emptyBody(),
    timings: { startedAt, totalMs: Math.max(0, Date.now() - startedAt) },
    redirects,
    finalUrl,
    error
  }
}

/**
 * Run a fully-resolved request and return a normalized result. Never throws.
 *
 * @param spec            request, with all `{{vars}}` already interpolated
 * @param opts            run options (requestId used for cancellation upstream)
 * @param externalSignal  optional signal from the IPC layer's AbortController;
 *                        aborting it cancels the in-flight request. Kept as a
 *                        function parameter (not on RunOptions) so the shared
 *                        type stays UI-friendly and the engine stays pure.
 */
export async function runRequest(
  spec: RequestSpec,
  opts: RunOptions,
  externalSignal?: AbortSignal
): Promise<ResponseResult> {
  const startedAt = Date.now()
  void opts // requestId is used by the IPC layer; engine keeps the signature stable.

  // --- 1. Build the target URL (merge query params). ---
  let initialUrl: string
  try {
    initialUrl = buildUrl(spec.url, spec.query ?? [])
  } catch (err) {
    return errorResult(
      { kind: 'protocol', message: `Invalid URL: ${(err as Error).message}`, code: 'ERR_INVALID_URL' },
      startedAt,
      spec.url ?? '',
      []
    )
  }

  // --- 2. Headers (enabled user headers, then auth applied last). ---
  const headers = collectUserHeaders(spec.headers ?? [])
  const auth = buildAuthHeaders(spec.auth)
  for (const [k, v] of Object.entries(auth.headers)) headers[k] = v

  // API key placed in the query string.
  if (auth.query) {
    try {
      const withKey = new URL(initialUrl)
      withKey.searchParams.append(auth.query.key, auth.query.value)
      initialUrl = withKey.toString()
    } catch {
      // initialUrl was already validated above; ignore.
    }
  }

  // --- 3. Encode the body. ---
  let encoded: EncodedBody
  try {
    encoded = await encodeBody(spec.body, headers)
  } catch (err) {
    // A file read for formdata/binary failed (missing path, permissions, ...).
    return errorResult(
      { kind: 'unknown', message: `Failed to read request body: ${(err as Error).message}`, code: (err as ErrnoLike).code },
      startedAt,
      initialUrl,
      []
    )
  }
  if (encoded.contentType && !findHeader(headers, 'content-type')) {
    headers['Content-Type'] = encoded.contentType
  }

  const settings = spec.settings
  const timeoutMs = settings?.timeoutMs && settings.timeoutMs > 0 ? settings.timeoutMs : 0
  const followRedirects = settings?.followRedirects !== false
  const maxRedirects = Math.min(
    Math.max(0, settings?.maxRedirects ?? 10),
    ABSOLUTE_MAX_REDIRECTS
  )
  const rejectUnauthorized = settings?.rejectUnauthorized !== false

  // --- 4. Wire cancellation + timeout into a single internal controller. ---
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const onExternalAbort = (): void => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  // The timeout is a per-hop budget (re-armed before each request below), matching
  // Postman — a legitimate redirect chain isn't aborted by one global deadline.
  const armTimeout = (): void => {
    if (timeoutMs <= 0) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  // --- 5. TLS: only relax verification when explicitly disabled. ---
  let dispatcher: Dispatcher | undefined
  if (!rejectUnauthorized) {
    dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
  }

  const redirects: RedirectHop[] = []
  // Per-request cookie jar so a login -> redirect flow keeps its session cookies.
  const cookieJar = new Map<string, string>()
  // The user's original Cookie header — cleared once we cross to another origin so
  // it can never be re-attached to a different host on a later same-origin hop.
  let userCookie = findHeader(headers, 'cookie')
  let currentUrl = initialUrl
  let method = (spec.method || 'GET').toUpperCase()
  let ttfbMs: number | undefined

  try {
    // --- 6. Request loop: send, optionally follow redirects manually. ---
    // We use undici.request (which does NOT auto-follow) so every hop is
    // observable and recorded into `redirects`.
    for (let hop = 0; ; hop++) {
      armTimeout()
      const res = await undiciRequest(currentUrl, {
        method: method as Dispatcher.HttpMethod,
        headers,
        // FormData/string/Buffer are all valid undici body inputs.
        body: encoded.body as never,
        signal: controller.signal,
        dispatcher,
        maxRedirections: 0
      })

      // Headers are in — this is our TTFB marker (first hop only).
      if (ttfbMs === undefined) ttfbMs = Date.now() - startedAt

      const status = res.statusCode
      const isRedirect = REDIRECT_STATUSES.has(status)
      const location = res.headers['location']
      const locationStr = Array.isArray(location) ? location[0] : location

      if (followRedirects && isRedirect && locationStr && hop < maxRedirects) {
        // Drain the redirect body (awaited) so the socket is freed before the next hop.
        await res.body.dump?.()
        let nextUrl: string
        try {
          nextUrl = new URL(locationStr, currentUrl).toString()
        } catch {
          // Bad Location header — treat this 3xx as the final response instead.
          return await finalizeResponse(res, currentUrl, status, redirects, startedAt, ttfbMs)
        }
        redirects.push({ from: currentUrl, to: nextUrl, status })

        // Carry cookies set on this hop so login -> redirect sessions survive.
        addSetCookies(cookieJar, extractSetCookie(res.headers))

        if (sameOrigin(currentUrl, nextUrl)) {
          if (cookieJar.size) {
            const merged = userCookie ? `${userCookie}; ${jarHeader(cookieJar)}` : jarHeader(cookieJar)
            setHeaderCI(headers, 'Cookie', merged)
          }
        } else {
          // Cross-origin redirect: never forward credentials (matches browsers/Postman),
          // including custom credential headers (X-Api-Key, X-Auth-Token, ...).
          for (const k of Object.keys(headers)) {
            if (CREDENTIAL_HEADER_RE.test(k)) delete headers[k]
          }
          cookieJar.clear()
          userCookie = undefined
          // Don't carry a "disable TLS verification" choice to a host the user
          // didn't opt into — revert to secure verification across origins.
          if (dispatcher) {
            void dispatcher.close().catch(() => {})
            dispatcher = undefined
          }
        }

        // Per RFC 7231: 303 (and commonly 301/302) downgrade to GET and drop
        // the body. 307/308 preserve method and body.
        if (status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')) {
          method = 'GET'
          encoded = { body: undefined }
          deleteHeaderCI(headers, 'content-type')
          deleteHeaderCI(headers, 'content-length')
        }
        currentUrl = nextUrl
        continue
      }

      // Terminal response (no follow, not a redirect, or hit the cap).
      return await finalizeResponse(res, currentUrl, status, redirects, startedAt, ttfbMs)
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return errorResult(
        timedOut
          ? { kind: 'timeout', message: `Request timed out after ${timeoutMs} ms`, code: 'ETIMEDOUT' }
          : { kind: 'abort', message: 'Request was cancelled', code: 'ABORT_ERR' },
        startedAt,
        currentUrl,
        redirects
      )
    }
    return errorResult(classifyError(err), startedAt, currentUrl, redirects)
  } finally {
    if (timer) clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    // Close the per-request dispatcher so its sockets don't leak.
    if (dispatcher) void dispatcher.close().catch(() => {})
  }
}

/**
 * Read the full body of a terminal undici response and assemble the normalized
 * ResponseResult (decoding text vs. binary, parsing cookies, timings, size).
 */
async function finalizeResponse(
  res: Dispatcher.ResponseData,
  finalUrl: string,
  status: number,
  redirects: RedirectHop[],
  startedAt: number,
  ttfbMs: number | undefined
): Promise<ResponseResult> {
  const arrayBuf = await res.body.arrayBuffer()
  const rawBuf = Buffer.from(arrayBuf)
  const totalMs = Date.now() - startedAt

  const headers = normalizeResponseHeaders(res.headers)
  const setCookie = extractSetCookie(res.headers)
  const cookies = parseCookies(setCookie)

  const rawContentType = res.headers['content-type']
  const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType) ?? ''

  // undici.request does not decompress; decode per Content-Encoding so text and
  // sizeBytes reflect the actual payload.
  const rawEncoding = res.headers['content-encoding']
  const contentEncoding = Array.isArray(rawEncoding) ? rawEncoding[0] : rawEncoding
  const { buf, decoded } = decodeContentEncoding(rawBuf, contentEncoding)

  // Only when we FULLY decoded: keep headers consistent with the body we expose —
  // drop the now-inaccurate Content-Encoding and correct Content-Length.
  if (decoded) {
    for (let i = headers.length - 1; i >= 0; i--) {
      const name = headers[i][0].toLowerCase()
      if (name === 'content-encoding') headers.splice(i, 1)
      else if (name === 'content-length') headers[i][1] = String(buf.length)
    }
  }

  // An empty/missing Content-Type defaults to text (servers that omit it usually
  // return text/JSON) rather than being misclassified as binary.
  const isBinary = buf.length > 0 && contentType !== '' && !TEXTY_CONTENT_TYPE_RE.test(contentType)

  const body: ResponseResult['body'] = isBinary
    ? { base64: buf.toString('base64'), contentType, isBinary: true, sizeBytes: buf.length, encoding: 'base64' }
    : { text: buf.toString('utf8'), contentType, isBinary: false, sizeBytes: buf.length, encoding: 'utf-8' }

  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: statusTextFor(status),
    headers,
    cookies,
    body,
    timings: { startedAt, ttfbMs, totalMs },
    redirects,
    finalUrl
  }
}

/* ============================================================
 * Status text (undici only exposes the numeric code)
 * ============================================================ */

const STATUS_TEXT: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  422: 'Unprocessable Entity',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  511: 'Network Authentication Required'
}

function statusTextFor(status: number): string {
  return STATUS_TEXT[status] ?? ''
}

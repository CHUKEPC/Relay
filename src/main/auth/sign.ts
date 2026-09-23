/**
 * Auth dispatch for the engine: turns an `Auth` config into request headers.
 *
 * Two kinds:
 *  - Token-style (JWT, ASAP): no request binding — produce a header/query from
 *    the config alone (`buildTokenAuth`).
 *  - Request-bound signing (OAuth 1.0a, AWS SigV4, Hawk, Akamai EdgeGrid): the
 *    signature depends on method/url/headers/body, so it runs after the body is
 *    encoded (`signRequest`).
 *
 * Each algorithm lives in its own pure, unit-tested module; this file only wires
 * them to the engine's request context. A failure never throws: it comes back
 * as `error`, and the engine refuses to send rather than letting the request go
 * out unauthenticated and come back as an unexplained 401.
 */
import type { Auth } from '@shared/types'
import { generateJwt } from './jwt'
import { asapToken } from './asap'
import { oauth1Header } from './oauth1'
import { signAwsV4 } from './awsv4'
import { hawkHeader } from './hawk'
import { edgeGridHeader } from './akamai'

export interface AuthHeaderResult {
  headers: Record<string, string>
  query?: { key: string; value: string }
  /** why the auth could not be produced; nothing else is set then */
  error?: string
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Token-style auth that needs no request binding (JWT Bearer, Atlassian ASAP). */
export function buildTokenAuth(auth: Auth | undefined): AuthHeaderResult | null {
  if (!auth) return null
  if (auth.type === 'jwt') {
    let payload: Record<string, unknown> = {}
    if (auth.payload && auth.payload.trim()) {
      try {
        payload = JSON.parse(auth.payload)
      } catch (err) {
        return { headers: {}, error: `JWT: the payload is not valid JSON (${reason(err)})` }
      }
    }
    let token: string
    try {
      token = generateJwt({ algorithm: auth.algorithm, secret: auth.secret, payload })
    } catch (err) {
      return { headers: {}, error: `JWT: could not sign the token (${reason(err)})` }
    }
    if (auth.addTo === 'query') {
      return { headers: {}, query: { key: auth.queryParamName?.trim() || 'token', value: token } }
    }
    const prefix = auth.headerPrefix && auth.headerPrefix.trim() ? auth.headerPrefix.trim() : 'Bearer'
    return { headers: { Authorization: `${prefix} ${token}` } }
  }
  if (auth.type === 'asap') {
    let token: string
    try {
      token = asapToken({
        issuer: auth.issuer,
        audience: auth.audience,
        keyId: auth.keyId,
        privateKeyPem: auth.privateKey,
        subject: auth.subject || undefined
      })
    } catch (err) {
      return { headers: {}, error: `ASAP: could not sign the token (${reason(err)})` }
    }
    return { headers: { Authorization: `Bearer ${token}` } }
  }
  return null
}

export interface SignContext {
  method: string
  /** full request URL including query string */
  url: string
  /** already-assembled request headers (user + simple auth) */
  headers: Record<string, string>
  /** encoded body, when available as text/bytes */
  body?: string | Buffer
  contentType?: string
  /**
   * Form fields for OAuth1 body signing (x-www-form-urlencoded). Prefer the pair
   * array: it keeps the wire order and, unlike an object, preserves repeated
   * keys — every occurrence has to appear in the signature base string.
   */
  urlencodedParams?: Array<[string, string]> | Record<string, string>
  /** true when the body bytes can't be hashed (multipart/form-data) → AWS UNSIGNED-PAYLOAD */
  unsignedBody?: boolean
}

/** Request-bound signing (OAuth 1.0a, AWS SigV4, Hawk, Akamai EdgeGrid). */
export function signRequest(auth: Auth | undefined, ctx: SignContext): AuthHeaderResult | null {
  if (!auth) return null
  try {
    switch (auth.type) {
      case 'oauth1': {
        const header = oauth1Header({
          method: ctx.method,
          url: ctx.url,
          consumerKey: auth.consumerKey,
          consumerSecret: auth.consumerSecret,
          token: auth.token || undefined,
          tokenSecret: auth.tokenSecret || undefined,
          signatureMethod: auth.signatureMethod,
          bodyParams: ctx.urlencodedParams
        })
        return { headers: { Authorization: header } }
      }
      case 'aws': {
        const add = signAwsV4({
          method: ctx.method,
          url: ctx.url,
          headers: ctx.headers,
          body: ctx.body,
          accessKeyId: auth.accessKey,
          secretAccessKey: auth.secretKey,
          sessionToken: auth.sessionToken || undefined,
          region: auth.region,
          service: auth.service,
          unsignedPayload: ctx.unsignedBody
        })
        return { headers: add }
      }
      case 'hawk': {
        const payload = typeof ctx.body === 'string' ? ctx.body : undefined
        const header = hawkHeader({
          method: ctx.method,
          url: ctx.url,
          id: auth.id,
          key: auth.key,
          algorithm: auth.algorithm,
          payload,
          contentType: ctx.contentType,
          ext: auth.ext || undefined
        })
        return { headers: { Authorization: header } }
      }
      case 'akamai': {
        const body = typeof ctx.body === 'string' ? ctx.body : undefined
        const header = edgeGridHeader({
          method: ctx.method,
          url: ctx.url,
          clientToken: auth.clientToken,
          clientSecret: auth.clientSecret,
          accessToken: auth.accessToken,
          headers: ctx.headers,
          body
        })
        return { headers: { Authorization: header } }
      }
      default:
        return null
    }
  } catch (err) {
    // Never crash a send — but never send it unsigned either.
    return { headers: {}, error: `${auth.type}: could not sign the request (${reason(err)})` }
  }
}

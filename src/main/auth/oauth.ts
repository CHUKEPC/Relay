/**
 * OAuth 2.0 token acquisition. Runs in the Electron main process (no CORS, full
 * network position). Supports the token-endpoint side of these grants:
 *   - client_credentials
 *   - password
 *   - authorization_code (with optional PKCE code_verifier)
 *   - refresh_token
 *   - device_code (RFC 8628 step 2: poll the token endpoint with a device_code)
 *
 * Client credentials can be presented either in the request body (default) or as
 * an HTTP Basic `Authorization` header (`clientAuth: 'basic'`).
 *
 * The interactive browser redirect for authorization_code, and the user-facing
 * step of the device flow, happen out-of-band; the UI collects the code / device
 * code and calls back here. `fetchDeviceCode` performs RFC 8628 step 1.
 */
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  OAuthDeviceRequest,
  OAuthDeviceResult,
  OAuthTokenRequest,
  OAuthTokenResult
} from '@shared/types'

/** RFC 8628 device-code grant type URI. */
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** Token/device endpoints run outside the engine's per-hop timeout, so bound them
 *  here: a non-responsive endpoint must fail promptly, not hang the OAuth flow
 *  (including the engine's on-401 auto-refresh) up to the platform fetch default. */
const OAUTH_TIMEOUT_MS = 30000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), OAUTH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pure assembly of the token-endpoint POST: the `x-www-form-urlencoded` body and
 * the request headers. Exported so the grant/PKCE/client-auth logic is unit
 * testable without touching the network.
 *
 * When `clientAuth === 'basic'`, client_id/client_secret are moved out of the
 * body into a Basic `Authorization` header (RFC 6749 §2.3.1); otherwise they are
 * sent as body parameters.
 */
export function buildTokenRequest(req: OAuthTokenRequest): {
  body: string
  headers: Record<string, string>
} {
  const params = new URLSearchParams()

  switch (req.grant) {
    case 'client_credentials':
      params.set('grant_type', 'client_credentials')
      break
    case 'password':
      params.set('grant_type', 'password')
      params.set('username', req.username ?? '')
      params.set('password', req.password ?? '')
      break
    case 'refresh_token':
      params.set('grant_type', 'refresh_token')
      params.set('refresh_token', req.refreshToken ?? '')
      break
    case 'device_code':
      params.set('grant_type', DEVICE_CODE_GRANT)
      if (req.deviceCode) params.set('device_code', req.deviceCode)
      break
    case 'authorization_code':
    default:
      params.set('grant_type', 'authorization_code')
      if (req.code) params.set('code', req.code)
      if (req.redirectUri) params.set('redirect_uri', req.redirectUri)
      // PKCE: the verifier proves possession of the earlier code_challenge.
      if (req.codeVerifier) params.set('code_verifier', req.codeVerifier)
      break
  }

  if (req.scope) params.set('scope', req.scope)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }

  if (req.clientAuth === 'basic') {
    // Present client credentials via HTTP Basic; keep them out of the body.
    const raw = `${req.clientId ?? ''}:${req.clientSecret ?? ''}`
    headers.Authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
  } else {
    if (req.clientId) params.set('client_id', req.clientId)
    if (req.clientSecret) params.set('client_secret', req.clientSecret)
  }

  return { body: params.toString(), headers }
}

export async function fetchOAuthToken(req: OAuthTokenRequest): Promise<OAuthTokenResult> {
  try {
    // Token endpoint runs from the main process (no CORS, full network position) —
    // restrict to http(s) so a config can't point it at file:// or odd schemes.
    if (!/^https?:\/\//i.test(req.tokenUrl ?? '')) {
      return { ok: false, error: 'Token URL must be an http(s) URL' }
    }

    const { body, headers } = buildTokenRequest(req)

    const res = await fetchWithTimeout(req.tokenUrl, { method: 'POST', headers, body })

    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      /* non-JSON token endpoint */
    }

    if (!res.ok) {
      const detail = parsed.error_description ?? parsed.error ?? res.statusText
      return { ok: false, error: `${res.status} ${String(detail)}`, raw: text }
    }

    return {
      ok: true,
      accessToken: parsed.access_token as string | undefined,
      tokenType: parsed.token_type as string | undefined,
      expiresIn: parsed.expires_in as number | undefined,
      refreshToken: parsed.refresh_token as string | undefined,
      raw: text
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * RFC 8628 step 1: POST to the device-authorization endpoint with client_id and
 * scope, returning the device_code/user_code/verification URIs the user needs to
 * authorize the device. The caller then polls `fetchOAuthToken({grant:'device_code'})`.
 */
export async function fetchDeviceCode(req: OAuthDeviceRequest): Promise<OAuthDeviceResult> {
  try {
    if (!/^https?:\/\//i.test(req.deviceAuthUrl ?? '')) {
      return { ok: false, error: 'Device Authorization URL must be an http(s) URL' }
    }

    const params = new URLSearchParams()
    if (req.clientId) params.set('client_id', req.clientId)
    if (req.scope) params.set('scope', req.scope)

    const res = await fetchWithTimeout(req.deviceAuthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: params.toString()
    })

    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      /* non-JSON device endpoint */
    }

    if (!res.ok) {
      const detail = parsed.error_description ?? parsed.error ?? res.statusText
      return { ok: false, error: `${res.status} ${String(detail)}` }
    }

    return {
      ok: true,
      deviceCode: parsed.device_code as string | undefined,
      userCode: parsed.user_code as string | undefined,
      verificationUri: parsed.verification_uri as string | undefined,
      verificationUriComplete: parsed.verification_uri_complete as string | undefined,
      expiresIn: parsed.expires_in as number | undefined,
      interval: parsed.interval as number | undefined
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerOAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.oauth.token, async (_e, payload: OAuthTokenRequest) => fetchOAuthToken(payload))
  ipcMain.handle(IPC.oauth.device, async (_e, payload: OAuthDeviceRequest) => fetchDeviceCode(payload))
}

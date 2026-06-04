/**
 * OAuth 2.0 token acquisition (client_credentials + password grants, and the
 * token-exchange step of authorization_code). Runs in main — no CORS.
 * The interactive browser redirect for authorization_code is out of scope here;
 * the UI collects an auth code or the user pastes a token.
 */
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { OAuthTokenRequest, OAuthTokenResult } from '@shared/types'

export async function fetchOAuthToken(req: OAuthTokenRequest): Promise<OAuthTokenResult> {
  try {
    const params = new URLSearchParams()
    if (req.grant === 'client_credentials') {
      params.set('grant_type', 'client_credentials')
    } else if (req.grant === 'password') {
      params.set('grant_type', 'password')
      params.set('username', req.username ?? '')
      params.set('password', req.password ?? '')
    } else {
      params.set('grant_type', 'authorization_code')
      if (req.code) params.set('code', req.code)
      if (req.redirectUri) params.set('redirect_uri', req.redirectUri)
    }
    if (req.scope) params.set('scope', req.scope)
    if (req.clientId) params.set('client_id', req.clientId)
    if (req.clientSecret) params.set('client_secret', req.clientSecret)

    const res = await fetch(req.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: params.toString()
    })

    const text = await res.text()
    let parsed: any = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      /* non-JSON token endpoint */
    }

    if (!res.ok) {
      return { ok: false, error: `${res.status} ${parsed.error_description ?? parsed.error ?? res.statusText}`, raw: text }
    }

    return {
      ok: true,
      accessToken: parsed.access_token,
      tokenType: parsed.token_type,
      expiresIn: parsed.expires_in,
      raw: text
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerOAuthHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.oauth.token, async (_e, payload: OAuthTokenRequest) => fetchOAuthToken(payload))
}

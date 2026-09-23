/**
 * OAuth 2.0 authorization-code step, done the way RFC 8252 describes for
 * native apps: open the authorization URL in the user's own browser and catch
 * the redirect on a loopback address.
 *
 * - The authorization URL carries `state` (checked on return) and, when the
 *   request uses PKCE, `code_challenge` + `code_challenge_method=S256`. The
 *   verifier never leaves the app until the token exchange.
 * - A redirect URI on `http://127.0.0.1:<port>` / `http://localhost:<port>` /
 *   `http://[::1]:<port>` is served by a one-shot listener bound to that exact
 *   address, which answers a single request and closes. It listens only while
 *   the user is signing in, and only on the loopback interface.
 * - Any other redirect URI (a web callback registered with the provider) cannot
 *   be caught locally: the browser is opened and the user pastes the code — or
 *   the whole redirect URL — back into the field.
 *
 * Nothing here runs unless the user presses the button: an isolated app must
 * not open a browser or a port on its own.
 */
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { IpcMain } from 'electron'
import { shell } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { mt, mtf } from '../i18n'
import type { OAuthAuthorizeRequest, OAuthAuthorizeResult } from '@shared/types'

/** How long the loopback listener waits for the user to finish signing in. */
const WAIT_MS = 5 * 60 * 1000

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The page the browser shows once the code has been handed to Relay. */
function donePage(ok: boolean, message: string): string {
  const escaped = message.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
  return `<!doctype html><meta charset="utf-8"><title>Relay</title><body style="font:15px system-ui;margin:48px;color:${ok ? '#1b7f3b' : '#b3261e'}">${escaped}</body>`
}

/** Build the authorization URL; exported for tests. */
export function buildAuthorizeUrl(req: OAuthAuthorizeRequest, state: string): string {
  const url = new URL(req.authUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', req.clientId)
  if (req.redirectUri) url.searchParams.set('redirect_uri', req.redirectUri)
  if (req.scope) url.searchParams.set('scope', req.scope)
  url.searchParams.set('state', state)
  if (req.codeChallenge) {
    url.searchParams.set('code_challenge', req.codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

/** A redirect URI Relay can serve itself, or null when the user has to paste the code. */
export function loopbackTarget(redirectUri: string | undefined): { host: string; port: number; path: string } | null {
  if (!redirectUri) return null
  let u: URL
  try {
    u = new URL(redirectUri)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' || !LOOPBACK_HOSTS.has(u.hostname) || !u.port) return null
  const host = u.hostname === '[::1]' ? '::1' : u.hostname
  return { host, port: Number(u.port), path: u.pathname || '/' }
}

/** Serve one redirect on the loopback address; resolves with the code or an error. */
function waitForRedirect(target: { host: string; port: number; path: string }, state: string, timeoutMs: number, onListening: () => void): Promise<OAuthAuthorizeResult> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      // Browsers also ask for /favicon.ico; only the callback path counts.
      if (url.pathname !== target.path) {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const returned = url.searchParams.get('state')
      let result: OAuthAuthorizeResult
      if (error) {
        const desc = url.searchParams.get('error_description')
        result = { ok: false, error: desc ? `${error}: ${desc}` : error }
      } else if (returned !== state) {
        // A mismatched state means this redirect was not started by this sign-in.
        result = { ok: false, error: 'state mismatch — the redirect did not come from this sign-in' }
      } else if (!code) {
        result = { ok: false, error: 'the redirect carried no authorization code' }
      } else {
        result = { ok: true, code }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(donePage(result.ok, result.ok ? mt('Готово — вернитесь в Relay. Вкладку можно закрыть.') : mtf('Вход не завершён: {error}', { error: result.error ?? '' })))
      finish(result)
    })
    const finish = (result: OAuthAuthorizeResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      server.close()
      server.closeAllConnections?.()
      resolve(result)
    }
    server.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        error: err.code === 'EADDRINUSE' ? `port ${target.port} is already in use — pick another redirect port` : err.message
      })
    })
    server.listen(target.port, target.host, () => {
      timer = setTimeout(() => finish({ ok: false, error: 'timed out waiting for the browser sign-in' }), timeoutMs)
      onListening()
    })
  })
}

/**
 * Run the browser step. `open` is injectable so tests can follow the URL
 * themselves instead of launching a browser.
 */
export async function authorize(
  req: OAuthAuthorizeRequest,
  open: (url: string) => Promise<void> = (url) => shell.openExternal(url),
  timeoutMs = WAIT_MS
): Promise<OAuthAuthorizeResult> {
  try {
    const auth = new URL(req.authUrl)
    if (auth.protocol !== 'https:' && auth.protocol !== 'http:') return { ok: false, error: 'the authorization URL must be http(s)' }
  } catch {
    return { ok: false, error: 'the authorization URL is not a valid URL' }
  }
  if (!req.clientId) return { ok: false, error: 'Client ID is required' }

  const state = randomBytes(16).toString('hex')
  const url = buildAuthorizeUrl(req, state)
  const target = loopbackTarget(req.redirectUri)

  if (!target) {
    // Not a loopback redirect: the provider sends the user to its own page.
    await open(url)
    return { ok: true, manual: true, state }
  }
  return waitForRedirect(target, state, timeoutMs, () => void open(url))
}

export function registerOAuthAuthorizeHandler(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.oauth.authorize, async (_e, payload: OAuthAuthorizeRequest) => authorize(payload))
}

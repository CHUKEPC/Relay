import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

import { authorize, buildAuthorizeUrl, loopbackTarget } from './oauth-authorize'

const b64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A free loopback port, released before the code under test binds it. */
async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

/** Follow the redirect URI back to the listener, like a provider would. */
async function redirectBack(authorizeUrl: string, params: Record<string, string>, keepState = true): Promise<Response> {
  const u = new URL(authorizeUrl)
  const back = new URL(u.searchParams.get('redirect_uri') ?? '')
  for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v)
  if (keepState && !('state' in params)) back.searchParams.set('state', u.searchParams.get('state') ?? '')
  return fetch(back)
}

let extra: Server | null = null
afterEach(async () => {
  const s = extra
  extra = null
  if (s) await new Promise<void>((r) => s.close(() => r()))
})

describe('buildAuthorizeUrl', () => {
  it('carries state, the PKCE challenge and keeps the provider query', () => {
    const url = new URL(
      buildAuthorizeUrl(
        { authUrl: 'https://idp.example/authorize?tenant=a', clientId: 'app', redirectUri: 'http://127.0.0.1:5000/cb', scope: 'read write', codeChallenge: 'abc' },
        'st'
      )
    )
    expect(url.searchParams.get('tenant')).toBe('a')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('app')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5000/cb')
    expect(url.searchParams.get('scope')).toBe('read write')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('code_challenge')).toBe('abc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('sends no challenge without PKCE', () => {
    const url = new URL(buildAuthorizeUrl({ authUrl: 'https://idp.example/authorize', clientId: 'app' }, 'st'))
    expect(url.searchParams.has('code_challenge')).toBe(false)
    expect(url.searchParams.has('code_challenge_method')).toBe(false)
  })
})

describe('loopbackTarget', () => {
  it('accepts loopback http redirects with a port', () => {
    expect(loopbackTarget('http://127.0.0.1:53682/callback')).toEqual({ host: '127.0.0.1', port: 53682, path: '/callback' })
    expect(loopbackTarget('http://localhost:8080')).toEqual({ host: 'localhost', port: 8080, path: '/' })
    expect(loopbackTarget('http://[::1]:9000/cb')?.host).toBe('::1')
  })

  it('leaves everything else to the user', () => {
    expect(loopbackTarget('https://127.0.0.1:5000/cb')).toBeNull()
    expect(loopbackTarget('http://127.0.0.1/cb')).toBeNull()
    expect(loopbackTarget('https://app.example.com/callback')).toBeNull()
    expect(loopbackTarget('not a url')).toBeNull()
    expect(loopbackTarget(undefined)).toBeNull()
  })
})

describe('authorize', () => {
  it('catches the loopback redirect and returns the code (PKCE S256, RFC 7636 appendix B)', async () => {
    const port = await freePort()
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    let seenChallenge: string | null = null
    const open = async (url: string): Promise<void> => {
      seenChallenge = new URL(url).searchParams.get('code_challenge')
      expect((await redirectBack(url, { code: 'the-code' })).status).toBe(200)
    }
    const res = await authorize(
      { authUrl: 'https://idp.example/authorize', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/callback`, codeChallenge: challenge },
      open,
      5000
    )
    expect(res).toMatchObject({ ok: true, code: 'the-code' })
    expect(seenChallenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('rejects a redirect whose state does not match', async () => {
    const port = await freePort()
    const res = await authorize(
      { authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/cb` },
      async (url) => void (await redirectBack(url, { code: 'x', state: 'forged' })),
      5000
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/state/)
  })

  it('surfaces the provider error', async () => {
    const port = await freePort()
    const res = await authorize(
      { authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/cb` },
      async (url) => void (await redirectBack(url, { error: 'access_denied', error_description: 'user said no' })),
      5000
    )
    expect(res).toEqual({ ok: false, error: 'access_denied: user said no' })
  })

  it('ignores stray requests (favicon) and still waits for the callback', async () => {
    const port = await freePort()
    const open = async (url: string): Promise<void> => {
      expect((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(404)
      await redirectBack(url, { code: 'c' })
    }
    const res = await authorize({ authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/cb` }, open, 5000)
    expect(res).toMatchObject({ ok: true, code: 'c' })
  })

  it('times out and releases the port', async () => {
    const port = await freePort()
    const res = await authorize({ authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/cb` }, async () => undefined, 150)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/timed out/)
    // The listener is gone: the port can be bound again.
    const again = createServer()
    extra = again
    await new Promise<void>((resolve, reject) => {
      again.once('error', reject)
      again.listen(port, '127.0.0.1', () => resolve())
    })
  })

  it('reports a busy port instead of hanging', async () => {
    const busy = createServer()
    extra = busy
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r))
    const port = (busy.address() as AddressInfo).port
    const res = await authorize({ authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: `http://127.0.0.1:${port}/cb` }, async () => undefined, 5000)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/already in use/)
  })

  it('opens the browser and hands over to the user for a non-loopback redirect', async () => {
    const opened: string[] = []
    const res = await authorize(
      { authUrl: 'https://idp.example/a', clientId: 'app', redirectUri: 'https://app.example.com/cb' },
      async (u) => void opened.push(u),
      5000
    )
    expect(res.ok).toBe(true)
    expect(res.manual).toBe(true)
    expect(opened).toHaveLength(1)
  })

  it('refuses a non-http authorization URL', async () => {
    const res = await authorize({ authUrl: 'file:///etc/passwd', clientId: 'app' }, async () => undefined, 100)
    expect(res.ok).toBe(false)
  })
})

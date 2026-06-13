import { afterEach, describe, it, expect, vi } from 'vitest'
import { hostAllowed, runPluginEvent } from './sandbox'
import { redactUrl } from './redact'
import type { PluginRunRequest } from '@shared/types'

function base(partial: Partial<PluginRunRequest>): PluginRunRequest {
  return {
    pluginId: 'test-plugin',
    code: '',
    permissions: [],
    config: {},
    storage: {},
    event: { type: 'button', buttonId: 'go' },
    context: {},
    ...partial
  }
}

interface StubResponse {
  status?: number
  text?: string
  headers?: Record<string, string>
}

/**
 * Sequential fetch stub (no stream — exercises the text() fallback). The Nth
 * call gets the Nth response; extra calls repeat the last one.
 */
function seqFetch(responses: StubResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: 'OK',
      headers: new Headers(r.headers ?? { 'content-type': 'text/plain' }),
      body: null,
      text: async () => r.text ?? 'pong'
    }
  })
  return { fn, calls }
}

function fetchStub(opts: StubResponse = {}) {
  return seqFetch([opts]).fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin sandbox', () => {
  it('dispatches button:<id> handlers with the event context', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('button:go', (ctx) => { relay.toast('clicked ' + ctx.buttonId + ' ' + ctx.response.status) })`,
        permissions: ['response:read'],
        context: {
          response: {
            status: 201,
            statusText: 'Created',
            headers: [],
            contentType: 'application/json',
            sizeBytes: 2,
            timeMs: 5,
            finalUrl: 'https://x.test'
          }
        }
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.toast).toEqual({ message: 'clicked go 201', kind: 'ok' })
  })

  it('falls back to the generic button handler', async () => {
    const res = await runPluginEvent(base({ code: `relay.on('button', () => relay.toast('generic'))` }))
    expect(res.toast?.message).toBe('generic')
  })

  it('reports a missing button handler as an error', async () => {
    const res = await runPluginEvent(base({ code: `// registers nothing` }))
    expect(res.error).toContain('no handler for button')
  })

  it('treats a missing response-hook handler as a no-op', async () => {
    const res = await runPluginEvent(base({ code: ``, event: { type: 'response' } }))
    expect(res.error).toBeUndefined()
  })

  it('captures console output and relay.log', async () => {
    const res = await runPluginEvent(
      base({ code: `console.log('a', { b: 1 }); relay.warn('careful'); relay.on('button', () => {})` })
    )
    expect(res.logs[0].message).toContain('a {"b":1}')
    expect(res.logs[1]).toEqual({ level: 'warn', message: 'careful' })
  })

  it('exposes config frozen', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', () => {
          try { relay.config.url = 'hacked' } catch {}
          relay.toast(relay.config.url)
        })`,
        config: { url: 'https://ok.test' }
      })
    )
    expect(res.toast?.message).toBe('https://ok.test')
  })

  it('awaits async handlers (note: no timers in the sandbox — microtasks only)', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          await Promise.resolve()
          await Promise.resolve()
          relay.toast('after await')
        })`
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.toast?.message).toBe('after await')
  })

  it('surfaces handler exceptions', async () => {
    const res = await runPluginEvent(base({ code: `relay.on('button', () => { throw new Error('boom') })` }))
    expect(res.error).toBe('boom')
  })

  it('blocks eval inside the sandbox realm', async () => {
    const res = await runPluginEvent(base({ code: `relay.on('button', () => { eval('1') })` }))
    expect(res.error).toMatch(/code generation|EvalError|disallowed/i)
  })

  it('denies relay.fetch without the net permission', async () => {
    vi.stubGlobal('fetch', fetchStub())
    const res = await runPluginEvent(
      base({ code: `relay.on('button', async () => { await relay.fetch('https://x.test') })` })
    )
    expect(res.error).toContain("'net' permission")
  })

  it('allows relay.fetch with net and returns a pm.sendRequest-shaped result', async () => {
    const stub = fetchStub({ text: '{"n":7}', headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal('fetch', stub)
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          const r = await relay.fetch('https://api.test/hook', { method: 'POST', body: '{}' })
          relay.toast(r.status + ' ' + r.json().n + ' ' + r.headers.get('content-type') + ' ' + r.text().length)
        })`,
        permissions: ['net']
      })
    )
    expect(stub).toHaveBeenCalledTimes(1)
    expect(res.error).toBeUndefined()
    expect(res.toast?.message).toBe('200 7 application/json 7')
  })

  it('follows same-grant redirects manually, downgrading 302 POST to GET and stripping credentials cross-origin', async () => {
    const { fn, calls } = seqFetch([
      { status: 302, headers: { location: 'https://b.test/next' } },
      { text: 'landed' }
    ])
    vi.stubGlobal('fetch', fn)
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          const r = await relay.fetch('https://a.test/start', {
            method: 'POST', body: '{}', headers: { Authorization: 'Bearer t', 'X-Trace': '1' }
          })
          relay.toast('done ' + r.status)
        })`,
        permissions: ['net']
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.toast?.message).toBe('done 200')
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('https://b.test/next')
    expect(calls[1].init?.method).toBe('GET')
    expect(calls[1].init?.body).toBeUndefined()
    const hopHeaders = calls[1].init?.headers as Record<string, string>
    expect(hopHeaders.Authorization).toBeUndefined()
    expect(hopHeaders['X-Trace']).toBe('1')
  })

  it('aborts an endless redirect chain', async () => {
    vi.stubGlobal('fetch', fetchStub({ status: 302, headers: { location: 'https://a.test/loop' } }))
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => { await relay.fetch('https://a.test/loop') })`,
        permissions: ['net']
      })
    )
    expect(res.error).toContain('too many redirects')
  })

  it('enforces net:<host> scoping', async () => {
    vi.stubGlobal('fetch', fetchStub())
    const denied = await runPluginEvent(
      base({
        code: `relay.on('button', async () => { await relay.fetch('https://evil.test/x') })`,
        permissions: ['net:hooks.example.com']
      })
    )
    expect(denied.error).toContain('host not allowed')

    const allowed = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          const r = await relay.fetch('https://hooks.example.com/x')
          relay.toast('ok ' + r.status)
        })`,
        permissions: ['net:hooks.example.com']
      })
    )
    expect(allowed.error).toBeUndefined()
    expect(allowed.toast?.message).toBe('ok 200')
  })

  it('rejects a redirect that escapes a host-scoped grant', async () => {
    const { fn, calls } = seqFetch([
      { status: 302, headers: { location: 'https://evil.test/landed' } },
      { text: 'should never be fetched' }
    ])
    vi.stubGlobal('fetch', fn)
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => { await relay.fetch('https://hooks.example.com/x') })`,
        permissions: ['net:hooks.example.com']
      })
    )
    expect(res.error).toContain('redirected')
    // The grant check fires BEFORE the second request goes out.
    expect(calls).toHaveLength(1)
  })

  it('rejects non-http(s) schemes', async () => {
    vi.stubGlobal('fetch', fetchStub())
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => { await relay.fetch('file:///etc/passwd') })`,
        permissions: ['net']
      })
    )
    expect(res.error).toContain('host not allowed')
  })

  it('exposes relay.storage (get/set/delete) gated by the storage permission', async () => {
    const denied = await runPluginEvent(
      base({ code: `relay.on('button', () => { relay.storage.set('k','v') })` })
    )
    expect(denied.error).toContain("'storage' permission")

    const ok = await runPluginEvent(
      base({
        code: `relay.on('button', () => {
          relay.toast('prev=' + (relay.storage.get('n') || '0'))
          relay.storage.set('n', '5')
          relay.storage.delete('old')
        })`,
        permissions: ['storage'],
        storage: { n: '4', old: 'x' }
      })
    )
    expect(ok.error).toBeUndefined()
    expect(ok.toast?.message).toBe('prev=4')
    expect(ok.storageUpdates).toEqual({ n: '5', old: null })
  })

  it('captures request:write patches in a request handler', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('request', () => {
          relay.request.setMethod('post')
          relay.request.setHeader('X-Tag', '1')
          relay.request.removeHeader('Cookie')
          relay.request.setUrl('https://api.test/v2')
        })`,
        permissions: ['request:write'],
        event: { type: 'request' }
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.requestPatch).toEqual({
      url: 'https://api.test/v2',
      method: 'POST',
      headerOps: [
        { op: 'set', key: 'X-Tag', value: '1' },
        { op: 'remove', key: 'Cookie' }
      ]
    })
  })

  it('preserves set/remove call order for the same header', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('request', () => {
          relay.request.setHeader('X-Auth', 'a')
          relay.request.removeHeader('X-Auth')
        })`,
        permissions: ['request:write'],
        event: { type: 'request' }
      })
    )
    expect(res.requestPatch?.headerOps).toEqual([
      { op: 'set', key: 'X-Auth', value: 'a' },
      { op: 'remove', key: 'X-Auth' }
    ])
  })

  it('denies relay.request without request:write or outside a request event', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('response', () => { relay.request.setHeader('X','1') })`,
        permissions: ['request:write'],
        event: { type: 'response' }
      })
    )
    expect(res.error).toContain("'request:write'")
  })

  it('captures panel HTML for a panel:<id> handler', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('panel:stats', () => { relay.panel.set('<b>hi</b>') })`,
        event: { type: 'panel', panelId: 'stats' }
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.panelHtml).toBe('<b>hi</b>')
  })

  it('errors when a panel handler is missing', async () => {
    const res = await runPluginEvent(base({ code: `// nothing`, event: { type: 'panel', panelId: 'stats' } }))
    expect(res.error).toContain('no handler for panel')
  })

  it('relay.clipboard.writeText is gated by the clipboard permission', async () => {
    const denied = await runPluginEvent(base({ code: `relay.on('button', () => { relay.clipboard.writeText('x') })` }))
    expect(denied.error).toContain("'clipboard' permission")

    const ok = await runPluginEvent(
      base({ code: `relay.on('button', () => { relay.clipboard.writeText('copied!') })`, permissions: ['clipboard'] })
    )
    expect(ok.error).toBeUndefined()
    expect(ok.clipboardWrite).toBe('copied!')
  })

  it('provides bounded setTimeout so awaited delays resolve', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          await new Promise((r) => setTimeout(r, 10))
          relay.toast('after delay')
        })`
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.toast?.message).toBe('after delay')
  })

  it('dispatches command:<id> handlers', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('command:do-it', (ctx) => relay.toast('cmd ' + ctx.commandId))`,
        event: { type: 'command', commandId: 'do-it' }
      })
    )
    expect(res.toast?.message).toBe('cmd do-it')
  })

  it('dispatches workspace + collection lifecycle handlers and exposes history', async () => {
    const ws = await runPluginEvent(
      base({
        code: `relay.on('workspace', (ctx) => relay.toast('ws ' + ctx.workspace.name))`,
        event: { type: 'workspace' },
        context: { workspace: { id: 'w1', name: 'Личное' } }
      })
    )
    expect(ws.toast?.message).toBe('ws Личное')

    const hist = await runPluginEvent(
      base({
        code: `relay.on('collection', (ctx) => relay.toast('h=' + (ctx.history ? ctx.history.length : 0)))`,
        permissions: ['history:read'],
        event: { type: 'collection' },
        context: { history: [{ method: 'GET', url: 'https://x', status: 200, ok: true, timeMs: 1, at: 0 }] }
      })
    )
    expect(hist.toast?.message).toBe('h=1')
  })

  it('re-dispatches an interactive panel message via ctx.message', async () => {
    const res = await runPluginEvent(
      base({
        code: `relay.on('panel:p', (ctx) => relay.panel.set('<b>' + (ctx.message ? ctx.message.n : 0) + '</b>'))`,
        event: { type: 'panel', panelId: 'p' },
        context: { message: { n: 42 } }
      })
    )
    expect(res.panelHtml).toBe('<b>42</b>')
  })

  it('caps relay.fetch calls per event', async () => {
    vi.stubGlobal('fetch', fetchStub())
    const res = await runPluginEvent(
      base({
        code: `relay.on('button', async () => {
          for (let i = 0; i < 7; i++) await relay.fetch('https://x.test/' + i)
        })`,
        permissions: ['net']
      })
    )
    expect(res.error).toContain('at most 5')
  })
})

describe('hostAllowed', () => {
  it('matches exact hosts, ports and wildcard suffixes', () => {
    expect(hostAllowed('https://a.test/x', ['net'])).toBe(true)
    expect(hostAllowed('https://a.test/x', ['net:a.test'])).toBe(true)
    expect(hostAllowed('https://b.a.test/x', ['net:a.test'])).toBe(false)
    expect(hostAllowed('https://b.a.test/x', ['net:*.a.test'])).toBe(true)
    expect(hostAllowed('https://a.test:8443/x', ['net:a.test:8443'])).toBe(true)
    expect(hostAllowed('https://a.test/x', ['request:read'])).toBe(false)
    expect(hostAllowed('not a url', ['net'])).toBe(false)
    expect(hostAllowed('ftp://a.test/x', ['net'])).toBe(false)
  })

  it('handles port-qualified grants against effective (default) ports', () => {
    // WHATWG URL drops default ports — the grant must still match.
    expect(hostAllowed('https://a.test/x', ['net:a.test:443'])).toBe(true)
    expect(hostAllowed('http://a.test/x', ['net:a.test:80'])).toBe(true)
    expect(hostAllowed('http://a.test/x', ['net:a.test:443'])).toBe(false)
    expect(hostAllowed('https://a.test:9000/x', ['net:a.test:8443'])).toBe(false)
    // Wildcard + port: port-qualified wildcard suffixes must work too.
    expect(hostAllowed('https://api.corp.local:8443/x', ['net:*.corp.local:8443'])).toBe(true)
    expect(hostAllowed('https://api.corp.local:9000/x', ['net:*.corp.local:8443'])).toBe(false)
    expect(hostAllowed('https://api.corp.local:8443/x', ['net:*.corp.local'])).toBe(true)
    // A grant without a port matches any port.
    expect(hostAllowed('https://a.test:8443/x', ['net:a.test'])).toBe(true)
  })
})

describe('redactUrl', () => {
  it('masks ALL query values and strips userinfo, keeping keys/path', () => {
    // The engine injects apikey auth under a user-chosen query name (e.g. ?key=)
    // that no name list catches — so every query value is masked, not guessed.
    const out = redactUrl('https://user:pw@maps.googleapis.com/v1/geo?address=NYC&key=AIzaSyREAL')
    expect(out).not.toContain('AIzaSyREAL')
    expect(out).not.toContain('user')
    expect(out).not.toContain('pw@')
    expect(out).toContain('address=')
    expect(out).toContain('key=')
    expect(out).toContain('/v1/geo')
    expect(out).toContain('maps.googleapis.com')
  })

  it('drops the URL fragment (OAuth implicit-flow token in the hash)', () => {
    const out = redactUrl('https://app.test/cb#access_token=ya29.SECRET&token_type=bearer')
    expect(out).not.toContain('access_token')
    expect(out).not.toContain('ya29.SECRET')
    expect(out).not.toContain('#')
  })

  it('preserves duplicate query keys instead of collapsing them', () => {
    const out = redactUrl('https://api.test/x?a=1&a=2&b=3')
    // both `a` pairs survive (masked), not collapsed into one
    expect(out.match(/a=/g)?.length).toBe(2)
    expect(out).toContain('b=')
    expect(out).not.toContain('=1')
    expect(out).not.toContain('=2')
  })

  it('passes through unparseable input unchanged', () => {
    expect(redactUrl('not a url')).toBe('not a url')
  })
})

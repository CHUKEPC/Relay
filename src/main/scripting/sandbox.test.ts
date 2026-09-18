import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildSendRequestSpec, runSandbox } from './sandbox'
import type { RequestModel, RequestSettings, ResponseResult, ScriptRunRequest, StoredCookie } from '@shared/types'

/**
 * Tests for the expanded pm.* sandbox: extra chai-style assertions, the local
 * pm.variables scope, pm.collectionVariables (collectionUpdates), pm.cookies
 * (read snapshot + jar mutations), and pm.sendRequest against a local server.
 */

const request: RequestModel = {
  id: 'r1',
  name: 'r',
  method: 'GET',
  url: 'https://api.example.com/v1',
  query: [],
  headers: [],
  pathVariables: [],
  body: { type: 'none' },
  auth: { type: 'none' }
}

const response: ResponseResult = {
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  cookies: [],
  body: {
    text: '{"data":[1,2,3],"name":"x","nested":{"a":{"b":{"c":7}}}}',
    contentType: 'application/json',
    isBinary: false,
    sizeBytes: 50
  },
  timings: { startedAt: 0, totalMs: 120 },
  redirects: [],
  finalUrl: 'https://api.example.com/v1'
}

function base(partial: Partial<ScriptRunRequest>): ScriptRunRequest {
  return { phase: 'test', code: '', request, response, environment: {}, globals: {}, ...partial }
}

/** Run a single `pm.test` and report whether it passed. */
async function passes(code: string, partial: Partial<ScriptRunRequest> = {}): Promise<boolean> {
  const res = await runSandbox(base({ ...partial, code: `pm.test("t", () => { ${code} })` }))
  return res.tests[0]?.passed === true
}

describe('sandbox chai assertions', () => {
  it('.members and .include.members check array membership', async () => {
    expect(await passes('pm.expect([1,2,3]).to.include.members([1,2])')).toBe(true)
    expect(await passes('pm.expect([1,2,3]).to.have.members([1,4])')).toBe(false)
  })

  it('.oneOf checks membership of a candidate set', async () => {
    expect(await passes('pm.expect(2).to.be.oneOf([1,2,3])')).toBe(true)
    expect(await passes('pm.expect(5).to.be.oneOf([1,2,3])')).toBe(false)
  })

  it('.keys checks exact own-key set', async () => {
    expect(await passes('pm.expect({a:1,b:2}).to.have.keys("a","b")')).toBe(true)
    expect(await passes('pm.expect({a:1,b:2}).to.have.keys(["a","b"])')).toBe(true)
    expect(await passes('pm.expect({a:1}).to.have.keys("a","b")')).toBe(false)
  })

  it('.closeTo checks numeric tolerance', async () => {
    expect(await passes('pm.expect(1.05).to.be.closeTo(1, 0.1)')).toBe(true)
    expect(await passes('pm.expect(1.5).to.be.closeTo(1, 0.1)')).toBe(false)
  })

  it('.throw asserts a function throws (with optional matcher)', async () => {
    expect(await passes('pm.expect(() => { throw new Error("boom") }).to.throw()')).toBe(true)
    expect(await passes('pm.expect(() => { throw new Error("boom") }).to.throw("boom")')).toBe(true)
    expect(await passes('pm.expect(() => 1).to.throw()')).toBe(false)
    // .Throw alias
    expect(await passes('pm.expect(() => { throw new Error("x") }).to.Throw(/x/)')).toBe(true)
  })

  it('.string checks substring containment', async () => {
    expect(await passes('pm.expect("hello world").to.have.string("world")')).toBe(true)
    expect(await passes('pm.expect("hello").to.have.string("zzz")')).toBe(false)
  })

  it('greaterThan/lessThan/gte/lte aliases', async () => {
    expect(await passes('pm.expect(5).to.be.greaterThan(3)')).toBe(true)
    expect(await passes('pm.expect(2).to.be.lessThan(3)')).toBe(true)
    expect(await passes('pm.expect(3).to.be.gte(3)')).toBe(true)
    expect(await passes('pm.expect(3).to.be.lte(3)')).toBe(true)
    expect(await passes('pm.expect(3).to.be.greaterThan(5)')).toBe(false)
  })

  it('.nested.property resolves a dotted path', async () => {
    expect(await passes('pm.expect(pm.response.json()).to.have.nested.property("nested.a.b.c", 7)')).toBe(true)
    expect(await passes('pm.expect(pm.response.json()).to.have.nested.property("nested.a.b.z")')).toBe(false)
  })
})

describe('pm.variables local scope', () => {
  it('pm.variables.set affects pm.variables.get within the run, highest precedence', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.variables.set("k", "local-wins");
          pm.test("local read back", () => { pm.expect(pm.variables.get("k")).to.equal("local-wins") });
        `,
        collection: { k: 'collection-loses' }
      })
    )
    expect(res.tests[0].passed).toBe(true)
    // local scope is ephemeral — must NOT be persisted anywhere
    expect(res.environmentUpdates).toEqual({})
    expect(res.globalUpdates).toEqual({})
    expect(res.collectionUpdates).toBeUndefined()
  })

  it('pm.variables.unset removes a local var', async () => {
    expect(
      await passes('pm.variables.set("k","v"); pm.variables.unset("k"); pm.expect(pm.variables.has("k")).to.equal(false)')
    ).toBe(true)
  })
})

describe('pm.collectionVariables', () => {
  it('set/unset produce collectionUpdates and are readable within the run', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.collectionVariables.set("token", "abc");
          pm.collectionVariables.unset("stale");
          pm.test("reads its own write", () => { pm.expect(pm.collectionVariables.get("token")).to.equal("abc") });
        `,
        collection: { stale: 'old' }
      })
    )
    expect(res.tests[0].passed).toBe(true)
    expect(res.collectionUpdates).toEqual({ token: 'abc', stale: null })
  })

  it('toObject and has work', async () => {
    expect(
      await passes('pm.expect(pm.collectionVariables.has("base")).to.equal(true)', { collection: { base: 'c' } })
    ).toBe(true)
  })
})

describe('pm.cookies', () => {
  const cookies: StoredCookie[] = [
    { key: 'sessionid', value: 'xyz', domain: 'example.com', path: '/' },
    { key: 'other', value: 'nope', domain: 'other.test', path: '/' }
  ]

  it('reads cookies matching the request URL domain', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.test("get matches domain", () => { pm.expect(pm.cookies.get("sessionid")).to.equal("xyz") });
          pm.test("has matches domain", () => { pm.expect(pm.cookies.has("sessionid")).to.equal(true) });
          pm.test("ignores other domain", () => { pm.expect(pm.cookies.has("other")).to.equal(false) });
        `,
        cookies,
        url: 'https://api.example.com/v1'
      })
    )
    expect(res.tests.every((t) => t.passed)).toBe(true)
  })

  it('toObject returns matching cookies as a map', async () => {
    expect(
      await passes('pm.expect(pm.cookies.toObject().sessionid).to.equal("xyz")', {
        cookies,
        url: 'https://api.example.com/v1'
      })
    ).toBe(true)
  })

  it('jar().set and unset record cookieUpdates', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.cookies.jar().set({ name: "newc", value: "v1", domain: "example.com", path: "/" });
          pm.cookies.jar().unset({ name: "sessionid", domain: "example.com", path: "/" });
        `,
        cookies,
        url: 'https://api.example.com/v1'
      })
    )
    expect(res.cookieUpdates?.set).toEqual([
      { key: 'newc', value: 'v1', domain: 'example.com', path: '/', expires: undefined, httpOnly: undefined, secure: undefined }
    ])
    expect(res.cookieUpdates?.remove).toEqual([{ key: 'sessionid', domain: 'example.com', path: '/' }])
  })
})

describe('pm.sendRequest', () => {
  let server: Server
  let baseUrl = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          res.writeHead(201, { 'content-type': 'application/json', 'x-echo': 'yes' })
          res.end(JSON.stringify({ method: 'POST', received: body }))
        })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, method: req.method }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('performs a GET with a string URL and exposes a Postman-like response', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.sendRequest("${baseUrl}/get", function (err, r) {
            pm.test("no error", () => { pm.expect(err).to.equal(null) });
            pm.test("code 200", () => { pm.expect(r.code).to.equal(200) });
            pm.test("status text", () => { pm.expect(r.status).to.equal("OK") });
            pm.test("response time is a number", () => { pm.expect(typeof r.responseTime).to.equal("number") });
            pm.test("header getter", () => { pm.expect(r.headers.get("content-type")).to.include("application/json") });
            pm.test("json body", () => { pm.expect(r.json().ok).to.equal(true) });
          });
        `
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.tests.length).toBe(6)
    expect(res.tests.every((t) => t.passed)).toBe(true)
  })

  it('performs a POST with a raw body object', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.sendRequest({
            url: "${baseUrl}/post",
            method: "POST",
            header: { "Content-Type": "application/json" },
            body: { mode: "raw", raw: JSON.stringify({ a: 1 }) }
          }, function (err, r) {
            pm.test("created", () => { pm.expect(r.code).to.equal(201) });
            pm.test("echoed body", () => { pm.expect(r.json().received).to.equal('{"a":1}') });
          });
        `
      })
    )
    expect(res.tests.every((t) => t.passed)).toBe(true)
    expect(res.tests.length).toBe(2)
  })

  it('returns a promise when no callback is given', async () => {
    const res = await runSandbox(
      base({
        code: `
          pm.test("await works", async () => {
            const r = await pm.sendRequest("${baseUrl}/get");
            pm.expect(r.code).to.equal(200);
          });
        `
      })
    )
    expect(res.tests[0].passed).toBe(true)
  })
})

describe('buildSendRequestSpec', () => {
  it('carries the run settings into the spec', () => {
    // Regression: pm.sendRequest used a bare fetch, so «Проверять SSL» and the
    // CA bundle / proxy / client certs from Settings never applied and a script
    // fetching a token failed with SELF_SIGNED_CERT_IN_CHAIN.
    const settings: RequestSettings = {
      timeoutMs: 5000,
      followRedirects: false,
      maxRedirects: 0,
      rejectUnauthorized: false,
      caPath: 'C:/certs/corp.pem',
      proxy: { enabled: true, url: 'http://127.0.0.1:8888', bypass: [] }
    }
    const spec = buildSendRequestSpec('https://auth.internal/token', settings)
    expect(spec.settings).toEqual(settings)
    expect(spec.method).toBe('GET')
    expect(spec.url).toBe('https://auth.internal/token')
    expect(spec.body).toEqual({ type: 'none' })
  })

  it('defaults to strict TLS when a payload carries no settings', () => {
    expect(buildSendRequestSpec('https://example.com').settings.rejectUnauthorized).toBe(true)
  })

  it('maps method, headers and a raw body, in both argument shapes', () => {
    const fromObject = buildSendRequestSpec({
      url: 'https://auth.internal/token',
      method: 'post',
      header: { 'Content-Type': 'application/json' },
      body: { mode: 'raw', raw: '{"grant_type":"client_credentials"}' }
    })
    expect(fromObject.method).toBe('POST')
    expect(fromObject.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }])
    expect(fromObject.body).toEqual({ type: 'raw', language: 'text', text: '{"grant_type":"client_credentials"}' })

    const headerList = buildSendRequestSpec({
      url: 'https://x/y',
      method: 'PUT',
      header: [{ key: 'X-Api-Key', value: 'k' }],
      body: 'plain'
    })
    expect(headerList.headers).toEqual([{ key: 'X-Api-Key', value: 'k', enabled: true }])
    expect(headerList.body).toEqual({ type: 'raw', language: 'text', text: 'plain' })
  })

  it('drops a body a GET or HEAD cannot carry, and rejects a missing url', () => {
    expect(buildSendRequestSpec({ url: 'https://x/y', method: 'GET', body: 'nope' }).body).toEqual({ type: 'none' })
    expect(() => buildSendRequestSpec({ method: 'POST' })).toThrow(/URL is required/)
  })
})

describe('buildSendRequestSpec — Postman body modes', () => {
  it('sends a urlencoded list, the usual client_credentials call', () => {
    // Regression: only `raw` was understood, so this exact body went out empty
    // and the token endpoint answered 400.
    const spec = buildSendRequestSpec({
      url: 'https://auth.internal/passport/oauth2/token',
      method: 'POST',
      header: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: {
        mode: 'urlencoded',
        urlencoded: [
          { key: 'client_id', value: 'svc@app' },
          { key: 'client_secret', value: undefined },
          { key: 'grant_type', value: 'client_credentials' },
          { key: 'scope', value: 'x', disabled: true }
        ]
      }
    })
    expect(spec.body).toEqual({
      type: 'urlencoded',
      items: [
        { key: 'client_id', value: 'svc@app', enabled: true },
        // an unset global must not go out as the word "undefined"
        { key: 'client_secret', value: '', enabled: true },
        { key: 'grant_type', value: 'client_credentials', enabled: true },
        { key: 'scope', value: 'x', enabled: false }
      ]
    })
  })

  it('accepts urlencoded as a plain object or an encoded string', () => {
    expect(buildSendRequestSpec({ url: 'https://x', method: 'POST', body: { mode: 'urlencoded', urlencoded: { a: 1, b: 'two' } } }).body).toEqual({
      type: 'urlencoded',
      items: [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: 'two', enabled: true }
      ]
    })
    expect(buildSendRequestSpec({ url: 'https://x', method: 'POST', body: { mode: 'urlencoded', urlencoded: 'a=1&b=two%20words' } }).body).toEqual({
      type: 'urlencoded',
      items: [
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: 'two words', enabled: true }
      ]
    })
  })

  it('keeps the raw language, so JSON gets its Content-Type', () => {
    const spec = buildSendRequestSpec({
      url: 'https://x',
      method: 'POST',
      body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } }
    })
    expect(spec.body).toEqual({ type: 'raw', language: 'json', text: '{"a":1}' })
  })

  it('sends text form-data parts, never a file part, and drops a boundary-less multipart header', () => {
    const spec = buildSendRequestSpec({
      url: 'https://x',
      method: 'POST',
      header: { 'Content-Type': 'multipart/form-data' },
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'name', value: 'relay' },
          // a script (maybe from an imported collection) must not be able to
          // read a local file and upload it
          { key: 'steal', type: 'file', value: 'C:/Users/me/.ssh/id_rsa' }
        ]
      }
    })
    expect(spec.body).toEqual({ type: 'formdata', items: [{ key: 'name', value: 'relay', enabled: true, type: 'text' }] })
    expect(spec.headers).toEqual([])
  })

  it('maps a graphql body, with object variables serialised', () => {
    const spec = buildSendRequestSpec({
      url: 'https://x/graphql',
      method: 'POST',
      body: { mode: 'graphql', graphql: { query: '{ me { id } }', variables: { id: 7 } } }
    })
    expect(spec.body).toEqual({ type: 'graphql', query: '{ me { id } }', variables: '{"id":7}' })
  })
})

describe('pm.sendRequest end to end — the token script', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const form = new URLSearchParams(body)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            access_token: form.get('client_secret') === 's3cr3t' ? 'jwt-ok' : 'jwt-wrong',
            content_type: req.headers['content-type'],
            received: body
          })
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/passport/oauth2/token`
  })

  afterAll(() => {
    server.close()
  })

  it('posts the form and stores the token, written exactly as in Postman', async () => {
    const res = await runSandbox(
      base({
        phase: 'pre-request',
        response: undefined,
        globals: { 'adsd-if-epa_secret': 's3cr3t' },
        code: `
          const clientSecret = pm.globals.get("adsd-if-epa_secret");
          const postRequest = {
            url: '${url}',
            method: 'POST',
            header: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: {
              mode: 'urlencoded',
              urlencoded: [
                { key: 'client_id', value: 'adsd-if-epa@app.b2c.vtb.ru' },
                { key: 'client_secret', value: clientSecret },
                { key: 'grant_type', value: 'client_credentials' },
              ]
            }
          };
          pm.sendRequest(postRequest, (error, response) => {
            console.log(error ? error : response.json());
            responseToken = response.json().access_token
            pm.globals.set("depoAccessToken", "Bearer " + responseToken)
          });
        `
      })
    )
    expect(res.error).toBeUndefined()
    expect(res.globalUpdates.depoAccessToken).toBe('Bearer jwt-ok')
    const logged = JSON.parse(res.logs[0].message)
    expect(logged.content_type).toBe('application/x-www-form-urlencoded')
    expect(logged.received).toBe('client_id=adsd-if-epa%40app.b2c.vtb.ru&client_secret=s3cr3t&grant_type=client_credentials')
  })

  it('prints a transport error as its message, not as {}', async () => {
    // Port 1 on loopback refuses at once — no network needed.
    const res = await runSandbox(
      base({
        phase: 'pre-request',
        response: undefined,
        code: `pm.sendRequest("http://127.0.0.1:1/token", (error, response) => { console.log(error) })`
      })
    )
    expect(res.logs[0].message).toMatch(/^Error: .+/)
    expect(res.logs[0].message).not.toBe('{}')
  })

  it('prints an Error thrown inside the script realm by its message too', async () => {
    const res = await runSandbox(base({ phase: 'pre-request', response: undefined, code: `console.log(new TypeError("boom"))` }))
    expect(res.logs[0].message).toBe('TypeError: boom')
  })
})

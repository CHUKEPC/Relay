import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runSandbox } from './sandbox'
import type { RequestModel, ResponseResult, ScriptRunRequest, StoredCookie } from '@shared/types'

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

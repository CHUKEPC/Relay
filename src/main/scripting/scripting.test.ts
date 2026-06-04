import { describe, it, expect } from 'vitest'
import { runScript } from './index'
import type { RequestModel, ResponseResult, ScriptRunRequest } from '@shared/types'

const request: RequestModel = {
  id: 'r1',
  name: 'r',
  method: 'GET',
  url: 'https://x.test',
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
  body: { text: '{"data":[1,2,3],"name":"x"}', contentType: 'application/json', isBinary: false, sizeBytes: 27 },
  timings: { startedAt: 0, totalMs: 120 },
  redirects: [],
  finalUrl: 'https://x.test'
}

function base(partial: Partial<ScriptRunRequest>): ScriptRunRequest {
  return { phase: 'test', code: '', request, response, environment: {}, globals: {}, ...partial }
}

describe('pm.* scripting sandbox', () => {
  it('runs passing and failing tests', () => {
    const res = runScript(
      base({
        code: `
          pm.test("status is 200", () => { pm.response.to.have.status(200) });
          pm.test("has data array", () => { pm.expect(pm.response.json().data).to.be.an("array") });
          pm.test("this fails", () => { pm.expect(1).to.equal(2) });
        `
      })
    )
    expect(res.tests.find((t) => t.name === 'status is 200')?.passed).toBe(true)
    expect(res.tests.find((t) => t.name === 'has data array')?.passed).toBe(true)
    expect(res.tests.find((t) => t.name === 'this fails')?.passed).toBe(false)
  })

  it('captures console output', () => {
    const res = runScript(base({ code: 'console.log("hello", 42)' }))
    expect(res.logs[0].message).toContain('hello')
  })

  it('records environment variable updates', () => {
    const res = runScript(base({ code: 'pm.environment.set("token", "new-token")' }))
    expect(res.environmentUpdates.token).toBe('new-token')
  })

  it('supports expect chains and pm.response helpers', () => {
    const res = runScript(
      base({
        code: `
          pm.test("time below 300", () => { pm.expect(pm.response.responseTime).to.be.below(300) });
          pm.test("not 500", () => { pm.expect(pm.response.code).to.not.equal(500) });
          pm.test("name is string", () => { pm.expect(pm.response.json().name).to.be.a("string") });
        `
      })
    )
    expect(res.tests.every((t) => t.passed)).toBe(true)
  })

  it('blocks dangerous globals', () => {
    const res = runScript(base({ code: 'pm.test("no require", () => { pm.expect(typeof require).to.equal("undefined") })' }))
    expect(res.tests[0].passed).toBe(true)
  })

  it('applies request patches from pre-request scripts', () => {
    const res = runScript(base({ phase: 'pre-request', response: undefined, code: 'pm.request.headers.add({ key: "X-Trace", value: "1" })' }))
    expect(res.requestPatch?.headers?.some((h) => h.key === 'X-Trace')).toBe(true)
  })
})

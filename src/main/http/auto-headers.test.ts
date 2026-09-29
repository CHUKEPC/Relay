import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RequestSpec, RunOptions } from '@shared/types'
import { runRequest } from './engine'

/**
 * Automatic headers switched off in the Headers tab (`disabledAutoHeaders`)
 * must not reach the server — checked against a local echo server.
 */

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/login') {
      res.writeHead(302, { Location: '/echo', 'Set-Cookie': 'session=abc; Path=/' })
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const OPTS: RunOptions = { requestId: 'auto-headers' }

function spec(partial: Partial<RequestSpec>): RequestSpec {
  return {
    method: 'GET',
    url: `${base}/echo`,
    query: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    settings: { timeoutMs: 5000, followRedirects: true, maxRedirects: 5, rejectUnauthorized: true },
    ...partial
  }
}

async function echoed(s: RequestSpec): Promise<IncomingHttpHeaders> {
  const result = await runRequest(s, OPTS)
  expect(result.error).toBeUndefined()
  return (JSON.parse(result.body.text ?? '{}') as { headers: IncomingHttpHeaders }).headers
}

describe('disabledAutoHeaders', () => {
  it('sends the defaults when nothing is switched off', async () => {
    const h = await echoed(spec({}))
    expect(h['user-agent']).toMatch(/^Relay\//)
    expect(h['accept']).toBe('*/*')
    expect(h['accept-encoding']).toBe('gzip, deflate, br')
  })

  it('leaves out switched-off defaults, whatever the case of the stored name', async () => {
    const h = await echoed(spec({ disabledAutoHeaders: ['User-Agent', 'accept', 'ACCEPT-ENCODING'] }))
    expect(h['user-agent']).toBeUndefined()
    expect(h['accept']).toBeUndefined()
    expect(h['accept-encoding']).toBeUndefined()
    expect(h['host']).toBeDefined()
  })

  it('still sends a header the user wrote with the same name', async () => {
    const h = await echoed(
      spec({ disabledAutoHeaders: ['user-agent'], headers: [{ key: 'User-Agent', value: 'mine/2', enabled: true }] })
    )
    expect(h['user-agent']).toBe('mine/2')
  })

  it('drops the Content-Type derived from the body', async () => {
    const body: RequestSpec['body'] = { type: 'raw', language: 'json', text: '{"a":1}' }
    const on = await echoed(spec({ method: 'POST', body }))
    expect(on['content-type']).toBe('application/json')
    const off = await echoed(spec({ method: 'POST', body, disabledAutoHeaders: ['content-type'] }))
    expect(off['content-type']).toBeUndefined()
    expect(off['content-length']).toBe('7')
  })

  it('does not attach jar cookies, but keeps a Cookie header the user wrote', async () => {
    const withJar = await echoed(spec({ url: `${base}/login` }))
    expect(withJar['cookie']).toBe('session=abc')
    const noJar = await echoed(spec({ url: `${base}/login`, disabledAutoHeaders: ['cookie'] }))
    expect(noJar['cookie']).toBeUndefined()
    const own = await echoed(
      spec({ url: `${base}/login`, disabledAutoHeaders: ['cookie'], headers: [{ key: 'Cookie', value: 'mine=1', enabled: true }] })
    )
    expect(own['cookie']).toBe('mine=1')
  })
})

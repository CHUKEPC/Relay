import { describe, expect, it } from 'vitest'
import type { KV, RequestBody } from './types'
import { autoContentType, autoHeadersFor, disabledAutoHeaders } from './auto-headers'

const req = (url: string, body: RequestBody = { type: 'none' }, headers: KV[] = []) => ({ url, body, headers })

describe('autoHeadersFor', () => {
  it('lists Host, the defaults and Cookie for a bodiless request', () => {
    const list = autoHeadersFor(req('https://api.example.com:8443/v1'))
    expect(list.map((h) => h.name)).toEqual(['Host', 'User-Agent', 'Accept', 'Accept-Encoding', 'Cookie'])
    expect(list[0]).toMatchObject({ key: 'host', value: 'api.example.com:8443', locked: true })
    expect(list.find((h) => h.key === 'accept')).toMatchObject({ value: '*/*', locked: false, overridden: false })
  })

  it('adds Content-Type and a locked Content-Length when there is a body', () => {
    const list = autoHeadersFor(req('example.com', { type: 'raw', language: 'json', text: '{}' }))
    expect(list.find((h) => h.key === 'host')?.value).toBe('example.com')
    expect(list.find((h) => h.key === 'content-type')).toMatchObject({ value: 'application/json', locked: false })
    expect(list.find((h) => h.key === 'content-length')).toMatchObject({ value: null, locked: true })
  })

  it('locks the multipart Content-Type — the boundary lives in it', () => {
    const list = autoHeadersFor(req('https://x.test', { type: 'formdata', items: [] }))
    expect(list.find((h) => h.key === 'content-type')?.locked).toBe(true)
  })

  it('marks a header the request sets itself as overridden, ignoring disabled rows', () => {
    const list = autoHeadersFor(
      req('https://x.test', { type: 'none' }, [
        { key: 'user-agent', value: 'mine', enabled: true },
        { key: 'Accept', value: 'text/html', enabled: false }
      ])
    )
    expect(list.find((h) => h.key === 'user-agent')?.overridden).toBe(true)
    expect(list.find((h) => h.key === 'accept')?.overridden).toBe(false)
  })

  it('shows no host for a URL that does not parse', () => {
    expect(autoHeadersFor(req('http://'))[0].value).toBeNull()
  })
})

describe('autoContentType', () => {
  it('follows the body type', () => {
    expect(autoContentType({ type: 'none' })).toBeNull()
    expect(autoContentType({ type: 'urlencoded', items: [] })).toBe('application/x-www-form-urlencoded')
    expect(autoContentType({ type: 'graphql', query: '', variables: '' })).toBe('application/json')
    expect(autoContentType({ type: 'binary' })).toBeNull()
  })
})

describe('disabledAutoHeaders', () => {
  it('normalizes names and drops blanks', () => {
    expect([...disabledAutoHeaders([' User-Agent ', 'COOKIE', ''])]).toEqual(['user-agent', 'cookie'])
    expect(disabledAutoHeaders(undefined).size).toBe(0)
  })
})

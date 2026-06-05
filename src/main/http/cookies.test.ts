import { describe, it, expect } from 'vitest'
import type { StoredCookie } from '@shared/types'
import { buildCookieHeader, captureSetCookies } from './cookies'

const NOW = Date.parse('2030-01-01T00:00:00Z')

function cookie(p: Partial<StoredCookie> & Pick<StoredCookie, 'key' | 'value' | 'domain'>): StoredCookie {
  return { path: '/', ...p }
}

describe('buildCookieHeader', () => {
  it('sends cookies whose domain/path match the URL', () => {
    const jar = [
      cookie({ key: 'a', value: '1', domain: 'example.com', path: '/' }),
      cookie({ key: 'b', value: '2', domain: 'example.com', path: '/api' })
    ]
    expect(buildCookieHeader(jar, 'https://example.com/api/users', NOW)).toBe('a=1; b=2')
    expect(buildCookieHeader(jar, 'https://example.com/', NOW)).toBe('a=1') // /api cookie not on /
  })

  it('matches subdomains for domain cookies but not unrelated hosts', () => {
    const jar = [cookie({ key: 's', value: 'x', domain: 'example.com', path: '/' })]
    expect(buildCookieHeader(jar, 'https://api.example.com/', NOW)).toBe('s=x')
    expect(buildCookieHeader(jar, 'https://evil.com/', NOW)).toBe('')
  })

  it('does not send a Secure cookie over http', () => {
    const jar = [cookie({ key: 'sec', value: 'v', domain: 'example.com', path: '/', secure: true })]
    expect(buildCookieHeader(jar, 'http://example.com/', NOW)).toBe('')
    expect(buildCookieHeader(jar, 'https://example.com/', NOW)).toBe('sec=v')
  })

  it('omits expired cookies', () => {
    const jar = [
      cookie({ key: 'old', value: 'v', domain: 'example.com', expires: new Date(NOW - 1000).toISOString() }),
      cookie({ key: 'live', value: 'v', domain: 'example.com', expires: new Date(NOW + 100000).toISOString() })
    ]
    expect(buildCookieHeader(jar, 'https://example.com/', NOW)).toBe('live=v')
  })

  it('returns empty for an unparseable URL', () => {
    expect(buildCookieHeader([cookie({ key: 'a', value: '1', domain: 'x.com' })], 'not a url', NOW)).toBe('')
  })
})

describe('captureSetCookies', () => {
  it('captures a Set-Cookie with default host + path', () => {
    const { cookies, changed } = captureSetCookies([], 'https://example.com/api/v1', ['sid=abc'], NOW)
    expect(changed).toBe(true)
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({ key: 'sid', value: 'abc', domain: 'example.com', path: '/api' })
  })

  it('honors explicit Domain/Path/Secure attributes', () => {
    const { cookies } = captureSetCookies([], 'https://example.com/', ['t=1; Domain=.example.com; Path=/; Secure'], NOW)
    expect(cookies[0]).toMatchObject({ domain: 'example.com', path: '/', secure: true })
  })

  it('accepts a Domain that is a parent of the request host', () => {
    const { cookies } = captureSetCookies([], 'https://api.example.com/', ['t=1; Domain=example.com'], NOW)
    expect(cookies).toHaveLength(1)
    expect(cookies[0].domain).toBe('example.com')
  })

  it('rejects a cross-domain Set-Cookie (request host not within Domain)', () => {
    // attacker host tries to set a cookie for an unrelated domain
    const { cookies, changed } = captureSetCookies([], 'https://attacker.com/', ['evil=1; Domain=victim.com'], NOW)
    expect(changed).toBe(false)
    expect(cookies).toHaveLength(0)
  })

  it('rejects a bare-TLD Domain to avoid over-broad matching', () => {
    const { cookies } = captureSetCookies([], 'https://example.com/', ['t=1; Domain=com'], NOW)
    expect(cookies).toHaveLength(0)
  })

  it('upserts by (domain, path, key)', () => {
    const first = captureSetCookies([], 'https://example.com/', ['a=1'], NOW)
    const second = captureSetCookies(first.cookies, 'https://example.com/', ['a=2'], NOW)
    expect(second.cookies).toHaveLength(1)
    expect(second.cookies[0].value).toBe('2')
  })

  it('removes a cookie cleared via Max-Age=0', () => {
    const seeded = captureSetCookies([], 'https://example.com/', ['a=1'], NOW)
    const cleared = captureSetCookies(seeded.cookies, 'https://example.com/', ['a=; Max-Age=0'], NOW)
    expect(cleared.changed).toBe(true)
    expect(cleared.cookies).toHaveLength(0)
  })

  it('computes expiry from Max-Age', () => {
    const { cookies } = captureSetCookies([], 'https://example.com/', ['a=1; Max-Age=3600'], NOW)
    expect(Date.parse(cookies[0].expires!)).toBe(NOW + 3600 * 1000)
  })
})

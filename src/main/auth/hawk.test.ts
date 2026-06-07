import { describe, it, expect } from 'vitest'
import { hawkHeader, calculatePayloadHash, type HawkOptions } from './hawk'

/**
 * Canonical Hawk README ("Protocol Example") credentials. The key below is the
 * authentic value that produces the published MAC
 * "6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE=". (A shortened key variant exists
 * in some copies of the docs but does NOT match that MAC — verified against the
 * mozilla/hawk reference implementation.)
 */
const README_KEY = 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn'
const README_MAC = '6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE='

/**
 * Parse a Hawk `Authorization` header value into a map of its attributes.
 * Tolerates the `Hawk ` scheme prefix and double-quoted, comma-separated pairs.
 */
function parseHawkHeader(header: string): Record<string, string> {
  const scheme = 'Hawk '
  expect(header.startsWith(scheme)).toBe(true)
  const body = header.slice(scheme.length)

  const out: Record<string, string> = {}
  // Match key="value" pairs, allowing escaped quotes inside the value.
  const re = /(\w+)="((?:\\.|[^"\\])*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = m[2].replace(/\\(.)/g, '$1')
  }
  return out
}

describe('hawkHeader', () => {
  it('matches the Hawk README test vector (GET, no payload, sha256)', () => {
    const opts: HawkOptions = {
      id: 'dh37fgj492je',
      key: README_KEY,
      algorithm: 'sha256',
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'some-app-ext-data',
    }

    const header = hawkHeader(opts)
    const parsed = parseHawkHeader(header)

    expect(parsed.mac).toBe(README_MAC)

    // The other required attributes must be present and correct.
    expect(parsed.id).toBe('dh37fgj492je')
    expect(parsed.ts).toBe('1353832234')
    expect(parsed.nonce).toBe('j4h3g2')
    expect(parsed.ext).toBe('some-app-ext-data')

    // No payload was supplied, so there must be no payload hash.
    expect(parsed.hash).toBeUndefined()
  })

  it('includes a payload hash when a payload is supplied', () => {
    const opts: HawkOptions = {
      id: 'dh37fgj492je',
      key: README_KEY,
      algorithm: 'sha256',
      method: 'POST',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'some-app-ext-data',
      payload: 'Thank you for flying Hawk',
      contentType: 'text/plain',
    }

    const header = hawkHeader(opts)
    const parsed = parseHawkHeader(header)

    const expectedHash = calculatePayloadHash('sha256', opts.payload!, 'text/plain')
    expect(parsed.hash).toBe(expectedHash)
    // The MAC must change relative to the no-payload case because the hash line
    // is folded into the normalized string.
    expect(parsed.mac).not.toBe(README_MAC)
    expect(parsed.mac.length).toBeGreaterThan(0)
  })

  it('normalizes content-type (strips parameters, lower-cases) for the payload hash', () => {
    const withParams = calculatePayloadHash('sha256', 'body', 'TEXT/Plain; charset=utf-8')
    const plain = calculatePayloadHash('sha256', 'body', 'text/plain')
    expect(withParams).toBe(plain)
  })

  it('defaults the algorithm to sha256', () => {
    const base: HawkOptions = {
      id: 'dh37fgj492je',
      key: README_KEY,
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'some-app-ext-data',
    }
    const withDefault = parseHawkHeader(hawkHeader(base))
    const explicit = parseHawkHeader(hawkHeader({ ...base, algorithm: 'sha256' }))
    expect(withDefault.mac).toBe(explicit.mac)
    expect(withDefault.mac).toBe(README_MAC)
  })

  it('produces a different MAC for sha1 than sha256', () => {
    const base: HawkOptions = {
      id: 'dh37fgj492je',
      key: README_KEY,
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'some-app-ext-data',
    }
    const sha1 = parseHawkHeader(hawkHeader({ ...base, algorithm: 'sha1' }))
    const sha256 = parseHawkHeader(hawkHeader({ ...base, algorithm: 'sha256' }))
    expect(sha1.mac).not.toBe(sha256.mac)
  })

  it('resolves the default port from the scheme when none is given', () => {
    // https with no explicit port → port 443 is used in the normalized string,
    // so the MAC differs from an http (port 80) URL with the same path.
    const httpsHeader = parseHawkHeader(
      hawkHeader({
        id: 'dh37fgj492je',
        key: README_KEY,
        method: 'GET',
        url: 'https://example.com/resource/1?b=1&a=2',
        timestamp: 1353832234,
        nonce: 'j4h3g2',
      })
    )
    const httpHeader = parseHawkHeader(
      hawkHeader({
        id: 'dh37fgj492je',
        key: README_KEY,
        method: 'GET',
        url: 'http://example.com/resource/1?b=1&a=2',
        timestamp: 1353832234,
        nonce: 'j4h3g2',
      })
    )
    expect(httpsHeader.mac).not.toBe(httpHeader.mac)
  })

  it('includes app and dlg attributes for Oz delegation', () => {
    const header = hawkHeader({
      id: 'dh37fgj492je',
      key: README_KEY,
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      app: 'my-app',
      dlg: 'my-dlg',
    })
    const parsed = parseHawkHeader(header)
    expect(parsed.app).toBe('my-app')
    expect(parsed.dlg).toBe('my-dlg')
  })

  it('omits ext from the header when not provided', () => {
    const header = hawkHeader({
      id: 'dh37fgj492je',
      key: README_KEY,
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
    })
    expect(parseHawkHeader(header).ext).toBeUndefined()
  })

  it('escapes special characters in attribute values', () => {
    const header = hawkHeader({
      id: 'dh37fgj492je',
      key: README_KEY,
      method: 'GET',
      url: 'http://example.com:8000/resource/1?b=1&a=2',
      timestamp: 1353832234,
      nonce: 'j4h3g2',
      ext: 'has "quotes" and \\backslash',
    })
    const parsed = parseHawkHeader(header)
    expect(parsed.ext).toBe('has "quotes" and \\backslash')
  })

  it('throws on missing required fields', () => {
    const ok: HawkOptions = {
      id: 'x',
      key: 'y',
      method: 'GET',
      url: 'http://example.com/',
    }
    expect(() => hawkHeader({ ...ok, id: '' })).toThrow(/id/)
    expect(() => hawkHeader({ ...ok, key: '' })).toThrow(/key/)
    expect(() => hawkHeader({ ...ok, method: '' })).toThrow(/method/)
    expect(() => hawkHeader({ ...ok, url: '' })).toThrow(/url/)
    expect(() => hawkHeader({ ...ok, url: 'not a url' })).toThrow(/invalid url/)
  })

  it('uppercases the HTTP method before signing', () => {
    const lower = parseHawkHeader(
      hawkHeader({
        id: 'dh37fgj492je',
        key: README_KEY,
        method: 'get',
        url: 'http://example.com:8000/resource/1?b=1&a=2',
        timestamp: 1353832234,
        nonce: 'j4h3g2',
        ext: 'some-app-ext-data',
      })
    )
    // Equals the canonical README vector, proving "get" was normalized to "GET".
    expect(lower.mac).toBe(README_MAC)
  })
})

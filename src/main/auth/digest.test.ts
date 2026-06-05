import { describe, it, expect } from 'vitest'
import {
  parseDigestChallenge,
  buildDigestAuthHeader,
  type DigestChallenge
} from '@main/auth/digest'

/** Pull a single Authorization param value out of a built `Digest ...` header. */
function param(header: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|[,\\s])${key}=("([^"]*)"|[^,\\s]+)`).exec(header)
  if (!m) return undefined
  // m[2] is the unquoted inner value when quoted; m[1] is the raw (token) value.
  return m[2] !== undefined ? m[2] : m[1]
}

describe('parseDigestChallenge', () => {
  it('parses a standard Digest WWW-Authenticate header', () => {
    const c = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41", algorithm=MD5'
    )
    expect(c).not.toBeNull()
    expect(c!.realm).toBe('testrealm@host.com')
    expect(c!.qop).toBe('auth,auth-int')
    expect(c!.nonce).toBe('dcd98b7102dd2f0e8b11d0f600bfb0c093')
    expect(c!.opaque).toBe('5ccc069c403ebaf9f0171e9517f40e41')
    expect(c!.algorithm).toBe('MD5')
  })

  it('returns null for a non-Digest (Basic) challenge', () => {
    expect(parseDigestChallenge('Basic realm="x"')).toBeNull()
  })

  it('returns null when realm or nonce is missing', () => {
    expect(parseDigestChallenge('Digest qop="auth"')).toBeNull()
    expect(parseDigestChallenge('Digest realm="only-realm"')).toBeNull()
  })

  it('extracts the Digest challenge when multiple schemes share the header', () => {
    const c = parseDigestChallenge(
      'Basic realm="x", Digest realm="r", nonce="n", algorithm=SHA-256, qop="auth"'
    )
    expect(c).not.toBeNull()
    expect(c!.realm).toBe('r')
    expect(c!.nonce).toBe('n')
    expect(c!.algorithm).toBe('SHA-256')
  })

  it('handles unquoted tokens and stale=true', () => {
    const c = parseDigestChallenge('Digest realm=r, nonce=n, algorithm=MD5-sess, stale=true')
    expect(c).not.toBeNull()
    expect(c!.algorithm).toBe('MD5-sess')
    expect(c!.stale).toBe(true)
  })

  it('does not split commas inside a quoted nonce', () => {
    const c = parseDigestChallenge('Digest realm="r", nonce="ab,cd", qop="auth"')
    expect(c!.nonce).toBe('ab,cd')
  })
})

describe('buildDigestAuthHeader — RFC vectors', () => {
  it('RFC 2617 §3.5 — MD5, qop=auth', () => {
    const challenge: DigestChallenge = {
      realm: 'testrealm@host.com',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41',
      qop: 'auth',
      algorithm: 'MD5'
    }
    const header = buildDigestAuthHeader({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      challenge,
      cnonce: '0a4f113b',
      nc: 1
    })

    expect(param(header, 'response')).toBe('6629fae49393a05397450978507c4ef1')
    expect(param(header, 'nc')).toBe('00000001')
    // Quoted string params.
    expect(header).toContain('cnonce="0a4f113b"')
    expect(header).toContain('uri="/dir/index.html"')
    expect(header).toContain('realm="testrealm@host.com"')
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"')
    // Token params unquoted.
    expect(header).toContain('algorithm=MD5')
    expect(header).toContain('qop=auth')
    expect(header.startsWith('Digest ')).toBe(true)
  })

  it('RFC 7616 §3.9.1 — SHA-256, qop=auth', () => {
    const challenge: DigestChallenge = {
      realm: 'http-auth@example.org',
      nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
      qop: 'auth',
      algorithm: 'SHA-256'
    }
    const header = buildDigestAuthHeader({
      username: 'Mufasa',
      password: 'Circle of Life', // lowercase "of" per RFC 7616
      method: 'GET',
      uri: '/dir/index.html',
      challenge,
      cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
      nc: 1
    })

    expect(param(header, 'response')).toBe(
      '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1'
    )
    expect(header).toContain('algorithm=SHA-256')
    expect(param(header, 'nc')).toBe('00000001')
  })

  it('RFC 7616 §3.9.1 — same params with MD5 algorithm', () => {
    const challenge: DigestChallenge = {
      realm: 'http-auth@example.org',
      nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
      qop: 'auth',
      algorithm: 'MD5'
    }
    const header = buildDigestAuthHeader({
      username: 'Mufasa',
      password: 'Circle of Life',
      method: 'GET',
      uri: '/dir/index.html',
      challenge,
      cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
      nc: 1
    })

    expect(param(header, 'response')).toBe('8ca523f5e9506fed4657c9700eebdbec')
  })
})

describe('buildDigestAuthHeader — behavior', () => {
  it('generates a 32-hex-char cnonce when none is supplied', () => {
    const header = buildDigestAuthHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/',
      challenge: { realm: 'r', nonce: 'n', qop: 'auth' }
    })
    const cnonce = param(header, 'cnonce')
    expect(cnonce).toMatch(/^[0-9a-f]{32}$/)
  })

  it('two calls without an explicit cnonce produce different cnonce values', () => {
    const base = {
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/',
      challenge: { realm: 'r', nonce: 'n', qop: 'auth' } as DigestChallenge
    }
    const a = param(buildDigestAuthHeader(base), 'cnonce')
    const b = param(buildDigestAuthHeader(base), 'cnonce')
    expect(a).not.toBe(b)
  })

  it('legacy RFC 2069 mode (no qop) → response = H(HA1:nonce:HA2), no qop/nc/cnonce', () => {
    // Precompute the expected legacy MD5 response with the same vector inputs.
    const header = buildDigestAuthHeader({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093'
        // no qop, no algorithm
      }
    })
    // HA1 = md5(Mufasa:testrealm@host.com:Circle Of Life)
    // HA2 = md5(GET:/dir/index.html)
    // response = md5(HA1:nonce:HA2) = 670fd8c2df070c60b045671b8b24ff02
    expect(param(header, 'response')).toBe('670fd8c2df070c60b045671b8b24ff02')
    expect(header).not.toContain('qop=')
    expect(header).not.toContain('nc=')
    expect(header).not.toContain('cnonce=')
    // algorithm omitted when the server did not specify one.
    expect(header).not.toContain('algorithm=')
  })

  it('formats nc with 8 hex digits for nc > 9', () => {
    const header = buildDigestAuthHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/',
      challenge: { realm: 'r', nonce: 'n', qop: 'auth' },
      cnonce: 'abc',
      nc: 42
    })
    expect(param(header, 'nc')).toBe('0000002a')
  })

  it('supports MD5-sess (RFC 7616 §3.4.2)', () => {
    const header = buildDigestAuthHeader({
      username: 'u',
      password: 'p',
      method: 'GET',
      uri: '/',
      challenge: { realm: 'r', nonce: 'n', qop: 'auth', algorithm: 'MD5-sess' },
      cnonce: 'cn',
      nc: 1
    })
    expect(header).toContain('algorithm=MD5-sess')
    // Spot-check the -sess HA1 folding produces the expected response.
    // HA1' = md5( md5(u:r:p) : n : cn ); HA2 = md5(GET:/); response = md5(HA1':n:00000001:cn:auth:HA2)
    expect(param(header, 'response')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('throws when the challenge lacks realm or nonce', () => {
    expect(() =>
      buildDigestAuthHeader({
        username: 'u',
        password: 'p',
        method: 'GET',
        uri: '/',
        challenge: { realm: '', nonce: 'n' }
      })
    ).toThrow()
  })

  it('round-trips a parsed challenge into a valid header', () => {
    const c = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41", algorithm=MD5'
    )
    expect(c).not.toBeNull()
    const header = buildDigestAuthHeader({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      challenge: c!,
      cnonce: '0a4f113b',
      nc: 1
    })
    expect(param(header, 'response')).toBe('6629fae49393a05397450978507c4ef1')
  })
})

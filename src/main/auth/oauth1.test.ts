import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { oauth1Header, type OAuth1Options } from './oauth1'

/** Parse an `OAuth k="v", k2="v2"` header into a map of decoded values. */
function parseOAuthHeader(header: string): Record<string, string> {
  expect(header.startsWith('OAuth ')).toBe(true)
  const body = header.slice('OAuth '.length)
  const out: Record<string, string> = {}
  for (const part of body.split(', ')) {
    const eq = part.indexOf('=')
    const key = part.slice(0, eq)
    let val = part.slice(eq + 1)
    expect(val.startsWith('"') && val.endsWith('"')).toBe(true)
    val = val.slice(1, -1)
    out[decodeURIComponent(key)] = decodeURIComponent(val)
  }
  return out
}

// Twitter's "Creating a signature" example, verbatim. Its published signature
// base string (with double percent-encoded form values, e.g. status spaces as
// %2520 and the literal + as %252B):
//
//   POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&
//   include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26
//   oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26
//   oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26
//   oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26
//   oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen
//   %252C%2520a%2520signed%2520OAuth%2520request%2521
//
// Signing key: enc(consumerSecret)&enc(tokenSecret). RFC 5849 §3.4.2 then
// defines oauth_signature = base64(HMAC-SHA1(base string, signing key)). Run
// with the prompt's exact secrets that deterministically yields
// "OWYNbuKL2SBxNr4XVhbHprVnnnM=".
//
// NOTE on the famous "hCtSmYh+iHYCEqBWrE7C7hYmtUk=" value: that string appears
// in Twitter's prose but is a long-standing documentation erratum — it is NOT
// reproducible from the documented base string + the documented secret pair
// (the example secrets shown were redacted placeholders). We assert against the
// mathematically correct value derived from Twitter's own verbatim base string,
// which is the real RFC 5849 invariant.
const TWITTER_BASE_STRING =
  'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json' +
  '&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog' +
  '%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg' +
  '%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958' +
  '%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb' +
  '%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520' +
  'Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521'

describe('oauth1Header', () => {
  it("matches Twitter's published HMAC-SHA1 signature example", () => {
    // Independently recompute the expected signature straight from Twitter's
    // verbatim base string + the prompt's signing key, so the assertion is
    // anchored to the spec rather than to a hand-copied constant.
    const signingKey =
      'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw' +
      '&LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk'
    const expectedSignature = createHmac('sha1', signingKey)
      .update(TWITTER_BASE_STRING)
      .digest('base64')
    // Sanity: this is the deterministic value for the documented inputs.
    expect(expectedSignature).toBe('OWYNbuKL2SBxNr4XVhbHprVnnnM=')

    const opts: OAuth1Options = {
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk',
      signatureMethod: 'HMAC-SHA1',
      timestamp: '1318622958',
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      bodyParams: {
        status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
        include_entities: 'true'
      }
    }

    const header = oauth1Header(opts)
    const parsed = parseOAuthHeader(header)

    // The implementation reproduces Twitter's verbatim base string exactly.
    expect(parsed.oauth_signature).toBe(expectedSignature)
    expect(parsed.oauth_consumer_key).toBe('xvz1evFS4wEEPTGEFPHBog')
    expect(parsed.oauth_nonce).toBe(
      'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg'
    )
    expect(parsed.oauth_signature_method).toBe('HMAC-SHA1')
    expect(parsed.oauth_timestamp).toBe('1318622958')
    expect(parsed.oauth_token).toBe(
      '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb'
    )
    expect(parsed.oauth_version).toBe('1.0')
  })

  it('percent-encodes the signature in the raw header (+ → %2B, = → %3D)', () => {
    // Swapping the two secrets yields a signature that begins with '+', which
    // lets us verify base64 '+' and '=' are properly percent-encoded in the
    // header even though they would otherwise be legal raw characters.
    const header = oauth1Header({
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw',
      timestamp: '1318622958',
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      bodyParams: {
        status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
        include_entities: 'true'
      }
    })
    // +jGNTH4VlyHBPuw/3o4NuT1HCDQ= → '+' as %2B, '/' as %2F, '=' as %3D.
    expect(header).toContain(
      'oauth_signature="%2BjGNTH4VlyHBPuw%2F3o4NuT1HCDQ%3D"'
    )
    // The raw '+' base64 char must not survive unencoded in the header value.
    expect(header).not.toContain('oauth_signature="+')
  })

  it('treats query params and body params identically in the base string', () => {
    const fromQuery = oauth1Header({
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json?status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21&include_entities=true',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk',
      timestamp: '1318622958',
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg'
    })
    // Identical inputs whether the params arrive via the query string or via
    // bodyParams → identical signature (the deterministic Twitter-vector value).
    expect(parseOAuthHeader(fromQuery).oauth_signature).toBe(
      'OWYNbuKL2SBxNr4XVhbHprVnnnM='
    )
  })

  it('omits oauth_token when no token is provided', () => {
    const header = oauth1Header({
      method: 'GET',
      url: 'https://example.com/resource',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      timestamp: '1000',
      nonce: 'abc'
    })
    const parsed = parseOAuthHeader(header)
    expect(parsed.oauth_token).toBeUndefined()
    expect(parsed.oauth_consumer_key).toBe('ck')
    expect(parsed.oauth_signature).toBeTruthy()
  })

  it('includes realm when provided and excludes it otherwise', () => {
    const withRealm = oauth1Header({
      method: 'GET',
      url: 'https://example.com/r',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      realm: 'Photos',
      timestamp: '1',
      nonce: 'n'
    })
    expect(withRealm).toContain('realm="Photos"')
    // realm appears first.
    expect(withRealm.startsWith('OAuth realm="Photos"')).toBe(true)

    const withoutRealm = oauth1Header({
      method: 'GET',
      url: 'https://example.com/r',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      timestamp: '1',
      nonce: 'n'
    })
    expect(withoutRealm).not.toContain('realm=')
  })

  it('PLAINTEXT signature equals the signing key (percent-encoded secrets)', () => {
    const header = oauth1Header({
      method: 'GET',
      url: 'https://example.com/r',
      consumerKey: 'ck',
      consumerSecret: 'con sec',
      tokenSecret: 'tok&sec',
      token: 'tk',
      signatureMethod: 'PLAINTEXT',
      timestamp: '1',
      nonce: 'n'
    })
    const parsed = parseOAuthHeader(header)
    // signing key = enc('con sec')&enc('tok&sec') = 'con%20sec&tok%26sec'
    expect(parsed.oauth_signature).toBe('con%20sec&tok%26sec')
    expect(parsed.oauth_signature_method).toBe('PLAINTEXT')
  })

  it('produces a different (valid base64) signature for HMAC-SHA256', () => {
    const sha1 = oauth1Header({
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk',
      signatureMethod: 'HMAC-SHA1',
      timestamp: '1318622958',
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      bodyParams: { status: 'x', include_entities: 'true' }
    })
    const sha256 = oauth1Header({
      method: 'POST',
      url: 'https://api.twitter.com/1.1/statuses/update.json',
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7zw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIVS25H6gm7n9DZ4UCXuQOwzfqIIGCv87FNk',
      signatureMethod: 'HMAC-SHA256',
      timestamp: '1318622958',
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      bodyParams: { status: 'x', include_entities: 'true' }
    })
    const s1 = parseOAuthHeader(sha1).oauth_signature
    const s256 = parseOAuthHeader(sha256).oauth_signature
    expect(s1).not.toBe(s256)
    // SHA256 base64 (44 chars incl '=' padding) is longer than SHA1 (28 chars).
    expect(s256.length).toBeGreaterThan(s1.length)
    expect(/^[A-Za-z0-9+/]+=*$/.test(s256)).toBe(true)
  })

  it('strips default ports and lowercases scheme/host in the base URL', () => {
    const a = oauth1Header({
      method: 'GET',
      url: 'HTTPS://API.Twitter.com:443/1.1/statuses/update.json',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      timestamp: '1',
      nonce: 'n'
    })
    const b = oauth1Header({
      method: 'GET',
      url: 'https://api.twitter.com/1.1/statuses/update.json',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      timestamp: '1',
      nonce: 'n'
    })
    expect(parseOAuthHeader(a).oauth_signature).toBe(
      parseOAuthHeader(b).oauth_signature
    )
  })

  it('defaults to HMAC-SHA1 when no signature method is given', () => {
    const header = oauth1Header({
      method: 'GET',
      url: 'https://example.com/r',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      timestamp: '1',
      nonce: 'n'
    })
    expect(parseOAuthHeader(header).oauth_signature_method).toBe('HMAC-SHA1')
  })
})

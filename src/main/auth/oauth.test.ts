import { describe, it, expect } from 'vitest'
import { buildTokenRequest } from './oauth'
import type { OAuthTokenRequest } from '@shared/types'

/** Parse the urlencoded body the helper produced into a flat record. */
function parseBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries())
}

const base: Pick<OAuthTokenRequest, 'tokenUrl' | 'clientId'> = {
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'my-client'
}

describe('buildTokenRequest', () => {
  it('client_credentials sends client id/secret in the body by default', () => {
    const { body, headers } = buildTokenRequest({
      ...base,
      grant: 'client_credentials',
      clientSecret: 's3cr3t',
      scope: 'read write'
    })
    const p = parseBody(body)
    expect(p.grant_type).toBe('client_credentials')
    expect(p.client_id).toBe('my-client')
    expect(p.client_secret).toBe('s3cr3t')
    expect(p.scope).toBe('read write')
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers.Authorization).toBeUndefined()
  })

  it('clientAuth=basic moves credentials into an HTTP Basic header', () => {
    const { body, headers } = buildTokenRequest({
      ...base,
      grant: 'client_credentials',
      clientSecret: 's3cr3t',
      clientAuth: 'basic'
    })
    const p = parseBody(body)
    expect(p.client_id).toBeUndefined()
    expect(p.client_secret).toBeUndefined()
    const expected = `Basic ${Buffer.from('my-client:s3cr3t', 'utf8').toString('base64')}`
    expect(headers.Authorization).toBe(expected)
  })

  it('refresh_token grant emits grant_type + refresh_token', () => {
    const { body } = buildTokenRequest({
      ...base,
      grant: 'refresh_token',
      refreshToken: 'rt-123'
    })
    const p = parseBody(body)
    expect(p.grant_type).toBe('refresh_token')
    expect(p.refresh_token).toBe('rt-123')
    expect(p.client_id).toBe('my-client')
  })

  it('authorization_code with PKCE includes code_verifier', () => {
    const { body } = buildTokenRequest({
      ...base,
      grant: 'authorization_code',
      code: 'auth-code',
      redirectUri: 'https://app.example.com/cb',
      codeVerifier: 'verifier-abc'
    })
    const p = parseBody(body)
    expect(p.grant_type).toBe('authorization_code')
    expect(p.code).toBe('auth-code')
    expect(p.redirect_uri).toBe('https://app.example.com/cb')
    expect(p.code_verifier).toBe('verifier-abc')
  })

  it('authorization_code without PKCE omits code_verifier', () => {
    const { body } = buildTokenRequest({
      ...base,
      grant: 'authorization_code',
      code: 'auth-code'
    })
    const p = parseBody(body)
    expect(p.code_verifier).toBeUndefined()
  })

  it('device_code uses the RFC 8628 grant URI and device_code param', () => {
    const { body } = buildTokenRequest({
      ...base,
      grant: 'device_code',
      deviceCode: 'dev-code-xyz'
    })
    const p = parseBody(body)
    expect(p.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(p.device_code).toBe('dev-code-xyz')
  })

  it('password grant sends username/password', () => {
    const { body } = buildTokenRequest({
      ...base,
      grant: 'password',
      username: 'alice',
      password: 'pw'
    })
    const p = parseBody(body)
    expect(p.grant_type).toBe('password')
    expect(p.username).toBe('alice')
    expect(p.password).toBe('pw')
  })

  it('basic auth with empty secret still encodes client_id:', () => {
    const { headers } = buildTokenRequest({
      ...base,
      grant: 'client_credentials',
      clientAuth: 'basic'
    })
    const expected = `Basic ${Buffer.from('my-client:', 'utf8').toString('base64')}`
    expect(headers.Authorization).toBe(expected)
  })
})

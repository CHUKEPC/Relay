import { describe, it, expect } from 'vitest'
import { parseCurl, tokenizeCurl } from './curl'

describe('cURL parser', () => {
  it('tokenizes quoted args and line continuations', () => {
    const tokens = tokenizeCurl('curl -H "A: b c" \\\n  --data \'{"x":1}\'')
    expect(tokens).toEqual(['curl', '-H', 'A: b c', '--data', '{"x":1}'])
  })

  it('parses method, headers and JSON body', () => {
    const { request } = parseCurl(`curl -X POST "https://api.test/v1/orders" -H "Content-Type: application/json" -H "Authorization: Bearer xyz" -d '{"amount":42}'`)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.test/v1/orders')
    expect(request.headers.find((h) => h.key === 'Content-Type')?.value).toBe('application/json')
    expect(request.body.type).toBe('raw')
    if (request.body.type === 'raw') expect(request.body.language).toBe('json')
    expect(request.auth.type).toBe('bearer')
  })

  it('infers POST when data is present', () => {
    const { request } = parseCurl('curl https://x.test -d "a=1&b=2"')
    expect(request.method).toBe('POST')
    expect(request.body.type).toBe('urlencoded')
  })

  it('parses basic auth and form fields', () => {
    const { request } = parseCurl('curl -u user:pass -F "file=@/tmp/a.txt" -F "name=demo" https://x.test/upload')
    expect(request.auth.type).toBe('basic')
    expect(request.body.type).toBe('formdata')
    if (request.body.type === 'formdata') {
      expect(request.body.items.find((i) => i.key === 'file')?.type).toBe('file')
      expect(request.body.items.find((i) => i.key === 'name')?.value).toBe('demo')
    }
  })
})

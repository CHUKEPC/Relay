import { describe, it, expect } from 'vitest'
import { importHar, isHar } from './har'

function firstRequest(node: any): any {
  for (const c of node.children ?? []) {
    if (c.type === 'request') return c.request
    const r = firstRequest(c)
    if (r) return r
  }
  return null
}

const HAR = {
  log: {
    version: '1.2',
    creator: { name: 'Test', version: '1.0' },
    entries: [
      {
        request: {
          method: 'GET',
          url: 'https://api.test/v1/users?page=2&limit=10',
          headers: [
            { name: 'Accept', value: 'application/json' },
            { name: ':authority', value: 'api.test' } // pseudo-header, must be dropped
          ],
          queryString: [
            { name: 'page', value: '2' },
            { name: 'limit', value: '10' }
          ]
        }
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.test/v1/users',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          queryString: [],
          postData: { mimeType: 'application/json', text: '{"name":"Ada"}' }
        }
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.test/v1/login',
          headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
          postData: {
            mimeType: 'application/x-www-form-urlencoded',
            params: [
              { name: 'user', value: 'ada' },
              { name: 'pass', value: 'secret' }
            ]
          }
        }
      }
    ]
  }
}

describe('HAR import', () => {
  it('detects a HAR document by log.entries[]', () => {
    expect(isHar(HAR)).toBe(true)
    expect(isHar({ log: {} })).toBe(false)
    expect(isHar({ info: {}, item: [] })).toBe(false)
  })

  it('imports all entries into one "Imported (HAR)" collection', () => {
    const { collection } = importHar(HAR)
    expect(collection.name).toBe('Imported (HAR)')
    expect(collection.children).toHaveLength(3)
  })

  it('keeps method, base url (no query), and parses queryString', () => {
    const { collection } = importHar(HAR)
    const req = firstRequest(collection)
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://api.test/v1/users')
    expect(req.query.map((q: any) => `${q.key}=${q.value}`)).toEqual(['page=2', 'limit=10'])
  })

  it('drops HTTP/2 pseudo-headers', () => {
    const { collection } = importHar(HAR)
    const req = firstRequest(collection)
    expect(req.headers.some((h: any) => h.key.startsWith(':'))).toBe(false)
    expect(req.headers.map((h: any) => h.key)).toContain('Accept')
  })

  it('imports a JSON body as raw json and a urlencoded body as urlencoded', () => {
    const { collection } = importHar(HAR)
    const jsonReq = collection.children[1] as any
    expect(jsonReq.request.body).toEqual({ type: 'raw', language: 'json', text: '{"name":"Ada"}' })

    const formReq = collection.children[2] as any
    expect(formReq.request.body.type).toBe('urlencoded')
    expect(formReq.request.body.items.map((i: any) => `${i.key}=${i.value}`)).toEqual(['user=ada', 'pass=secret'])
  })
})

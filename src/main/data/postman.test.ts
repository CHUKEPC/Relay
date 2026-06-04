import { describe, it, expect } from 'vitest'
import { importPostmanCollection } from './postman'

/** Find the first request anywhere in an imported collection tree. */
function firstRequest(node: any): any {
  for (const c of node.children ?? []) {
    if (c.type === 'request') return c.request
    const r = firstRequest(c)
    if (r) return r
  }
  return null
}

describe('Postman import', () => {
  it('keeps the query out of the base URL so it is not sent twice', () => {
    const col = importPostmanCollection({
      info: { name: 'C' },
      item: [
        {
          name: 'r',
          request: {
            method: 'GET',
            url: { raw: 'https://api.test/v1?a=1', host: ['api', 'test'], path: ['v1'], query: [{ key: 'a', value: '1' }] }
          }
        }
      ]
    })
    const req = firstRequest(col)
    expect(req.url).toBe('https://api.test/v1')
    expect(req.query.map((q: any) => `${q.key}=${q.value}`)).toEqual(['a=1'])
  })

  it('reconstructs protocol/port/path when raw is missing', () => {
    const col = importPostmanCollection({
      info: { name: 'C' },
      item: [
        {
          name: 'r',
          request: { method: 'GET', url: { protocol: 'https', host: ['api', 'test'], port: '8080', path: ['v1', 'users'] } }
        }
      ]
    })
    const req = firstRequest(col)
    expect(req.url).toBe('https://api.test:8080/v1/users')
  })
})

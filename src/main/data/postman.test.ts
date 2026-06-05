import { describe, it, expect } from 'vitest'
import { importPostmanCollection, exportPostmanCollection } from './postman'
import type { CollectionFolderNode, RequestModel } from '@shared/types'

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

  it('recovers active raw query params even when query[] holds only disabled entries', () => {
    const col = importPostmanCollection({
      info: { name: 'C' },
      item: [
        {
          name: 'r',
          request: {
            method: 'GET',
            url: { raw: 'https://api/x?a=1&debug=1', host: ['api'], path: ['x'], query: [{ key: 'debug', value: '1', disabled: true }] }
          }
        }
      ]
    })
    const req = firstRequest(col)
    expect(req.url).toBe('https://api/x')
    expect(req.query.find((q: any) => q.key === 'a')?.value).toBe('1') // recovered from raw
    expect(req.query.filter((q: any) => q.key === 'debug').length).toBe(1) // not duplicated
  })

  it('imports OAuth2 auth instead of dropping it to inherit', () => {
    const col = importPostmanCollection({
      info: { name: 'C' },
      item: [
        {
          name: 'r',
          request: {
            method: 'GET',
            url: 'https://api/x',
            auth: {
              type: 'oauth2',
              oauth2: [
                { key: 'accessToken', value: 'tok123' },
                { key: 'grant_type', value: 'client_credentials' },
                { key: 'accessTokenUrl', value: 'https://auth/token' }
              ]
            }
          }
        }
      ]
    })
    const req = firstRequest(col)
    expect(req.auth.type).toBe('oauth2')
    expect(req.auth.accessToken).toBe('tok123')
    expect(req.auth.tokenUrl).toBe('https://auth/token')
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

  it('imports saved responses into request.examples', () => {
    const col = importPostmanCollection({
      info: { name: 'C' },
      item: [
        {
          name: 'r',
          request: { method: 'GET', url: 'https://api/x' },
          response: [
            {
              name: 'Success',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '{"ok":true}'
            }
          ]
        }
      ]
    })
    const req = firstRequest(col)
    expect(req.examples).toHaveLength(1)
    expect(req.examples[0].name).toBe('Success')
    expect(req.examples[0].status).toBe(200)
    expect(req.examples[0].contentType).toBe('application/json')
    expect(req.examples[0].body).toBe('{"ok":true}')
  })
})

describe('Postman examples round-trip', () => {
  it('exports examples to item.response[] and re-imports them losslessly', () => {
    const request: RequestModel = {
      id: 'req1',
      name: 'Get user',
      method: 'GET',
      url: 'https://api/users/1',
      query: [],
      headers: [],
      pathVariables: [],
      body: { type: 'none' },
      auth: { type: 'none' },
      examples: [
        {
          id: 'ex1',
          name: 'Found',
          status: 200,
          headers: [['Content-Type', 'application/json']],
          body: '{"id":1}',
          contentType: 'application/json'
        },
        {
          id: 'ex2',
          name: 'Missing',
          status: 404,
          headers: [['Content-Type', 'application/json']],
          body: '{"error":"not found"}',
          contentType: 'application/json'
        }
      ]
    }
    const collection: CollectionFolderNode = {
      id: 'c1',
      type: 'collection',
      name: 'C',
      children: [{ id: 'req1', type: 'request', request }]
    }

    const exported = exportPostmanCollection(collection)
    const item = exported.item[0]
    expect(item.response).toHaveLength(2)
    expect(item.response[0]).toMatchObject({ name: 'Found', code: 200, status: 'OK' })
    expect(item.response[0]._postman_previewlanguage).toBe('json')

    // Re-import the exported JSON and confirm examples survive.
    const reimported = importPostmanCollection(exported)
    const req = firstRequest(reimported)
    expect(req.examples).toHaveLength(2)
    expect(req.examples[1]).toMatchObject({ name: 'Missing', status: 404, contentType: 'application/json' })
    expect(req.examples[0].body).toBe('{"id":1}')
  })
})

/**
 * Every auth scheme Relay supports has a native Postman shape. A scheme that
 * did not survive export came back as "inherit" — the request then quietly used
 * its parent's credentials — so each one is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { exportPostmanCollection, importPostmanCollection } from './postman'
import type { Auth, CollectionFolderNode, RequestModel } from '@shared/types'

function collectionWith(auth: Auth): CollectionFolderNode {
  const request: RequestModel = {
    id: 'r1',
    name: 'signed',
    method: 'GET',
    url: 'https://api.example.com/items',
    query: [],
    headers: [],
    pathVariables: [],
    body: { type: 'none' },
    auth
  }
  return { id: 'c1', type: 'collection', name: 'Auth', children: [{ id: 'r1', type: 'request', request }] }
}

function roundTrip(auth: Auth): Auth {
  const exported = JSON.parse(JSON.stringify(exportPostmanCollection(collectionWith(auth))))
  const imported = importPostmanCollection(exported)
  const node = imported.children[0]
  if (node.type !== 'request') throw new Error('request expected')
  return node.request.auth
}

const SCHEMES: Auth[] = [
  { type: 'aws', accessKey: 'AKID', secretKey: 'secret', region: 'eu-west-1', service: 's3', sessionToken: 'tok' },
  { type: 'hawk', id: 'dh37fgj492je', key: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn', algorithm: 'sha256', ext: 'some-app-data' },
  { type: 'ntlm', username: 'alice', password: 'p@ss', domain: 'CORP', workstation: 'WS01' },
  { type: 'oauth1', consumerKey: 'ck', consumerSecret: 'cs', token: 't', tokenSecret: 'ts', signatureMethod: 'HMAC-SHA256', addTo: 'header' },
  { type: 'akamai', accessToken: 'akab-access', clientToken: 'akab-client', clientSecret: 'secret' },
  { type: 'jwt', algorithm: 'HS512', secret: 'shh', payload: '{"sub":"1"}', headerPrefix: 'Bearer', addTo: 'query', queryParamName: 'jwt' },
  { type: 'asap', issuer: 'svc', audience: 'api', keyId: 'svc/key1', privateKey: '-----BEGIN PRIVATE KEY-----', subject: 'user' }
]

describe('Postman export/import keeps the auth scheme', () => {
  for (const auth of SCHEMES) {
    it(auth.type, () => {
      expect(roundTrip(auth)).toEqual(auth)
    })
  }

  it('an OAuth 1.0 query placement survives too', () => {
    const auth: Auth = { type: 'oauth1', consumerKey: 'ck', consumerSecret: 'cs', signatureMethod: 'PLAINTEXT', addTo: 'query' }
    expect(roundTrip(auth)).toEqual(auth)
  })

  it('an unknown Postman scheme imports as no auth, never as inherit', () => {
    const imported = importPostmanCollection({
      info: { name: 'x', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'r', request: { method: 'GET', url: 'https://x', auth: { type: 'something-new' } } }]
    })
    const node = imported.children[0]
    expect(node.type === 'request' && node.request.auth).toEqual({ type: 'none' })
  })

  it('a request without an auth block still inherits', () => {
    const imported = importPostmanCollection({
      info: { name: 'x', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'r', request: { method: 'GET', url: 'https://x' } }]
    })
    const node = imported.children[0]
    expect(node.type === 'request' && node.request.auth).toEqual({ type: 'inherit' })
  })
})

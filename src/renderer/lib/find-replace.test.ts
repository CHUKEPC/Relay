import { describe, it, expect } from 'vitest'
import type { CollectionFolderNode, RequestModel, VariableDef } from '@shared/types'
import {
  applyToRequest,
  applyToVariables,
  buildMatcher,
  countMatches,
  DEFAULT_AREAS,
  fieldsOfCollections,
  fieldsOfRequest,
  fieldsOfVariables,
  previewOf,
  search,
  type FindOptions
} from './find-replace'

function request(patch: Partial<RequestModel> = {}): RequestModel {
  return {
    id: 'req_1',
    name: 'List products',
    method: 'GET',
    url: 'https://api.acme.dev/v1/products',
    query: [{ key: 'page', value: '1', enabled: true }],
    headers: [{ key: 'Authorization', value: 'Bearer acme-token', enabled: true }],
    pathVariables: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    ...patch
  }
}

function options(patch: Partial<FindOptions> = {}): FindOptions {
  return { query: 'acme', matchCase: false, wholeWord: false, useRegex: false, areas: [...DEFAULT_AREAS], ...patch }
}

describe('buildMatcher', () => {
  it('treats the query literally unless regex is on', () => {
    expect(countMatches(buildMatcher({ query: 'a.c', matchCase: true, wholeWord: false, useRegex: false })!, 'abc a.c')).toBe(1)
    expect(countMatches(buildMatcher({ query: 'a.c', matchCase: true, wholeWord: false, useRegex: true })!, 'abc a.c')).toBe(2)
  })

  it('is case-insensitive by default and exact with matchCase', () => {
    expect(countMatches(buildMatcher({ query: 'acme', matchCase: false, wholeWord: false, useRegex: false })!, 'ACME acme')).toBe(2)
    expect(countMatches(buildMatcher({ query: 'acme', matchCase: true, wholeWord: false, useRegex: false })!, 'ACME acme')).toBe(1)
  })

  it('anchors whole words only when the query has word edges', () => {
    const word = buildMatcher({ query: 'api', matchCase: false, wholeWord: true, useRegex: false })!
    expect(countMatches(word, 'api rapid api-key')).toBe(2) // "rapid" is not a match
    // A query that starts with punctuation cannot use \b — it must still match.
    const punct = buildMatcher({ query: '/v1', matchCase: false, wholeWord: true, useRegex: false })!
    expect(countMatches(punct, 'https://x/v1/products')).toBe(1)
  })

  it('returns null for an empty query and for a broken pattern', () => {
    expect(buildMatcher({ query: '', matchCase: false, wholeWord: false, useRegex: false })).toBeNull()
    expect(buildMatcher({ query: '([a-z', matchCase: false, wholeWord: false, useRegex: true })).toBeNull()
  })

  it('counts a pattern that can match nothing without hanging', () => {
    expect(countMatches(buildMatcher({ query: 'x*', matchCase: true, wholeWord: false, useRegex: true })!, 'axb')).toBe(4)
  })
})

describe('fieldsOfRequest', () => {
  it('collects name, url, params, headers and skips empty values', () => {
    const fields = fieldsOfRequest(request(), 'Acme / List products')
    const paths = fields.map((f) => `${f.area}:${f.value}`)
    expect(paths).toContain('name:List products')
    expect(paths).toContain('url:https://api.acme.dev/v1/products')
    expect(paths).toContain('params:page')
    expect(paths).toContain('headers:Bearer acme-token')
    // `description` is undefined here, so it must not produce a field.
    expect(fields.some((f) => f.area === 'description')).toBe(false)
  })

  it('walks the auth object generically, ignoring its discriminator', () => {
    const fields = fieldsOfRequest(request({ auth: { type: 'bearer', token: 'acme-secret' } }), 'p')
    const auth = fields.filter((f) => f.area === 'auth')
    expect(auth).toHaveLength(1)
    expect(auth[0].value).toBe('acme-secret')
  })

  it('reads raw, graphql and form bodies', () => {
    const raw = fieldsOfRequest(request({ body: { type: 'raw', language: 'json', text: '{"acme":1}' } }), 'p')
    expect(raw.find((f) => f.area === 'body')?.value).toBe('{"acme":1}')

    const gql = fieldsOfRequest(request({ body: { type: 'graphql', query: '{ acme }', variables: '{}' } }), 'p')
    expect(gql.filter((f) => f.area === 'body')).toHaveLength(2)

    const form = fieldsOfRequest(
      request({ body: { type: 'formdata', items: [{ key: 'file', type: 'text', value: 'acme.csv', enabled: true }] } }),
      'p'
    )
    expect(form.find((f) => f.value === 'acme.csv')).toBeTruthy()
  })
})

describe('fieldsOfVariables', () => {
  const vars: VariableDef[] = [
    { key: 'base_url', value: 'https://api.acme.dev', enabled: true },
    { key: 'token', value: 'acme-secret', enabled: true, secret: true }
  ]

  it('never exposes the value of a secret variable', () => {
    const fields = fieldsOfVariables('environment', 'env_1', 'Prod', 'Prod', vars)
    expect(fields.map((f) => f.value)).toContain('https://api.acme.dev')
    expect(fields.map((f) => f.value)).not.toContain('acme-secret')
    // The secret's NAME is still searchable, so it can be renamed.
    expect(fields.map((f) => f.value)).toContain('token')
  })
})

describe('search', () => {
  const tree: CollectionFolderNode[] = [
    {
      id: 'col_1',
      type: 'collection',
      name: 'Acme API',
      children: [{ id: 'req_1', type: 'request', request: request() }]
    }
  ]

  it('reports one hit per field with the occurrence count and the replaced value', () => {
    const hits = search(fieldsOfCollections(tree), options(), 'globex')
    const url = hits.find((h) => h.field.area === 'url')!
    expect(url.count).toBe(1)
    expect(url.replaced).toBe('https://api.globex.dev/v1/products')
    // The collection name matches too, with its breadcrumb.
    expect(hits.some((h) => h.field.ownerKind === 'folder' && h.field.ownerPath === 'Acme API')).toBe(true)
  })

  it('honours the area filter', () => {
    const hits = search(fieldsOfCollections(tree), options({ areas: ['headers'] }), '')
    expect(hits).toHaveLength(1)
    expect(hits[0].field.area).toBe('headers')
  })

  it('keeps $ literal in a plain-text replacement and honours groups in a regex one', () => {
    const fields = fieldsOfRequest(request({ url: 'https://acme.dev' }), 'p').filter((f) => f.area === 'url')
    expect(search(fields, options({ query: 'acme' }), '$&x')[0].replaced).toBe('https://$&x.dev')
    expect(search(fields, options({ query: '(acme)', useRegex: true }), '$1x')[0].replaced).toBe('https://acmex.dev')
  })

  it('returns nothing for a query that matches no field', () => {
    expect(search(fieldsOfCollections(tree), options({ query: 'nothing-here' }), '')).toHaveLength(0)
  })
})

describe('previewOf', () => {
  it('surrounds the first match with its context', () => {
    const fields = fieldsOfRequest(request(), 'p').filter((f) => f.area === 'url')
    const hit = search(fields, options(), '')[0]
    const preview = previewOf(hit, options())
    expect(preview.match).toBe('acme')
    expect(preview.before.endsWith('https://api.')).toBe(true)
    expect(preview.after.startsWith('.dev/v1/products')).toBe(true)
  })
})

describe('applyToRequest', () => {
  it('writes url, header value, raw body and auth back without touching the rest', () => {
    const base = request({ body: { type: 'raw', language: 'json', text: '{"a":1}' }, auth: { type: 'bearer', token: 't' } })
    expect(applyToRequest(base, { t: 'url' }, 'https://x').url).toBe('https://x')
    expect(applyToRequest(base, { t: 'kv', list: 'headers', index: 0, part: 'value' }, 'Bearer new').headers[0]).toEqual({
      key: 'Authorization',
      value: 'Bearer new',
      enabled: true
    })
    const body = applyToRequest(base, { t: 'bodyRaw' }, '{"a":2}').body
    expect(body.type === 'raw' && body.text).toBe('{"a":2}')
    expect(applyToRequest(base, { t: 'auth', key: 'token' }, 'new').auth).toEqual({ type: 'bearer', token: 'new' })
    // The original object is never mutated.
    expect(base.url).toBe('https://api.acme.dev/v1/products')
  })

  it('ignores a path that does not fit the current body type', () => {
    const base = request({ body: { type: 'none' } })
    expect(applyToRequest(base, { t: 'bodyRaw' }, 'x')).toBe(base)
  })
})

describe('applyToVariables', () => {
  it('replaces one key or value and leaves its neighbours alone', () => {
    const vars: VariableDef[] = [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true }
    ]
    expect(applyToVariables(vars, { t: 'var', index: 1, part: 'value' }, '3')[1].value).toBe('3')
    expect(applyToVariables(vars, { t: 'var', index: 1, part: 'value' }, '3')[0]).toEqual(vars[0])
  })
})

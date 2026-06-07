import { describe, it, expect } from 'vitest'
import { importInsomnia, isInsomniaExport } from './insomnia'

function allRequests(node: any, out: any[] = []): any[] {
  for (const c of node.children ?? []) {
    if (c.type === 'request') out.push(c.request)
    else allRequests(c, out)
  }
  return out
}

function findFolder(node: any, name: string): any {
  for (const c of node.children ?? []) {
    if (c.type === 'folder') {
      if (c.name === name) return c
      const nested = findFolder(c, name)
      if (nested) return nested
    }
  }
  return null
}

const EXPORT: any = {
  _type: 'export',
  __export_format: 4,
  __export_source: 'insomnia.desktop.app:v2023',
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'My API', parentId: null },
    { _id: 'fld_1', _type: 'request_group', name: 'Users', parentId: 'wrk_1', metaSortKey: 1 },
    {
      _id: 'req_list',
      _type: 'request',
      name: 'List users',
      parentId: 'fld_1',
      method: 'GET',
      url: 'https://api.test/users?active=true',
      headers: [{ name: 'Accept', value: 'application/json' }],
      parameters: [{ name: 'active', value: 'true' }],
      metaSortKey: 1
    },
    {
      _id: 'req_create',
      _type: 'request',
      name: 'Create user',
      parentId: 'fld_1',
      method: 'POST',
      url: 'https://api.test/users',
      body: { mimeType: 'application/json', text: '{"name":"Ada"}' },
      authentication: { type: 'bearer', token: 'tok_123' },
      metaSortKey: 2
    },
    {
      _id: 'req_root',
      _type: 'request',
      name: 'Health',
      parentId: 'wrk_1',
      method: 'GET',
      url: 'https://api.test/health'
    },
    // Unrelated resources that must be ignored.
    { _id: 'env_1', _type: 'environment', name: 'Base', parentId: 'wrk_1', data: {} },
    { _id: 'jar_1', _type: 'cookie_jar', parentId: 'wrk_1', cookies: [] }
  ]
}

describe('Insomnia v4 import', () => {
  it('detects an Insomnia export doc', () => {
    expect(isInsomniaExport(EXPORT)).toBe(true)
    expect(isInsomniaExport({ resources: [] })).toBe(false)
    expect(isInsomniaExport({ _type: 'export' })).toBe(false)
  })

  it('builds one collection from the workspace with the right request count', () => {
    const { collections } = importInsomnia(EXPORT)
    expect(collections).toHaveLength(1)
    const col = collections[0]
    expect(col.type).toBe('collection')
    expect(col.name).toBe('My API')
    expect(allRequests(col)).toHaveLength(3)
  })

  it('rebuilds the folder tree from parentId links', () => {
    const { collections } = importInsomnia(EXPORT)
    const users = findFolder(collections[0], 'Users')
    expect(users).toBeTruthy()
    expect(users.children).toHaveLength(2)
    // The request directly under the workspace is a top-level child.
    const topReq = collections[0].children.find((c: any) => c.type === 'request') as any
    expect(topReq.request.name).toBe('Health')
  })

  it('maps method/url and splits the query string', () => {
    const { collections } = importInsomnia(EXPORT)
    const list = allRequests(collections[0]).find((r) => r.name === 'List users')
    expect(list.method).toBe('GET')
    expect(list.url).toBe('https://api.test/users')
    expect(list.query.map((q: any) => `${q.key}=${q.value}`)).toEqual(['active=true'])
  })

  it('maps body and bearer authentication', () => {
    const { collections } = importInsomnia(EXPORT)
    const create = allRequests(collections[0]).find((r) => r.name === 'Create user')
    expect(create.body).toEqual({ type: 'raw', language: 'json', text: '{"name":"Ada"}' })
    expect(create.auth).toEqual({ type: 'bearer', token: 'tok_123' })
  })
})

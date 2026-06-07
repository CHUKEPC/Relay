import { describe, expect, it } from 'vitest'
import { exportSqlite, importSqlite } from './index'
import type { SqliteSnapshot } from '@shared/types'

function sampleSnapshot(): SqliteSnapshot {
  return {
    collections: [
      {
        id: 'col1',
        type: 'collection',
        name: 'API',
        children: [
          {
            id: 'f1',
            type: 'folder',
            name: 'Users',
            children: [
              {
                id: 'r1',
                type: 'request',
                request: {
                  id: 'r1',
                  name: 'List users',
                  method: 'GET',
                  url: 'https://api.example.com/users',
                  query: [],
                  headers: [],
                  pathVariables: [],
                  body: { type: 'none' },
                  auth: { type: 'none' }
                }
              }
            ]
          }
        ]
      }
    ],
    environments: [{ id: 'e1', name: 'Prod', variables: [{ key: 'host', value: 'api.example.com', enabled: true }] }],
    activeEnvironmentId: 'e1',
    globals: [{ key: 'token', value: 'secret', enabled: true, secret: true }],
    history: [
      {
        id: 'h1',
        method: 'GET',
        url: 'https://api.example.com/users',
        status: 200,
        ok: true,
        timeMs: 123,
        sizeBytes: 456,
        at: 1700000000000,
        request: {
          id: 'r1',
          name: 'List users',
          method: 'GET',
          url: 'https://api.example.com/users',
          query: [],
          headers: [],
          pathVariables: [],
          body: { type: 'none' },
          auth: { type: 'none' }
        }
      }
    ]
  }
}

describe('SQLite backup round-trip', () => {
  it('exports to a real SQLite file and imports it losslessly', async () => {
    const snap = sampleSnapshot()
    const bytes = await exportSqlite(snap)
    // SQLite files start with the magic header "SQLite format 3\0".
    expect(Buffer.from(bytes.slice(0, 15)).toString('utf8')).toBe('SQLite format 3')

    const back = await importSqlite(bytes)
    expect(back.collections).toHaveLength(1)
    expect(back.collections[0].name).toBe('API')
    expect(back.collections[0].children[0].type).toBe('folder')
    expect(back.environments).toHaveLength(1)
    expect(back.activeEnvironmentId).toBe('e1')
    expect(back.globals).toHaveLength(1)
    expect(back.globals[0].secret).toBe(true)
    expect(back.history).toHaveLength(1)
    expect(back.history[0].status).toBe(200)
  })

  it('rejects a non-Relay SQLite/binary blob', async () => {
    await expect(importSqlite(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})

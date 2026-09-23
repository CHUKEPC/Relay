/**
 * Backup fidelity for the SQLite export/import path: a realistic workspace must
 * survive export -> import unchanged, and hostile input must fail with an error
 * instead of crashing or silently dropping data.
 */
import { describe, expect, it } from 'vitest'
import { exportSqlite, importSqlite } from './index'
import type {
  CollectionFolderNode,
  Environment,
  HistoryEntry,
  RequestModel,
  SqliteSnapshot,
  VariableDef
} from '@shared/types'

const EMOJI = 'привет 👋 — CRLF\r\nsecond line\tTAB «ёлка»'

function request(id: string, over: Partial<RequestModel> = {}): RequestModel {
  return {
    id,
    name: `Request ${id}`,
    method: 'POST',
    url: 'https://api.example.com/v1/items/:id',
    query: [{ key: 'q', value: EMOJI, enabled: true, description: 'поиск' }],
    headers: [{ key: 'X-Trace', value: '1', enabled: false }],
    pathVariables: [{ key: 'id', value: '42', enabled: true }],
    body: { type: 'raw', language: 'json', text: '{\r\n  "a": 1\r\n}' },
    auth: { type: 'none' },
    ...over
  }
}

function fullSnapshot(): SqliteSnapshot {
  const bodies: RequestModel[] = [
    request('r-raw'),
    request('r-none', { body: { type: 'none' }, auth: { type: 'inherit' } }),
    request('r-url', { body: { type: 'urlencoded', items: [{ key: 'a', value: 'b', enabled: true }] } }),
    request('r-form', {
      body: {
        type: 'formdata',
        items: [
          {
            key: 'file',
            type: 'file',
            value: '',
            filePath: String.raw`C:\tmp\sample.bin`,
            fileName: 'пример.bin',
            contentType: 'application/octet-stream',
            enabled: true
          },
          { key: 'text', type: 'text', value: EMOJI, enabled: false }
        ]
      }
    }),
    request('r-bin', { body: { type: 'binary', filePath: '/tmp/payload.bin', fileName: 'payload.bin', contentType: 'image/png' } }),
    request('r-gql', { body: { type: 'graphql', query: 'query { me { id } }', variables: '{"x":1}' }, mode: 'graphql' }),
    request('r-big', { body: { type: 'raw', language: 'text', text: 'x'.repeat(200000) } }),
    request('r-auth-aws', {
      auth: { type: 'aws', accessKey: 'AKIA', secretKey: 's3cr3t', region: 'eu-central-1', service: 'execute-api' }
    }),
    request('r-scripts', { preRequestScript: 'pm.environment.set("a", 1)\r\nconsole.log(1)', testScript: 'pm.test("ok", () => {})' }),
    request('r-examples', {
      examples: [
        { id: 'ex1', name: 'OK', status: 200, headers: [['content-type', 'application/json']], body: '{"ok":true}', contentType: 'application/json' }
      ]
    })
  ]

  const collection: CollectionFolderNode = {
    id: 'col-1',
    type: 'collection',
    name: 'API 🚀',
    description: 'Описание коллекции\r\nвторая строка',
    auth: { type: 'bearer', token: 'collection-token' },
    variables: [
      { id: 'v1', key: 'base', value: 'https://api.example.com', enabled: true },
      { id: 'v2', key: 'apiKey', value: 'super-secret', enabled: false, secret: true }
    ],
    preRequestScript: 'console.log(1)',
    testScript: 'console.log(2)',
    children: [
      {
        id: 'fld-1',
        type: 'folder',
        name: 'Папка 📁',
        description: 'folder description',
        auth: { type: 'inherit' },
        children: bodies.map((r) => ({ id: r.id, type: 'request' as const, request: r }))
      },
      { id: 'fld-empty', type: 'folder', name: 'Empty', children: [] }
    ]
  }

  const environments: Environment[] = [
    {
      id: 'env-1',
      name: 'Prod ✅',
      variables: [
        { id: 'ev1', key: 'host', value: 'api.example.com', enabled: true },
        { id: 'ev2', key: 'token', value: 'env-secret', enabled: true, secret: true },
        { id: 'ev3', key: 'multiline', value: EMOJI, enabled: false }
      ]
    },
    { id: 'env-2', name: 'Empty env', variables: [] }
  ]

  const globals: VariableDef[] = [
    { id: 'g1', key: 'global', value: 'value', enabled: true },
    { id: 'g2', key: 'секрет', value: 'y'.repeat(50000), enabled: false, secret: true }
  ]

  const history: HistoryEntry[] = [
    {
      id: 'h1',
      method: 'POST',
      url: 'https://api.example.com/v1/items?q=1',
      status: 201,
      ok: true,
      timeMs: 1234,
      sizeBytes: 5678,
      at: 1700000000123,
      request: request('r-raw')
    },
    {
      id: 'h2',
      method: 'GET',
      url: 'https://api.example.com/fail',
      status: 0,
      ok: false,
      timeMs: 10,
      sizeBytes: 0,
      at: 1700000001000,
      request: request('r-none')
    }
  ]

  return { collections: [collection], environments, activeEnvironmentId: 'env-1', globals, history }
}

describe('SQLite backup — full workspace round trip', () => {
  it('returns exactly the same data', async () => {
    const snap = fullSnapshot()
    const back = await importSqlite(await exportSqlite(snap))
    expect(back.collections).toEqual(snap.collections)
    expect(back.environments).toEqual(snap.environments)
    expect(back.globals).toEqual(snap.globals)
    expect(back.history).toEqual(snap.history)
    expect(back.activeEnvironmentId).toBe('env-1')
  })

  it('round-trips an empty workspace', async () => {
    const empty: SqliteSnapshot = { collections: [], environments: [], activeEnvironmentId: null, globals: [], history: [] }
    const back = await importSqlite(await exportSqlite(empty))
    expect(back).toEqual(empty)
  })

  it('keeps every item when ids repeat', async () => {
    const snap = fullSnapshot()
    snap.collections = [snap.collections[0], { ...snap.collections[0], name: 'Copy' }]
    snap.environments = [snap.environments[0], { ...snap.environments[0], name: 'Copy' }]
    snap.history = [snap.history[0], { ...snap.history[0], url: 'https://second' }]
    const back = await importSqlite(await exportSqlite(snap))
    expect(back.collections).toHaveLength(2)
    expect(back.environments).toHaveLength(2)
    expect(back.history).toHaveLength(2)
  })
})

describe('SQLite backup — hostile input', () => {
  it('rejects a truncated backup file with a readable error', async () => {
    const bytes = await exportSqlite(fullSnapshot())
    const truncated = bytes.slice(0, Math.floor(bytes.length / 2))
    await expect(importSqlite(truncated)).rejects.toThrow()
  })

  it('rejects an empty file', async () => {
    await expect(importSqlite(new Uint8Array(0))).rejects.toThrow()
  })

  it('does not import junk rows from a foreign database', async () => {
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const db = new SQL.Database()
    db.run('CREATE TABLE collections (id TEXT, name TEXT, json TEXT)')
    db.run('INSERT INTO collections VALUES ("x", "y", "{""totally"":""unrelated""}")')
    const bytes = db.export()
    db.close()
    const back = await importSqlite(bytes)
    expect(back.collections).toEqual([])
  })
})

describe('SQLite backup — older files', () => {
  /** A file written by the first version of the format (globals had no json column). */
  async function legacyFile(): Promise<Uint8Array> {
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const db = new SQL.Database()
    db.run(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT, json TEXT);
      CREATE TABLE environments (id TEXT PRIMARY KEY, name TEXT, json TEXT);
      CREATE TABLE globals (key TEXT, value TEXT, enabled INTEGER, secret INTEGER);
    `)
    const col = { id: 'c1', type: 'collection', name: 'Old', children: [] }
    db.run('INSERT INTO meta VALUES (?, ?)', ['active_environment', 'e1'])
    db.run('INSERT INTO collections VALUES (?, ?, ?)', ['c1', 'Old', JSON.stringify(col)])
    db.run('INSERT INTO environments VALUES (?, ?, ?)', ['e1', 'Env', JSON.stringify({ id: 'e1', name: 'Env', variables: [] })])
    db.run('INSERT INTO globals VALUES (?, ?, ?, ?)', ['k', 'v', 1, 0])
    const bytes = db.export()
    db.close()
    return bytes
  }

  it('imports a backup written before the globals json column existed', async () => {
    const back = await importSqlite(await legacyFile())
    expect(back.collections).toHaveLength(1)
    expect(back.environments).toHaveLength(1)
    expect(back.activeEnvironmentId).toBe('e1')
    expect(back.globals).toEqual([{ key: 'k', value: 'v', enabled: true, secret: false }])
    expect(back.history).toEqual([])
  })

  it('reports a corrupt file with a single readable message', async () => {
    const bytes = await exportSqlite(fullSnapshot())
    const broken = bytes.slice(0, Math.floor(bytes.length / 2))
    await expect(importSqlite(broken)).rejects.toThrow(/SQLite/)
  })
})

describe('SQLite backup — what a backup file contains', () => {
  it('carries no safeStorage-backed secret', async () => {
    // AI provider keys / plugin secrets live in the OS keychain and are not part
    // of a workspace snapshot, so they can never reach a backup file.
    const bytes = await exportSqlite(fullSnapshot())
    const text = Buffer.from(bytes).toString('latin1')
    expect(text).not.toContain('safeStorage')
    expect(text).not.toContain('secret:')
  })

  it('does carry credentials typed into a request (known limitation of the format)', async () => {
    // Request/collection auth is part of the document itself, not of the secret
    // store, so an exported backup is as sensitive as the workspace files.
    // The Data settings screen tells users the opposite — see the report.
    const bytes = await exportSqlite(fullSnapshot())
    const text = Buffer.from(bytes).toString('latin1')
    expect(text).toContain('collection-token')
  })

  it('lists every request in the readable requests table', async () => {
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const db = new SQL.Database(await exportSqlite(fullSnapshot()))
    const rows = db.exec('SELECT id, name, method, url FROM requests')
    db.close()
    expect(rows[0].values).toHaveLength(10)
  })
})

describe('SQLite backup — partially broken rows', () => {
  it('drops a malformed leaf but keeps the rest of the collection', async () => {
    const snap = fullSnapshot()
    const folder = snap.collections[0].children[0] as { children: unknown[] }
    folder.children.push({ id: 'junk', type: 'request' }, { nonsense: true } as never)
    const back = await importSqlite(await exportSqlite(snap))
    expect(back.collections).toHaveLength(1)
    const kept = (back.collections[0].children[0] as { children: unknown[] }).children
    expect(kept).toHaveLength(10)
  })
})

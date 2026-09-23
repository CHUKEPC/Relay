/**
 * SQLite backup (optional) — export/import a workspace's data to a portable
 * `.sqlite` file using the pure-WASM `sql.js` (no native modules, so the
 * cross-platform build stays green).
 *
 * IMPORTANT: per CLAUDE.md the JSON document store remains the canonical backend.
 * This module is a *portable backup/interchange* feature, not a replacement
 * storage engine. The file is a real SQLite database with readable columns
 * (so it can be opened in any SQLite browser) plus `json` columns that make the
 * round-trip back into the app lossless.
 */
import { readFile, stat } from 'node:fs/promises'
import type { Database, SqlJsStatic } from 'sql.js'
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { acceptCollection, acceptEnvironment, acceptHistoryEntry, acceptVariable } from '@shared/backup-shape'
import type {
  CollectionFolderNode,
  CollectionNode,
  Environment,
  HistoryEntry,
  SqliteImportSummary,
  SqliteSnapshot,
  VariableDef
} from '@shared/types'

const FORMAT_VERSION = '1'

/** Guard rail for the import dialog: no real workspace comes near this. */
const MAX_IMPORT_BYTES = 256 * 1024 * 1024

let sqlPromise: Promise<SqlJsStatic> | null = null

/** Lazily initialise sql.js, reading the wasm by absolute path (works in asar). */
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default
      return initSqlJs({
        locateFile: (file: string) => {
          try {
            return require.resolve(`sql.js/dist/${file}`)
          } catch {
            return file
          }
        }
      })
    })()
  }
  return sqlPromise
}

/**
 * The `id` columns are deliberately NOT declared PRIMARY KEY: a workspace can
 * legitimately end up with repeated ids (e.g. the same backup merged twice), and
 * a backup must still export every item instead of aborting on a UNIQUE
 * constraint. `meta` is the only table with keys we generate ourselves.
 * `globals.json` carries the full VariableDef so its id/flags survive the trip;
 * the readable columns stay for SQL browsers and older files.
 */
const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE collections (id TEXT, name TEXT, json TEXT);
CREATE TABLE requests (id TEXT, collection_id TEXT, path TEXT, name TEXT, method TEXT, url TEXT);
CREATE TABLE environments (id TEXT, name TEXT, json TEXT);
CREATE TABLE globals (key TEXT, value TEXT, enabled INTEGER, secret INTEGER, json TEXT);
CREATE TABLE history (id TEXT, method TEXT, url TEXT, status INTEGER, ok INTEGER, time_ms INTEGER, size_bytes INTEGER, at INTEGER, json TEXT);
`

/** Walk a collection tree, emitting one readable row per request leaf. */
function flattenRequests(
  node: CollectionNode,
  collectionId: string,
  path: string,
  out: { id: string; collectionId: string; path: string; name: string; method: string; url: string }[]
): void {
  // Defensive: one malformed node in the tree must not abort the whole backup.
  if (!node || typeof node !== 'object') return
  if (node.type === 'request') {
    const r = node.request
    if (!r) return
    out.push({ id: r.id, collectionId, path, name: r.name, method: r.method, url: r.url })
    return
  }
  if (!Array.isArray(node.children)) return
  const childPath = path ? `${path} / ${node.name}` : node.name
  for (const c of node.children) flattenRequests(c, collectionId, node.type === 'collection' ? '' : childPath, out)
}

/** Build a .sqlite database from a workspace snapshot; returns the raw bytes. */
export async function exportSqlite(snap: SqliteSnapshot): Promise<Uint8Array> {
  const SQL = await getSql()
  const db: Database = new SQL.Database()
  // A snapshot arrives over IPC: a missing section must not abort the backup.
  const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
  try {
    db.run(SCHEMA)

    const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    meta.run(['format_version', FORMAT_VERSION])
    meta.run(['app', 'Relay'])
    meta.run(['active_environment', snap.activeEnvironmentId ?? ''])
    meta.free()

    const insCol = db.prepare('INSERT INTO collections (id, name, json) VALUES (?, ?, ?)')
    const insReq = db.prepare('INSERT INTO requests (id, collection_id, path, name, method, url) VALUES (?, ?, ?, ?, ?, ?)')
    for (const col of list(snap.collections)) {
      insCol.run([col.id, col.name, JSON.stringify(col)])
      const rows: { id: string; collectionId: string; path: string; name: string; method: string; url: string }[] = []
      flattenRequests(col, col.id, '', rows)
      for (const r of rows) insReq.run([r.id, r.collectionId, r.path, r.name, r.method, r.url])
    }
    insCol.free()
    insReq.free()

    const insEnv = db.prepare('INSERT INTO environments (id, name, json) VALUES (?, ?, ?)')
    for (const env of list(snap.environments)) insEnv.run([env.id, env.name, JSON.stringify(env)])
    insEnv.free()

    const insGlobal = db.prepare('INSERT INTO globals (key, value, enabled, secret, json) VALUES (?, ?, ?, ?, ?)')
    for (const g of list(snap.globals)) insGlobal.run([g.key, g.value, g.enabled ? 1 : 0, g.secret ? 1 : 0, JSON.stringify(g)])
    insGlobal.free()

    const insHist = db.prepare(
      'INSERT INTO history (id, method, url, status, ok, time_ms, size_bytes, at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (const h of list(snap.history)) {
      insHist.run([h.id, h.method, h.url, h.status, h.ok ? 1 : 0, h.timeMs, h.sizeBytes, h.at, JSON.stringify(h)])
    }
    insHist.free()

    return db.export()
  } finally {
    db.close()
  }
}

/**
 * Read a `json` column, keeping only what `accept` recognises. The file comes
 * from the user: a row that parses but is not the document we expect (a foreign
 * database that happens to have a `json` column) must not be restored as junk.
 */
function readJsonColumn<T>(db: Database, sql: string, accept: (v: unknown) => T | null): T[] {
  const out: T[] = []
  const stmt = db.prepare(sql)
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { json?: string }
      if (typeof row.json === 'string' && row.json) {
        try {
          const kept = accept(JSON.parse(row.json) as unknown)
          if (kept) out.push(kept)
        } catch {
          /* skip a corrupt row rather than fail the whole import */
        }
      }
    }
  } finally {
    stmt.free()
  }
  return out
}

function tableExists(db: Database, name: string): boolean {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
  try {
    stmt.bind([name])
    return stmt.step()
  } finally {
    stmt.free()
  }
}

/** Parse a .sqlite file produced by exportSqlite back into a snapshot. */
export async function importSqlite(bytes: Uint8Array): Promise<SqliteSnapshot> {
  const SQL = await getSql()
  let db: Database
  try {
    db = new SQL.Database(bytes)
  } catch (err) {
    throw new Error(`Не удалось открыть SQLite-файл: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    if (!tableExists(db, 'collections') && !tableExists(db, 'environments')) {
      throw new Error('Это не файл резервной копии Relay (нет таблиц collections/environments).')
    }

    const collections = tableExists(db, 'collections')
      ? readJsonColumn<CollectionFolderNode>(db, 'SELECT json FROM collections', acceptCollection)
      : []
    const environments = tableExists(db, 'environments')
      ? readJsonColumn<Environment>(db, 'SELECT json FROM environments', acceptEnvironment)
      : []
    const history = tableExists(db, 'history') ? readJsonColumn<HistoryEntry>(db, 'SELECT json FROM history', acceptHistoryEntry) : []

    const globals: VariableDef[] = []
    if (tableExists(db, 'globals')) {
      // `json` (full VariableDef) was added later — fall back to the readable
      // columns so a backup from an older build still imports.
      const stmt = db.prepare('SELECT * FROM globals')
      try {
        while (stmt.step()) {
          const r = stmt.getAsObject() as { key?: string; value?: string; enabled?: number; secret?: number; json?: string }
          let fromJson: unknown = null
          if (typeof r.json === 'string' && r.json) {
            try {
              fromJson = JSON.parse(r.json)
            } catch {
              fromJson = null
            }
          }
          const asVar = acceptVariable(fromJson)
          if (asVar) globals.push(asVar)
          else if (r.key) globals.push({ key: r.key, value: r.value ?? '', enabled: r.enabled !== 0, secret: r.secret === 1 })
        }
      } finally {
        stmt.free()
      }
    }

    let activeEnvironmentId: string | null = null
    if (tableExists(db, 'meta')) {
      const stmt = db.prepare("SELECT value FROM meta WHERE key='active_environment'")
      try {
        if (stmt.step()) {
          const v = (stmt.getAsObject() as { value?: string }).value
          activeEnvironmentId = v ? v : null
        }
      } finally {
        stmt.free()
      }
    }

    return { collections, environments, activeEnvironmentId, globals, history }
  } catch (err) {
    // A truncated/corrupt database only fails when a statement touches the bad
    // page, so wrap read errors too — the UI must show one clear message.
    if (err instanceof Error && err.message.startsWith('Это не файл')) throw err
    throw new Error(`Не удалось прочитать SQLite-файл: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    db.close()
  }
}

function summarize(snap: SqliteSnapshot): SqliteImportSummary {
  let requests = 0
  const count = (n: CollectionNode): void => {
    if (n.type === 'request') requests++
    else n.children.forEach(count)
  }
  snap.collections.forEach(count)
  return {
    collections: snap.collections.length,
    requests,
    environments: snap.environments.length,
    globals: snap.globals.length,
    history: snap.history.length
  }
}

/**
 * `isAllowedPath` confines the import to files the user picked in a dialog —
 * the same rule every other file read over IPC follows, so a compromised
 * renderer cannot point sql.js at an arbitrary file on disk.
 */
export function registerSqliteHandlers(ipcMain: IpcMain, isAllowedPath: (path: string) => boolean): void {
  // Returns base64 of the .sqlite bytes; the renderer saves it via the file dialog.
  ipcMain.handle(IPC.sqlite.export, async (_e, snap: SqliteSnapshot): Promise<string> => {
    const bytes = await exportSqlite(snap)
    return Buffer.from(bytes).toString('base64')
  })

  // Reads a user-picked .sqlite path and returns the parsed snapshot + summary.
  ipcMain.handle(IPC.sqlite.import, async (_e, path: string): Promise<{ snapshot: SqliteSnapshot; summary: SqliteImportSummary }> => {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path')
    if (!isAllowedPath(path)) throw new Error('Path was not selected via a file dialog')
    // sql.js loads the whole database into WASM memory, and a synchronous read
    // would freeze the main process — read it asynchronously and refuse a file
    // far larger than any real workspace instead of running out of memory.
    const { size } = await stat(path)
    if (size > MAX_IMPORT_BYTES) throw new Error('Файл слишком большой для импорта (максимум 256 МБ).')
    const bytes = await readFile(path)
    const snapshot = await importSqlite(new Uint8Array(bytes))
    return { snapshot, summary: summarize(snapshot) }
  })
}

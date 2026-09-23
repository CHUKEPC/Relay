/**
 * JsonStore is the canonical persistence layer: every document the app owns is
 * written through it. These tests cover the properties users notice when they
 * fail — the last edit before quit must reach disk, a write must never leave a
 * half-written file, and an unreadable file must not be destroyed silently.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore } from './json-store'
import { STORAGE_VERSION } from '@shared/constants'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const read = (key: string): unknown => JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'))
const files = (): string[] => readdirSync(dir)

describe('JsonStore', () => {
  it('debounces, then writes the last value atomically', async () => {
    const store = new JsonStore(dir, 5)
    store.save('globals', { version: STORAGE_VERSION, variables: [{ key: 'a', value: '1', enabled: true }] })
    store.save('globals', { version: STORAGE_VERSION, variables: [{ key: 'a', value: '2', enabled: true }] })
    expect(files()).toEqual([])
    await store.flushAll()
    expect(read('globals')).toEqual({ version: STORAGE_VERSION, variables: [{ key: 'a', value: '2', enabled: true }] })
    expect(files().filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('flushAll persists the edit made in the debounce window (the quit path)', async () => {
    const store = new JsonStore(dir, 10_000)
    store.save('tabs', { version: STORAGE_VERSION, tabs: [], activeTabId: 'last-edit' })
    await store.flushAll()
    expect(read('tabs')).toMatchObject({ activeTabId: 'last-edit' })
  })

  it('serves the pending value to load() before it reaches disk', async () => {
    const store = new JsonStore(dir, 10_000)
    store.save('globals', { version: STORAGE_VERSION, variables: [{ key: 'pending', value: 'yes', enabled: true }] })
    const doc = await store.load('globals')
    expect(doc?.variables[0].key).toBe('pending')
    await store.flushAll()
  })

  it('keeps the file valid JSON under rapid overlapping saves', async () => {
    const store = new JsonStore(dir, 0)
    for (let i = 0; i < 40; i++) {
      store.save('history', { version: STORAGE_VERSION, entries: [], last: i } as never)
      await Promise.resolve()
    }
    await store.flushAll()
    await new Promise((r) => setTimeout(r, 30))
    await store.flushAll()
    const doc = read('history') as { last: number }
    expect(doc.last).toBe(39)
    expect(files().filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('round-trips emoji, CRLF and very large values', async () => {
    const store = new JsonStore(dir, 0)
    const value = {
      version: STORAGE_VERSION,
      variables: [
        { key: 'emoji 👋', value: 'ёлка\r\nline\t«»', enabled: true },
        { key: 'big', value: 'ы'.repeat(300000), enabled: true }
      ]
    }
    store.save('globals', value)
    await store.flushAll()
    expect(await new JsonStore(dir, 0).load('globals')).toEqual(value)
  })

  it('returns null for a missing document', async () => {
    expect(await new JsonStore(dir, 0).load('collections')).toBeNull()
  })

  it('does not destroy a corrupt document — the bad file is kept for recovery', async () => {
    writeFileSync(join(dir, 'collections.json'), '{"version":1,"collections":[{"id":"keep-me"', 'utf8')
    const store = new JsonStore(dir, 0)
    expect(await store.load('collections')).toBeNull()
    // The caller now re-seeds and saves, which overwrites collections.json.
    store.save('collections', { version: STORAGE_VERSION, collections: [] })
    await store.flushAll()
    const rescued = files().filter((f) => f.startsWith('collections.json.') && f.includes('corrupt'))
    expect(rescued).toHaveLength(1)
    expect(readFileSync(join(dir, rescued[0]), 'utf8')).toContain('keep-me')
  })
})

describe('JsonStore document shape', () => {
  it('treats a file that is not a document object as corrupt', async () => {
    writeFileSync(join(dir, 'globals.json'), '[1,2,3]', 'utf8')
    const store = new JsonStore(dir, 0)
    expect(await store.load('globals')).toBeNull()
    expect(files().some((f) => f.includes('corrupt'))).toBe(true)
  })

  it('accepts a document from an older version as-is (no migration hook yet)', async () => {
    writeFileSync(join(dir, 'globals.json'), JSON.stringify({ version: 0, variables: [{ key: 'old', value: '1', enabled: true }] }), 'utf8')
    const doc = await new JsonStore(dir, 0).load('globals')
    expect(doc?.variables[0].key).toBe('old')
  })
})

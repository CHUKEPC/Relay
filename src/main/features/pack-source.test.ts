import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dirOfManifest, stageSource, unpackZip, validateManifest, MANIFEST } from './pack-source'

let work: string

const manifest = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: 'my-pack', name: 'My pack', version: '1.0.0', capabilities: ['protocol.websocket'], ...extra })

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'relay-pack-test-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('picking a pack from disk', () => {
  it('accepts the folder itself', () => {
    writeFileSync(join(work, MANIFEST), manifest())
    expect(dirOfManifest(work)).toEqual({ dir: work })
  })

  it('accepts the picked plugin.json and uses its folder', () => {
    writeFileSync(join(work, MANIFEST), manifest())
    expect(dirOfManifest(join(work, MANIFEST))).toEqual({ dir: work })
  })

  it('refuses a folder without a manifest', () => {
    expect(dirOfManifest(work)).toEqual({ error: `в папке нет ${MANIFEST}` })
  })
})

describe('unpacking a .zip', () => {
  const zipAt = (dir: string, entries: Record<string, string>): string => {
    const file = join(dir, 'pack.zip')
    writeFileSync(file, zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))))
    return file
  }

  it('extracts a flat archive', () => {
    const file = zipAt(work, { [MANIFEST]: manifest(), 'locales/de.json': '{}' })
    const staged = unpackZip(file)
    if ('error' in staged) throw new Error(staged.error)
    expect(JSON.parse(readFileSync(join(staged.dir, MANIFEST), 'utf8')).id).toBe('my-pack')
    rmSync(staged.temp!, { recursive: true, force: true })
  })

  it('finds a manifest nested one folder deep', () => {
    const file = zipAt(work, { 'my-pack/plugin.json': manifest() })
    const staged = unpackZip(file)
    if ('error' in staged) throw new Error(staged.error)
    expect(staged.dir.endsWith('my-pack')).toBe(true)
    rmSync(staged.temp!, { recursive: true, force: true })
  })

  it('drops entries that try to escape the extraction root', () => {
    const file = zipAt(work, { '../evil.txt': 'nope', [MANIFEST]: manifest() })
    const staged = unpackZip(file)
    if ('error' in staged) throw new Error(staged.error)
    // The escaping entry is skipped; the archive still installs.
    expect(() => readFileSync(join(work, 'evil.txt'))).toThrow()
    rmSync(staged.temp!, { recursive: true, force: true })
  })

  it('refuses an archive with no manifest', () => {
    const file = zipAt(work, { 'readme.txt': 'hello' })
    expect(unpackZip(file)).toEqual({ error: `в архиве нет ${MANIFEST}` })
  })
})

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    writeFileSync(join(work, MANIFEST), manifest())
    expect(validateManifest(work)).toEqual({ id: 'my-pack', capabilities: ['protocol.websocket'] })
  })

  it('refuses an id that could escape the plugins folder', () => {
    writeFileSync(join(work, MANIFEST), manifest({ id: '../evil' }))
    expect(validateManifest(work)).toEqual({ error: 'в манифесте нет корректного id' })
  })

  it('refuses a manifest without capabilities', () => {
    writeFileSync(join(work, MANIFEST), manifest({ capabilities: [] }))
    expect(validateManifest(work)).toEqual({ error: 'манифест не объявляет ни одной возможности' })
  })

  it('ignores capabilities this version does not know', () => {
    writeFileSync(join(work, MANIFEST), manifest({ capabilities: ['protocol.websocket', 'time.travel'] }))
    expect(validateManifest(work)).toEqual({ id: 'my-pack', capabilities: ['protocol.websocket'] })
  })

  it('refuses a manifest that is not JSON', () => {
    writeFileSync(join(work, MANIFEST), 'not json')
    const result = validateManifest(work)
    expect('error' in result && result.error.startsWith('манифест не читается')).toBe(true)
  })
})

describe('stageSource', () => {
  it('routes a .zip to the unpacker and a folder to the plain reader', () => {
    mkdirSync(join(work, 'folder'))
    writeFileSync(join(work, 'folder', MANIFEST), manifest())
    expect(stageSource(join(work, 'folder'))).toEqual({ dir: join(work, 'folder') })

    const file = join(work, 'pack.zip')
    writeFileSync(file, zipSync({ [MANIFEST]: strToU8(manifest()) }))
    const staged = stageSource(file)
    if ('error' in staged) throw new Error(staged.error)
    expect(staged.temp).toBeTruthy()
    rmSync(staged.temp!, { recursive: true, force: true })
  })
})

import { describe, it, expect } from 'vitest'
import type { KV } from '@shared/types'
import { serializeRows, parseBulk, mergeParsed } from './bulk-edit'

describe('serializeRows', () => {
  it('serializes enabled and disabled rows, skipping empty-key placeholders', () => {
    const rows: KV[] = [
      { id: '1', key: 'A', value: '1', enabled: true },
      { id: '2', key: 'B', value: '2', enabled: false },
      { id: '3', key: '', value: '', enabled: true } // trailing placeholder
    ]
    expect(serializeRows(rows)).toBe('A:1\n//B:2')
  })
})

describe('parseBulk', () => {
  it('parses key:value lines and ignores blank lines', () => {
    expect(parseBulk('A:1\n\n  B:2  ')).toEqual([
      { key: 'A', value: '1', enabled: true },
      { key: 'B', value: '2', enabled: true }
    ])
  })

  it('marks // lines disabled and strips a single following space', () => {
    expect(parseBulk('//A:1\n// B:2')).toEqual([
      { key: 'A', value: '1', enabled: false },
      { key: 'B', value: '2', enabled: false }
    ])
  })

  it('splits only on the first colon so values may contain colons', () => {
    expect(parseBulk('url:https://x.com:8080/p')).toEqual([
      { key: 'url', value: 'https://x.com:8080/p', enabled: true }
    ])
  })

  it('keeps a key with an empty value', () => {
    expect(parseBulk('X-Empty:')).toEqual([{ key: 'X-Empty', value: '', enabled: true }])
  })
})

describe('mergeParsed', () => {
  it('preserves id + description by matching key, mints ids for new rows', () => {
    const existing: KV[] = [{ id: 'orig', key: 'A', value: 'old', enabled: true, description: 'desc A' }]
    const merged = mergeParsed(parseBulk('A:new\nB:2'), existing)
    expect(merged[0]).toMatchObject({ id: 'orig', key: 'A', value: 'new', enabled: true, description: 'desc A' })
    expect(merged[1]).toMatchObject({ key: 'B', value: '2', enabled: true, description: '' })
    expect(merged[1].id).toBeTruthy()
  })

  it('round-trips rows losslessly (enabled state + descriptions)', () => {
    const rows: KV[] = [
      { id: '1', key: 'A', value: '1', enabled: true, description: 'da' },
      { id: '2', key: 'B', value: '2', enabled: false, description: 'db' }
    ]
    const round = mergeParsed(parseBulk(serializeRows(rows)), rows)
    expect(round).toEqual(rows)
  })
})

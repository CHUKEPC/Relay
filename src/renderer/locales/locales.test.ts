import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The UI catalogs stay in step with the English one.
 *
 * Strings are written in Russian in the code; en.json ships with the app and
 * the other languages come from the «Дополнительные языки» pack. A key missing
 * from a pack language silently falls back to English, so a new string added
 * to en.json alone leaves German or Spanish half translated — this suite fails
 * instead. Every language the pack's manifest lists is checked, so a new one
 * is covered the day it is added.
 */

type Catalog = Record<string, string>

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T

const en = read<Catalog>('./en.json')
const PACK = '../../../plugins/extra-languages/'
const packLocales = read<{ locales: string[] }>(`${PACK}plugin.json`).locales

/** `{name}`-style placeholders filled by trf(); `{{var}}` is literal text, not one of them. */
const placeholders = (s: string): string[] => [...new Set([...s.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]))].sort()

/** The first few offenders, so a failure says what to fix. */
const sample = (keys: string[]): string[] => keys.slice(0, 10).map((k) => (k.length > 90 ? `${k.slice(0, 90)}…` : k))

function checkValues(catalog: Catalog): void {
  const empty = Object.keys(catalog).filter((k) => typeof catalog[k] !== 'string' || !catalog[k].trim())
  expect(sample(empty), 'empty translations').toEqual([])
  const broken = Object.keys(catalog).filter((k) => placeholders(k).join() !== placeholders(catalog[k]).join())
  expect(sample(broken), 'placeholders that differ from the source string').toEqual([])
}

describe('UI catalogs', () => {
  it('English: every translation is filled in and keeps its placeholders', () => {
    checkValues(en)
  })

  it('the pack lists at least one language', () => {
    expect(packLocales.length).toBeGreaterThan(0)
  })

  describe.each(packLocales)('%s', (code) => {
    const catalog = read<Catalog>(`${PACK}locales/${code}.json`)

    it('has every string English has', () => {
      const missing = Object.keys(en).filter((k) => !(k in catalog))
      expect(sample(missing), `${missing.length} strings missing from ${code}.json`).toEqual([])
    })

    it('has no strings English no longer has', () => {
      const stale = Object.keys(catalog).filter((k) => !(k in en))
      expect(sample(stale), `${stale.length} strings in ${code}.json that en.json dropped`).toEqual([])
    })

    it('fills every translation in and keeps its placeholders', () => {
      checkValues(catalog)
    })
  })
})

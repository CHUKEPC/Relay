/**
 * Bulk-edit (Postman-style) serialization for key/value tables.
 *
 * Text format — one `key:value` per line:
 *  - A line starting (after leading whitespace) with `//` marks that row DISABLED.
 *    The leading `//` and a single optional following space are stripped.
 *  - Blank lines are ignored.
 *  - Only the FIRST `:` splits key/value, so values may contain colons.
 *  - key = beforeColon.trim(); value = afterColon.trim().
 *
 * Pure module (no React) so it is unit-testable.
 */
import type { KV } from '@shared/types'
import { makeId } from '@shared/id'

/** Serialize rows to bulk text. Empty-key rows (the trailing "add" placeholder)
 *  are skipped so a clean round-trip doesn't accumulate blank lines. */
export function serializeRows(rows: KV[]): string {
  return rows
    .filter((r) => r.key.trim() !== '')
    .map((r) => {
      const line = `${r.key}:${r.value}`
      return r.enabled ? line : `//${line}`
    })
    .join('\n')
}

export interface ParsedLine {
  key: string
  value: string
  enabled: boolean
}

export function parseBulk(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  for (const raw of text.split('\n')) {
    let line = raw.trim()
    if (line === '') continue
    let enabled = true
    if (line.startsWith('//')) {
      enabled = false
      line = line.slice(2)
      if (line.startsWith(' ')) line = line.slice(1)
    }
    const colon = line.indexOf(':')
    const key = (colon === -1 ? line : line.slice(0, colon)).trim()
    const value = (colon === -1 ? '' : line.slice(colon + 1)).trim()
    if (key === '' && value === '') continue
    out.push({ key, value, enabled })
  }
  return out
}

/**
 * Merge parsed bulk lines back into KV[], preserving each existing row's `id` and
 * `description` by matching on key. Duplicate keys resolve positionally (FIFO).
 * Rows with no match get a fresh id and empty description.
 */
export function mergeParsed(parsed: ParsedLine[], existing: KV[]): KV[] {
  const byKey = new Map<string, KV[]>()
  for (const r of existing) {
    const list = byKey.get(r.key)
    if (list) list.push(r)
    else byKey.set(r.key, [r])
  }
  return parsed.map((p) => {
    const match = byKey.get(p.key)?.shift()
    return {
      id: match?.id ?? makeId('kv'),
      key: p.key,
      value: p.value,
      enabled: p.enabled,
      description: match?.description ?? ''
    }
  })
}

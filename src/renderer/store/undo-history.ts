import type { RequestModel } from '@shared/types'

/** The request-builder area a change came from; matches `data-undo-field` in the DOM. */
export type UndoSource = 'url' | 'meta' | 'params' | 'headers' | 'auth' | 'body' | 'scripts' | 'examples' | 'other'

type Key = keyof RequestModel

export interface UndoEntry {
  source: UndoSource
  keys: Key[]
  prev: Partial<RequestModel>
  next: Partial<RequestModel>
  at: number
}

interface TabHistory {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

const LIMIT = 200
/** Edits to the same area closer together than this collapse into one step (typing). */
const MERGE_MS = 800

const histories = new Map<string, TabHistory>()
let suppressed = 0

function historyFor(tabId: string): TabHistory {
  let h = histories.get(tabId)
  if (!h) {
    h = { undo: [], redo: [] }
    histories.set(tabId, h)
  }
  return h
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v))
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

const KEY_SOURCES: [Key, UndoSource][] = [
  ['url', 'url'],
  ['method', 'url'],
  ['mode', 'url'],
  ['headers', 'headers'],
  ['body', 'body'],
  ['auth', 'auth'],
  ['preRequestScript', 'scripts'],
  ['testScript', 'scripts'],
  ['query', 'params'],
  ['pathVariables', 'params'],
  ['examples', 'examples'],
  ['name', 'meta'],
  ['description', 'meta']
]

/**
 * The builder area is derived from WHAT changed, not from focus: clicks on
 * non-focusable controls ("Add row") leave focus in whatever field had it.
 */
function sourceFromKeys(keys: Key[]): UndoSource {
  for (const [k, s] of KEY_SOURCES) if (keys.includes(k)) return s
  return 'other'
}

/** Run `fn` without recording its patches (used when applying undo/redo). */
export function withoutRecording(fn: () => void): void {
  suppressed++
  try {
    fn()
  } finally {
    suppressed--
  }
}

export function recordPatch(tabId: string, before: RequestModel, patch: Partial<RequestModel>): void {
  if (suppressed) return
  const keys = (Object.keys(patch) as Key[]).filter((k) => !same(before[k], patch[k]))
  if (keys.length === 0) return
  const source = sourceFromKeys(keys)
  const h = historyFor(tabId)
  h.redo = []
  const now = Date.now()
  const top = h.undo[h.undo.length - 1]
  if (top && top.source === source && now - top.at < MERGE_MS) {
    const prev = top.prev as Record<string, unknown>
    const next = top.next as Record<string, unknown>
    for (const k of keys) {
      // A key the merged step never touched still holds its pre-step value in `before`.
      if (!(k in prev)) {
        prev[k] = clone(before[k])
        top.keys.push(k)
      }
      next[k] = clone(patch[k])
    }
    top.at = now
    return
  }
  const prev: Record<string, unknown> = {}
  const next: Record<string, unknown> = {}
  for (const k of keys) {
    prev[k] = clone(before[k])
    next[k] = clone(patch[k])
  }
  h.undo.push({ source, keys, prev, next, at: now })
  if (h.undo.length > LIMIT) h.undo.shift()
}

/** Pop the newest undo entry (optionally only from one area). */
export function takeUndo(tabId: string, source?: UndoSource): UndoEntry | null {
  const h = histories.get(tabId)
  if (!h) return null
  for (let i = h.undo.length - 1; i >= 0; i--) {
    if (source && h.undo[i].source !== source) continue
    const [entry] = h.undo.splice(i, 1)
    h.redo.push(entry)
    return entry
  }
  return null
}

/** Pop the newest redo entry (optionally only from one area). */
export function takeRedo(tabId: string, source?: UndoSource): UndoEntry | null {
  const h = histories.get(tabId)
  if (!h) return null
  for (let i = h.redo.length - 1; i >= 0; i--) {
    if (source && h.redo[i].source !== source) continue
    const [entry] = h.redo.splice(i, 1)
    entry.at = 0 // never merge a new edit into a restored step
    h.undo.push(entry)
    return entry
  }
  return null
}

/** Drop a step that can no longer be applied (its keys were all changed since). */
export function discard(tabId: string, entry: UndoEntry): void {
  const h = histories.get(tabId)
  if (!h) return
  h.undo = h.undo.filter((e) => e !== entry)
  h.redo = h.redo.filter((e) => e !== entry)
}

export function forgetTab(tabId: string): void {
  histories.delete(tabId)
}

/**
 * Values to write back for an undo (`prev`) or redo (`next`). Keys that were
 * changed again since by another area are left alone so that change survives.
 */
export function restorePatch(current: RequestModel, entry: UndoEntry, direction: 'undo' | 'redo'): Partial<RequestModel> {
  const from = direction === 'undo' ? entry.next : entry.prev
  const to = direction === 'undo' ? entry.prev : entry.next
  const out: Record<string, unknown> = {}
  for (const k of entry.keys) {
    if (!same(current[k], from[k])) continue
    out[k] = clone(to[k])
  }
  return out as Partial<RequestModel>
}

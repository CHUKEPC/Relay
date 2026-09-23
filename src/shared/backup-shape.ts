/**
 * Shape checks for workspace data read back from a backup.
 *
 * A backup file is user-supplied: it may come from an older build, be edited by
 * hand or simply be some other JSON file. Every restore path (JSON, ZIP, SQLite)
 * passes what it read through these acceptors, so "Заменить" can never swap the
 * workspace for objects the app cannot render. Each acceptor returns the value
 * when it is usable and null otherwise; a broken child is dropped on its own
 * rather than taking its whole collection with it.
 */
import type { CollectionFolderNode, CollectionNode, Environment, HistoryEntry, SqliteSnapshot, VariableDef } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Keep a node the app can render; malformed children are filtered out. */
export function acceptNode(v: unknown): CollectionNode | null {
  if (!isRecord(v) || typeof v.id !== 'string') return null
  if (v.type === 'request') {
    const r = v.request
    return isRecord(r) && typeof r.id === 'string' && typeof r.method === 'string' ? (v as unknown as CollectionNode) : null
  }
  if ((v.type === 'collection' || v.type === 'folder') && typeof v.name === 'string' && Array.isArray(v.children)) {
    const children = v.children.map(acceptNode).filter((c): c is CollectionNode => c !== null)
    return { ...v, children } as unknown as CollectionNode
  }
  return null
}

/** Only a collection/folder makes sense at the top level of a workspace. */
export function acceptCollection(v: unknown): CollectionFolderNode | null {
  const node = acceptNode(v)
  return node && node.type !== 'request' ? node : null
}

export function acceptEnvironment(v: unknown): Environment | null {
  return isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && Array.isArray(v.variables)
    ? (v as unknown as Environment)
    : null
}

export function acceptHistoryEntry(v: unknown): HistoryEntry | null {
  return isRecord(v) && typeof v.id === 'string' && typeof v.url === 'string' && typeof v.method === 'string'
    ? (v as unknown as HistoryEntry)
    : null
}

export function acceptVariable(v: unknown): VariableDef | null {
  return isRecord(v) && typeof v.key === 'string' ? (v as unknown as VariableDef) : null
}

/** Keep what `accept` recognises from a value that should be a list. */
export function acceptList<T>(v: unknown, accept: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const item of v) {
    const kept = accept(item)
    if (kept !== null) out.push(kept)
  }
  return out
}

/** A snapshot with every part checked; missing parts come back empty. */
export function acceptSnapshot(data: Partial<Record<keyof SqliteSnapshot, unknown>>): SqliteSnapshot {
  return {
    collections: acceptList(data.collections, acceptCollection),
    environments: acceptList(data.environments, acceptEnvironment),
    activeEnvironmentId: typeof data.activeEnvironmentId === 'string' ? data.activeEnvironmentId : null,
    globals: acceptList(data.globals, acceptVariable),
    history: acceptList(data.history, acceptHistoryEntry)
  }
}

/**
 * Give a node tree fresh ids (the tree itself and every request inside), so a
 * backup restored with «Добавить» next to the data it came from does not create
 * two nodes with one id — the store finds nodes by id, and a duplicate made
 * edits and deletes land on the wrong request.
 */
export function reidNode<T extends CollectionNode>(node: T, makeId: (prefix: string) => string): T {
  if (node.type === 'request') {
    const id = makeId('req')
    return { ...node, id, request: { ...node.request, id } }
  }
  return { ...node, id: makeId('col'), children: node.children.map((c) => reidNode(c, makeId)) }
}

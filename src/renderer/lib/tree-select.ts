/**
 * Ticking collections, folders and requests in the sidebar. Pure helpers over
 * the collection tree: the selection is a list of ticked ids, and a ticked
 * container stands for everything inside it.
 */
import type { CollectionFolderNode, CollectionNode, VariableDef } from '@shared/types'

export type TickState = 'on' | 'implied' | 'some' | 'off'

/** Ancestor ids of every node, root first (`[]` for a collection). */
function pathsOf(nodes: CollectionNode[], trail: string[] = [], out = new Map<string, string[]>()): Map<string, string[]> {
  for (const n of nodes) {
    out.set(n.id, trail)
    if (n.type !== 'request') pathsOf(n.children, [...trail, n.id], out)
  }
  return out
}

/**
 * The ticked nodes that are not inside another ticked node, in tree order —
 * what an action works on. Ids that are no longer in the tree are dropped.
 */
export function topSelected(roots: CollectionNode[], ids: readonly string[]): CollectionNode[] {
  const wanted = new Set(ids)
  const out: CollectionNode[] = []
  const walk = (nodes: CollectionNode[]): void => {
    for (const n of nodes) {
      if (wanted.has(n.id)) out.push(n)
      else if (n.type !== 'request') walk(n.children)
    }
  }
  walk(roots)
  return out
}

/** How the checkbox of `id` looks: ticked, ticked through a parent, partly (something inside), or not. */
export function tickStates(roots: CollectionNode[], ids: readonly string[]): Map<string, TickState> {
  const wanted = new Set(ids)
  const states = new Map<string, TickState>()
  const walk = (nodes: CollectionNode[], implied: boolean): boolean => {
    let any = false
    for (const n of nodes) {
      const on = wanted.has(n.id)
      let inner = false
      if (n.type !== 'request') inner = walk(n.children, implied || on)
      const state: TickState = implied ? 'implied' : on ? 'on' : inner ? 'some' : 'off'
      states.set(n.id, state)
      if (state !== 'off') any = true
    }
    return any
  }
  walk(roots, false)
  return states
}

/**
 * Tick or untick one node. Unticking a node that is ticked through a parent
 * unticks that parent and ticks everything else it held, so only this branch
 * drops out. Ticking a container drops the ticks inside it (it covers them).
 */
export function toggleTick(roots: CollectionNode[], ids: readonly string[], id: string): string[] {
  const paths = pathsOf(roots)
  const path = paths.get(id)
  if (!path) return [...ids]
  const wanted = new Set(ids)
  if (wanted.has(id)) return ids.filter((x) => x !== id)
  const owner = path.find((a) => wanted.has(a))
  if (!owner) {
    // Tick it; what was ticked inside it is covered now.
    const inside = (x: string) => (paths.get(x) ?? []).includes(id)
    return [...ids.filter((x) => !inside(x)), id]
  }
  // Ticked through `owner`: keep every sibling along the way down to `id`.
  const next = ids.filter((x) => x !== owner)
  const byId = new Map<string, CollectionNode>()
  const index = (nodes: CollectionNode[]): void => {
    for (const n of nodes) {
      byId.set(n.id, n)
      if (n.type !== 'request') index(n.children)
    }
  }
  index(roots)
  const chain = [...path.slice(path.indexOf(owner)), id]
  for (let i = 0; i < chain.length - 1; i++) {
    const parent = byId.get(chain[i])
    if (!parent || parent.type === 'request') continue
    for (const c of parent.children) if (c.id !== chain[i + 1]) next.push(c.id)
  }
  return next
}

/** Every collection, ticked — «select all». */
export function allIds(roots: CollectionNode[]): string[] {
  return roots.map((n) => n.id)
}

/**
 * A copy of the collections cut down to the selection, folder structure kept:
 * a ticked node comes whole, a container with something ticked inside comes
 * with just those branches. Collection settings (auth, variables, scripts)
 * stay on the copies, so an export keeps working as it did in the app.
 */
export function pruneToSelection(roots: CollectionFolderNode[], ids: readonly string[]): CollectionFolderNode[] {
  const wanted = new Set(ids)
  const prune = (n: CollectionNode): CollectionNode | null => {
    if (wanted.has(n.id)) return n
    if (n.type === 'request') return null
    const children = n.children.map(prune).filter((c): c is CollectionNode => !!c)
    return children.length ? { ...n, children } : null
  }
  return roots.map((r) => prune(r) as CollectionFolderNode | null).filter((r): r is CollectionFolderNode => !!r)
}

/**
 * One collection to export from a selection. A single collection (whole or
 * cut down) passes through; several become folders of one collection named
 * `name`, with their variables merged (the first collection wins a clash).
 */
export function selectionExport(roots: CollectionFolderNode[], ids: readonly string[], name: string, partName: (n: string) => string): CollectionFolderNode | null {
  const pruned = pruneToSelection(roots, ids)
  if (!pruned.length) return null
  if (pruned.length === 1) {
    const only = pruned[0]
    return ids.includes(only.id) ? only : { ...only, name: partName(only.name) }
  }
  const seen = new Set<string>()
  const variables: VariableDef[] = []
  for (const c of pruned) {
    for (const v of c.variables ?? []) {
      if (seen.has(v.key)) continue
      seen.add(v.key)
      variables.push(v)
    }
  }
  return {
    id: 'selection-export',
    type: 'collection',
    name,
    variables,
    children: pruned.map(({ variables: _v, ...c }) => ({ ...c, type: 'folder' as const }))
  }
}

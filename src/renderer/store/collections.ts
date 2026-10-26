import { create } from 'zustand'
import type {
  Auth,
  CollectionFolderNode,
  CollectionNode,
  CollectionsDoc,
  RequestModel,
  VariableDef
} from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { flattenVariables } from '@shared/interpolate'
import { trf } from '@renderer/lib/i18n'
import { defaultCollections } from '@shared/defaults'
import { persist } from './persist'

export interface Located {
  node: CollectionNode
  ancestors: CollectionFolderNode[]
}

function locate(nodes: CollectionNode[], id: string, ancestors: CollectionFolderNode[] = []): Located | null {
  for (const node of nodes) {
    if (node.id === id) return { node, ancestors }
    if (node.type !== 'request') {
      const found = locate(node.children, id, [...ancestors, node])
      if (found) return found
    }
  }
  return null
}

function mapTree(nodes: CollectionNode[], fn: (n: CollectionNode) => CollectionNode | null): CollectionNode[] {
  const out: CollectionNode[] = []
  for (const node of nodes) {
    const mapped = fn(node)
    if (!mapped) continue
    if (mapped.type !== 'request') {
      out.push({ ...mapped, children: mapTree(mapped.children, fn) })
    } else {
      out.push(mapped)
    }
  }
  return out
}

function insertInto(nodes: CollectionNode[], parentId: string, child: CollectionNode): CollectionNode[] {
  return nodes.map((n) => {
    if (n.type === 'request') return n
    if (n.id === parentId) return { ...n, children: [...n.children, child] }
    return { ...n, children: insertInto(n.children, parentId, child) }
  })
}

/** Remove a node by id anywhere in the tree, returning the new tree and the removed node. */
function removeNode(nodes: CollectionNode[], id: string): { tree: CollectionNode[]; removed: CollectionNode | null } {
  let removed: CollectionNode | null = null
  const tree: CollectionNode[] = []
  for (const node of nodes) {
    if (node.id === id) {
      removed = node
      continue
    }
    if (node.type !== 'request') {
      const sub = removeNode(node.children, id)
      if (sub.removed) removed = sub.removed
      tree.push({ ...node, children: sub.tree })
    } else {
      tree.push(node)
    }
  }
  return { tree, removed }
}

/** Insert a child at a specific index among `parentId`'s children. Index is clamped to [0, len]. */
function insertAt(nodes: CollectionNode[], parentId: string, child: CollectionNode, index: number): CollectionNode[] {
  return nodes.map((n) => {
    if (n.type === 'request') return n
    if (n.id === parentId) {
      const next = [...n.children]
      const clamped = Math.max(0, Math.min(index, next.length))
      next.splice(clamped, 0, child)
      return { ...n, children: next }
    }
    return { ...n, children: insertAt(n.children, parentId, child, index) }
  })
}

/** Every node of the tree, depth-first in document order. */
function treeOrder(nodes: CollectionNode[], out: CollectionNode[] = []): CollectionNode[] {
  for (const n of nodes) {
    out.push(n)
    if (n.type !== 'request') treeOrder(n.children, out)
  }
  return out
}

/** True if `targetId` is `rootId` itself or a descendant of `rootId` (cycle guard). */
function isSelfOrDescendant(node: CollectionNode, targetId: string): boolean {
  if (node.id === targetId) return true
  if (node.type === 'request') return false
  return node.children.some((c) => isSelfOrDescendant(c, targetId))
}

interface CollectionsState {
  doc: CollectionsDoc
  hydrate: (doc: CollectionsDoc) => void
  setAll: (collections: CollectionFolderNode[]) => void
  addCollectionNode: (node: CollectionFolderNode) => void
  addCollection: (name: string) => string
  addFolder: (parentId: string, name: string) => string
  addRequest: (parentId: string, request: RequestModel) => void
  updateRequest: (requestId: string, request: RequestModel) => void
  renameNode: (id: string, name: string) => void
  removeNode: (id: string) => void
  /**
   * Put a node back (trash restore): under `parentId` at `index`, or at the top
   * level for a collection. Returns false when the parent no longer exists.
   */
  insertNode: (node: CollectionNode, parentId: string | null, index: number) => boolean
  moveNode: (id: string, newParentId: string | null, newIndex: number) => void
  /**
   * Move several nodes at once (a sidebar selection), kept in tree order, to
   * `newParentId` (null = top level): before/after `anchor` among its children,
   * or at the end. Nodes the target cannot take — a collection into a folder,
   * a folder into itself — stay where they are. Returns how many moved.
   */
  moveNodes: (ids: string[], newParentId: string | null, anchor?: { id: string; side: 'before' | 'after' }) => number
  /**
   * Copy a node with fresh ids. The copy is named `name` (default «… (копия)»)
   * and lands right after the original, or at the end of `parentId` when another
   * container is given. A collection always stays at the top level. Returns the
   * copy's id, or null when nothing was copied.
   */
  duplicateNode: (id: string, opts?: { name?: string; parentId?: string | null }) => string | null
  updateFolderMeta: (id: string, patch: Partial<Pick<CollectionFolderNode, 'auth' | 'variables' | 'preRequestScript' | 'testScript' | 'description'>>) => void
  getRequest: (requestId: string) => RequestModel | null
  collectionScopeFor: (requestId: string | null) => Record<string, string>
  collectionSecretValues: (requestId: string | null) => string[]
  inheritedAuthFor: (requestId: string | null) => Auth
  /** Pre/test scripts of every ancestor container (root collection first, then
   *  nested folders) for a saved request — used to run folder-level scripts. */
  ancestorScriptsFor: (requestId: string | null) => AncestorScript[]
  /** Apply pm.collectionVariables.set/unset mutations to the request's root
   *  collection node (Postman writes collection vars at the collection root). */
  applyCollectionVarUpdates: (requestId: string | null, updates: Record<string, string | null>) => void
  locate: (id: string) => Located | null
}

/** A container's scripts, tagged with the owning collection/folder node id. */
export interface AncestorScript {
  collectionId: string
  preRequestScript?: string
  testScript?: string
}

export const useCollections = create<CollectionsState>((set, get) => {
  const commit = (collections: CollectionFolderNode[]) => {
    const doc = { version: STORAGE_VERSION, collections }
    set({ doc })
    persist('collections', doc)
  }
  const topLevel = () => get().doc.collections as CollectionNode[]

  return {
    doc: defaultCollections(),
    hydrate: (doc) => set({ doc: { ...doc, version: STORAGE_VERSION } }),
    setAll: (collections) => commit(collections),
    addCollectionNode: (node) => commit([...get().doc.collections, node]),

    addCollection: (name) => {
      const id = makeId('col')
      commit([...get().doc.collections, { id, type: 'collection', name, children: [] }])
      return id
    },

    addFolder: (parentId, name) => {
      const id = makeId('fld')
      const folder: CollectionNode = { id, type: 'folder', name, children: [] }
      commit(insertInto(topLevel(), parentId, folder) as CollectionFolderNode[])
      return id
    },

    addRequest: (parentId, request) => {
      const node: CollectionNode = { id: request.id, type: 'request', request }
      commit(insertInto(topLevel(), parentId, node) as CollectionFolderNode[])
    },

    updateRequest: (requestId, request) => {
      const next = mapTree(topLevel(), (n) =>
        n.type === 'request' && n.request.id === requestId ? { ...n, request } : n
      )
      commit(next as CollectionFolderNode[])
    },

    renameNode: (id, name) => {
      const next = mapTree(topLevel(), (n) => {
        if (n.id !== id) return n
        if (n.type === 'request') return { ...n, request: { ...n.request, name } }
        return { ...n, name }
      })
      commit(next as CollectionFolderNode[])
    },

    removeNode: (id) => {
      const next = mapTree(topLevel(), (n) => (n.id === id ? null : n))
      commit(next as CollectionFolderNode[])
    },

    insertNode: (node, parentId, index) => {
      const roots = topLevel()
      if (parentId === null) {
        if (node.type !== 'collection') return false
        const next = [...roots]
        next.splice(Math.max(0, Math.min(index, next.length)), 0, node)
        commit(next as CollectionFolderNode[])
        return true
      }
      const parent = locate(roots, parentId)
      if (!parent || parent.node.type === 'request' || node.type === 'collection') return false
      commit(insertAt(roots, parentId, node, index) as CollectionFolderNode[])
      return true
    },

    moveNode: (id, newParentId, newIndex) => {
      if (id === newParentId) return

      const roots = topLevel()
      const located = locate(roots, id)
      if (!located) return
      const moving = located.node

      // Rule: a collection may only live at the top level; folders/requests may
      // never live at the top level.
      if (newParentId === null) {
        if (moving.type !== 'collection') return
      } else {
        if (moving.type === 'collection') return
        const target = locate(roots, newParentId)
        // Target parent must exist and be a container (collection or folder).
        if (!target || target.node.type === 'request') return
        // Cycle guard: cannot drop a node into itself or its own descendants.
        if (isSelfOrDescendant(moving, newParentId)) return
      }

      // Detach first, then compute the insertion index against the tree with the
      // node removed (so within-parent reordering accounts for the index shift).
      const { tree: detached, removed } = removeNode(roots, id)
      if (!removed) return

      let next: CollectionNode[]
      if (newParentId === null) {
        const clamped = Math.max(0, Math.min(newIndex, detached.length))
        next = [...detached]
        next.splice(clamped, 0, removed)
      } else {
        next = insertAt(detached, newParentId, removed, newIndex)
      }

      commit(next as CollectionFolderNode[])
    },

    moveNodes: (ids, newParentId, anchor) => {
      const roots = topLevel()
      if (newParentId !== null) {
        const target = locate(roots, newParentId)
        if (!target || target.node.type === 'request') return 0
      }
      // Tree order, so the moved nodes keep the order they had.
      const order = treeOrder(roots)
      const wanted = new Set(ids)
      const moving = order.filter((n) => {
        if (!wanted.has(n.id)) return false
        if (newParentId === null ? n.type !== 'collection' : n.type === 'collection') return false
        if (newParentId !== null && isSelfOrDescendant(n, newParentId)) return false
        // Inside another moving node: it travels with that one.
        return !order.some((o) => o !== n && wanted.has(o.id) && o.type !== 'request' && isSelfOrDescendant(o, n.id))
      })
      if (!moving.length || (anchor && moving.some((n) => n.id === anchor.id))) return 0
      let tree = roots
      const removed: CollectionNode[] = []
      for (const n of moving) {
        const r = removeNode(tree, n.id)
        tree = r.tree
        if (r.removed) removed.push(r.removed)
      }
      const siblings = newParentId === null ? tree : (locate(tree, newParentId)?.node as CollectionFolderNode).children
      let index = siblings.length
      if (anchor) {
        const at = siblings.findIndex((n) => n.id === anchor.id)
        if (at >= 0) index = anchor.side === 'after' ? at + 1 : at
      }
      let next: CollectionNode[]
      if (newParentId === null) {
        next = [...tree]
        next.splice(index, 0, ...removed)
      } else {
        next = tree
        removed.forEach((n, i) => (next = insertAt(next, newParentId, n, index + i)))
      }
      commit(next as CollectionFolderNode[])
      return removed.length
    },

    duplicateNode: (id, opts = {}) => {
      const roots = topLevel()
      const found = locate(roots, id)
      if (!found) return null
      let clone = cloneNodeWithNewIds(found.node)
      const name = opts.name?.trim()
      if (name) clone = clone.type === 'request' ? { ...clone, request: { ...clone.request, name } } : { ...clone, name }
      const parent = found.ancestors[found.ancestors.length - 1] ?? null
      if (!parent) {
        // A collection: right after the original in the list of collections.
        const next = [...roots]
        next.splice(roots.findIndex((n) => n.id === id) + 1, 0, clone)
        commit(next as CollectionFolderNode[])
        return clone.id
      }
      const targetId = opts.parentId ?? parent.id
      if (targetId === parent.id) {
        commit(insertAt(roots, parent.id, clone, parent.children.findIndex((n) => n.id === id) + 1) as CollectionFolderNode[])
        return clone.id
      }
      const target = locate(roots, targetId)
      // Into a container, never into the copied folder itself (or below it).
      if (!target || target.node.type === 'request' || isSelfOrDescendant(found.node, targetId)) return null
      commit(insertInto(roots, targetId, clone) as CollectionFolderNode[])
      return clone.id
    },

    updateFolderMeta: (id, patch) => {
      const next = mapTree(topLevel(), (n) => (n.id === id && n.type !== 'request' ? { ...n, ...patch } : n))
      commit(next as CollectionFolderNode[])
    },

    getRequest: (requestId) => {
      if (!requestId) return null
      const found = locate(topLevel(), requestId)
      return found && found.node.type === 'request' ? found.node.request : null
    },

    collectionScopeFor: (requestId) => {
      if (!requestId) return {}
      const found = locate(topLevel(), requestId)
      if (!found) return {}
      // root → leaf so deeper folders override the collection
      const merged: Record<string, string> = {}
      for (const a of found.ancestors) Object.assign(merged, flattenVariables(a.variables))
      return merged
    },

    collectionSecretValues: (requestId) => {
      if (!requestId) return []
      const found = locate(topLevel(), requestId)
      if (!found) return []
      const out: string[] = []
      for (const a of found.ancestors) {
        for (const v of a.variables ?? []) {
          if (v.secret && v.enabled && v.value) out.push(v.value)
        }
      }
      return out
    },

    inheritedAuthFor: (requestId) => {
      if (!requestId) return { type: 'none' }
      const found = locate(topLevel(), requestId)
      if (!found) return { type: 'none' }
      for (let i = found.ancestors.length - 1; i >= 0; i--) {
        const a = found.ancestors[i].auth
        if (a && a.type !== 'inherit') return a
      }
      return { type: 'none' }
    },

    ancestorScriptsFor: (requestId) => {
      if (!requestId) return []
      const found = locate(topLevel(), requestId)
      if (!found) return []
      // root → leaf: collection scripts run before nested-folder scripts.
      return found.ancestors
        .filter((a) => a.preRequestScript?.trim() || a.testScript?.trim())
        .map((a) => ({ collectionId: a.id, preRequestScript: a.preRequestScript, testScript: a.testScript }))
    },

    applyCollectionVarUpdates: (requestId, updates) => {
      if (!requestId || Object.keys(updates).length === 0) return
      const found = locate(topLevel(), requestId)
      // Postman stores collection variables on the collection root.
      const root = found?.ancestors[0]
      if (!root) return
      const nextVars = applyVarDefUpdates(root.variables ?? [], updates)
      const next = mapTree(topLevel(), (n) =>
        n.id === root.id && n.type !== 'request' ? { ...n, variables: nextVars } : n
      )
      commit(next as CollectionFolderNode[])
    },

    locate: (id) => locate(topLevel(), id)
  }
})

/** Apply key→value (or null=delete) updates to a VariableDef[] immutably. */
function applyVarDefUpdates(existing: VariableDef[], updates: Record<string, string | null>): VariableDef[] {
  const out = existing.map((v) => ({ ...v }))
  for (const [key, value] of Object.entries(updates)) {
    const idx = out.findIndex((v) => v.key === key)
    if (value === null) {
      if (idx >= 0) out.splice(idx, 1)
    } else if (idx >= 0) {
      out[idx] = { ...out[idx], value }
    } else {
      out.push({ key, value, enabled: true })
    }
  }
  return out
}

/** The name a copy gets unless the user types another: «Name (копия)». */
export function copyName(name: string): string {
  return trf('{name} (копия)', { name })
}

/**
 * Deep copy with fresh ids. Only the copied node itself is renamed «… (копия)»;
 * what is inside a copied folder keeps its names, like a copied folder on disk.
 */
function cloneNodeWithNewIds(node: CollectionNode, top = true): CollectionNode {
  if (node.type === 'request') {
    const id = makeId('req')
    const request = structuredClone(node.request)
    request.examples = request.examples?.map((ex) => ({ ...ex, id: makeId('ex') }))
    request.messageTemplates = request.messageTemplates?.map((t) => ({ ...t, id: makeId('mt') }))
    return { id, type: 'request', request: { ...request, id, name: top ? copyName(node.request.name) : node.request.name } }
  }
  return {
    ...structuredClone({ ...node, children: [] }),
    id: makeId(node.type === 'collection' ? 'col' : 'fld'),
    name: top ? copyName(node.name) : node.name,
    children: node.children.map((c) => cloneNodeWithNewIds(c, false))
  }
}

export function emptyRequest(name = 'Без названия'): RequestModel {
  return {
    id: makeId('req'),
    name,
    method: 'GET',
    url: '',
    query: [],
    headers: [],
    pathVariables: [],
    body: { type: 'none' },
    auth: { type: 'inherit' }
  }
}

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
import { emptyCollections } from './defaults'
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
  moveNode: (id: string, newParentId: string | null, newIndex: number) => void
  duplicateNode: (id: string) => void
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
    doc: emptyCollections(),
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

    duplicateNode: (id) => {
      const found = locate(topLevel(), id)
      if (!found) return
      const clone = cloneNodeWithNewIds(found.node)
      if (found.ancestors.length === 0) {
        // top-level collection
        commit([...get().doc.collections, clone as CollectionFolderNode])
      } else {
        const parent = found.ancestors[found.ancestors.length - 1]
        commit(insertInto(topLevel(), parent.id, clone) as CollectionFolderNode[])
      }
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

function cloneNodeWithNewIds(node: CollectionNode): CollectionNode {
  if (node.type === 'request') {
    const id = makeId('req')
    return { id, type: 'request', request: { ...node.request, id, name: `${node.request.name} (копия)` } }
  }
  return {
    ...node,
    id: makeId(node.type === 'collection' ? 'col' : 'fld'),
    name: `${node.name} (копия)`,
    children: node.children.map(cloneNodeWithNewIds)
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

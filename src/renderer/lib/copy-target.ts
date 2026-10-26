/**
 * Where a saved copy goes and what it is called. Shared by the Save dialog (a
 * duplicated tab being saved) and the sidebar's Duplicate dialog.
 */
import type { CollectionNode, TabModel } from '@shared/types'

export interface FolderTarget {
  id: string
  /** indented name for a flat <select> */
  label: string
  type: 'collection' | 'folder'
}

/**
 * Every collection and folder, indented by depth. `exclude` leaves out a
 * folder and everything inside it — a folder cannot be copied into itself.
 */
export function folderTargets(nodes: CollectionNode[], exclude: string | readonly string[] = [], depth = 0, out: FolderTarget[] = []): FolderTarget[] {
  const skip = typeof exclude === 'string' ? [exclude] : exclude
  for (const n of nodes) {
    if (n.type === 'request' || skip.includes(n.id)) continue
    out.push({ id: n.id, label: `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${n.name}`, type: n.type })
    folderTargets(n.children, skip, depth + 1, out)
  }
  return out
}

/** The container holding `id`, or null at the top level or when it is gone. */
export function parentIdOf(nodes: CollectionNode[], id: string, parent: string | null = null): string | null | undefined {
  for (const n of nodes) {
    if (n.id === id || (n.type === 'request' && n.request.id === id)) return parent
    if (n.type !== 'request') {
      const found = parentIdOf(n.children, id, n.id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

export interface SaveDefaults {
  /** the tab is an unsaved duplicate: the dialog offers «… (копия)» or one's own name */
  copy: boolean
  /** the name offered */
  suggested: string
  /** the folder offered: the original's for a copy, the request's own for Save As */
  parentId: string | null
}

/**
 * What the Save dialog starts with for `tab`. `name` is the tab's display name
 * and `copyName` turns it into the copy's name (both translated by the caller).
 */
export function saveDefaults(tab: TabModel | null, roots: CollectionNode[], name: string, copyName: (n: string) => string): SaveDefaults {
  if (tab && tab.copyOf !== undefined) {
    return { copy: true, suggested: copyName(name), parentId: tab.copyOf ? (parentIdOf(roots, tab.copyOf) ?? null) : null }
  }
  const own = tab?.savedRequestId ? parentIdOf(roots, tab.savedRequestId) : null
  return { copy: false, suggested: name, parentId: own ?? null }
}

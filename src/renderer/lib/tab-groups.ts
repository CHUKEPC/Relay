import type { CollectionNode } from '@shared/types'
import { useTabs } from '../store/tabs'
import { useUi } from '../store/ui'
import { tr, trf } from './i18n'

/** Past this many requests the user is asked before a folder floods the strip. */
const ASK_ABOVE = 20

type RequestNode = Extract<CollectionNode, { type: 'request' }>

function requestsOf(node: CollectionNode): RequestNode[] {
  if (node.type === 'request') return [node]
  return node.children.flatMap(requestsOf)
}

/**
 * Open requests as one tab group. Every request gets a tab of its own inside
 * the group — a tab of the same request already open in another group or
 * outside groups stays where it is, so closing this group never takes it
 * along. Opening the same source again goes back to its group (still open) and
 * adds only the requests it lacks.
 */
export function openRequestsAsGroup(requests: RequestNode[], name: string, sourceId: string): void {
  if (!requests.length) {
    useUi.getState().showToast(tr('В этой папке нет запросов'), 'error')
    return
  }
  if (requests.length > ASK_ABOVE && !window.confirm(trf('Открыть {n} запросов во вкладках?', { n: requests.length }))) return
  const tabs = useTabs.getState()
  const existing = (tabs.doc.groups ?? []).find((g) => g.sourceId === sourceId)
  if (existing) {
    const inGroup = new Set(tabs.doc.tabs.filter((t) => t.groupId === existing.id).map((t) => t.savedRequestId))
    for (const r of requests) {
      if (inGroup.has(r.request.id)) continue
      useTabs.getState().addToGroup(useTabs.getState().openSaved(r.request, r.request.id, { fresh: true }), existing.id)
    }
    const first = useTabs.getState().doc.tabs.find((t) => t.groupId === existing.id)
    if (first) useTabs.getState().setActive(first.id)
    return
  }
  const ids = requests.map((r) => useTabs.getState().openSaved(r.request, r.request.id, { fresh: true }))
  useTabs.getState().createGroup(ids, { name, sourceId })
  useTabs.getState().setActive(ids[0])
}

/** Open every request of a folder or collection as a group named after it. */
export function openNodeAsGroup(node: CollectionNode): void {
  if (node.type === 'request') return
  openRequestsAsGroup(requestsOf(node), tr(node.name), node.id)
}

/** Every request under the given nodes, each once, in tree order. */
export function requestsUnder(nodes: CollectionNode[]): RequestNode[] {
  const seen = new Set<string>()
  const out: RequestNode[] = []
  for (const n of nodes) {
    for (const r of requestsOf(n)) {
      if (seen.has(r.request.id)) continue
      seen.add(r.request.id)
      out.push(r)
    }
  }
  return out
}

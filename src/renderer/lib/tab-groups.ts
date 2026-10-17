import type { CollectionNode } from '@shared/types'
import { useTabs } from '../store/tabs'
import { useUi } from '../store/ui'
import { tr, trf } from './i18n'

/** Past this many requests the user is asked before a folder floods the strip. */
const ASK_ABOVE = 20

function requestsOf(node: CollectionNode): Extract<CollectionNode, { type: 'request' }>[] {
  if (node.type === 'request') return [node]
  return node.children.flatMap(requestsOf)
}

/**
 * Open every request of a folder or collection and gather the tabs into one
 * group named after it (requests already open are moved into the group).
 */
export function openNodeAsGroup(node: CollectionNode): void {
  if (node.type === 'request') return
  const requests = requestsOf(node)
  if (!requests.length) {
    useUi.getState().showToast(tr('В этой папке нет запросов'), 'error')
    return
  }
  if (requests.length > ASK_ABOVE && !window.confirm(trf('Открыть {n} запросов во вкладках?', { n: requests.length }))) return
  const tabs = useTabs.getState()
  const ids = requests.map((r) => tabs.openSaved(r.request, r.request.id))
  tabs.createGroup(ids, { name: tr(node.name) })
  useTabs.getState().setActive(ids[0])
}

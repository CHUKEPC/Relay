/**
 * What can be done with a sidebar selection (several ticked collections,
 * folders and requests). The selection bar and the context menu of a ticked
 * row both call these.
 */
import type { CollectionFolderNode, CollectionNode } from '@shared/types'
import { useCollections } from '../store/collections'
import { useTabs } from '../store/tabs'
import { useUi } from '../store/ui'
import { useRunner } from '../store/runner'
import { useTreeSelection } from '../store/tree-selection'
import { topSelected } from './tree-select'
import { openRequestsAsGroup, requestsUnder } from './tab-groups'
import { exportFolderJson, exportRequestJson, exportSelectionJson } from './export'
import { trashNode } from './trash'
import { tr, trf } from './i18n'

/** Past this many requests opening them asks first, like opening a group does. */
const ASK_ABOVE = 20

/** The ticked nodes an action works on (a ticked folder covers what is inside it). */
export function selectedNodes(ids?: readonly string[]): CollectionNode[] {
  return topSelected(useCollections.getState().doc.collections, ids ?? useTreeSelection.getState().ids)
}

const nameOf = (n: CollectionNode): string => (n.type === 'request' ? n.request.name : n.name)

/** Open every request of the selection in tabs (already open ones are reused). */
export function openSelected(nodes = selectedNodes()): void {
  const requests = requestsUnder(nodes)
  if (!requests.length) {
    useUi.getState().showToast(tr('В выбранном нет запросов'), 'error')
    return
  }
  if (requests.length > ASK_ABOVE && !window.confirm(trf('Открыть {n} запросов во вкладках?', { n: requests.length }))) return
  const ids = requests.map((r) => useTabs.getState().openSaved(r.request, r.request.id))
  useTabs.getState().setActive(ids[0])
}

/**
 * Open the selection as one tab group: named after the folder when only one is
 * ticked, «Выбранное» otherwise. The same selection opened again returns to
 * its group.
 */
export function openSelectedAsGroup(nodes = selectedNodes()): void {
  if (!nodes.length) return
  const one = nodes.length === 1 ? nodes[0] : null
  const name = one ? tr(nameOf(one)) : tr('Выбранное')
  const sourceId = one && one.type !== 'request' ? one.id : `sel:${nodes.map((n) => n.id).join(',')}`
  openRequestsAsGroup(requestsUnder(nodes), name, sourceId)
}

/** Export: one request or folder as before, several ticks as one collection file. */
export function exportSelected(nodes = selectedNodes()): void {
  if (!nodes.length) return
  if (nodes.length === 1) {
    const n = nodes[0]
    void (n.type === 'request' ? exportRequestJson(n.request) : exportFolderJson(n))
    return
  }
  void exportSelectionJson(useCollections.getState().doc.collections as CollectionFolderNode[], nodes.map((n) => n.id))
}

/** The runner, with the selection's requests ticked. */
export function runSelected(nodes = selectedNodes()): void {
  if (!requestsUnder(nodes).length) {
    useUi.getState().showToast(tr('В выбранном нет запросов'), 'error')
    return
  }
  useRunner.getState().openForNodes(nodes)
}

/** Everything ticked to the trash, each item restorable on its own; asks first. */
export function deleteSelected(nodes = selectedNodes()): void {
  if (!nodes.length) return
  if (nodes.length === 1) {
    trashNode(nodes[0].id)
    useTreeSelection.getState().clear()
    return
  }
  if (!window.confirm(trf('Удалить выбранное ({n})? Всё можно будет восстановить из корзины.', { n: nodes.length }))) return
  // Last first, so each recorded index is the one it had among those still there.
  for (const n of [...nodes].reverse()) trashNode(n.id, { quiet: true })
  useTreeSelection.getState().clear()
  useUi.getState().showToast(trf('Перемещено в корзину: {n}', { n: nodes.length }), 'ok', {
    label: tr('Открыть корзину'),
    run: () => useUi.getState().setTrashOpen(true)
  })
}

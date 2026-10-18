/**
 * The trash: deleting a request, folder, collection, environment, variable,
 * response example or the history moves it here first, with enough context to
 * put it back where it was. Restoring returns it to its old place; when that
 * place is gone too, it lands somewhere sensible instead of being lost.
 *
 * Every user-facing delete goes through this module. Programmatic rewrites
 * (backup restore, scripts unsetting variables) still use the stores directly.
 */
import type { CollectionNode, Environment, ResponseExample, TrashEntry, TrashVarScope, VariableDef } from '@shared/types'
import { makeId } from '@shared/id'
import { useCollections } from '../store/collections'
import { useEnvironments } from '../store/environments'
import { useHistory } from '../store/history'
import { useSettings } from '../store/settings'
import { useTabs } from '../store/tabs'
import { useTrash } from '../store/trash'
import { useUi } from '../store/ui'
import { deleteExample } from './examples'
import { tr, trf, trp } from './i18n'

/** What a caller supplies; the id and the time are stamped here. */
type NewEntry = TrashEntry extends infer E ? (E extends TrashEntry ? Omit<E, 'id' | 'deletedAt'> : never) : never

/** Name of the collection that takes items whose old parent is gone too. */
const RESTORED_COLLECTION = 'Восстановленное'

function put(entry: NewEntry): string {
  const id = makeId('trash')
  useTrash.getState().add({ ...entry, id, deletedAt: Date.now() } as TrashEntry)
  return id
}

/** «X» went to the trash — with a button that brings it straight back. */
function announce(name: string, entryId: string): void {
  useUi.getState().showToast(trf('«{name}» перемещено в корзину', { name }), 'ok', {
    label: tr('Восстановить'),
    run: () => void restoreFromTrash(entryId)
  })
}

export function nodeName(node: CollectionNode): string {
  return node.type === 'request' ? node.request.name : node.name
}

/** Request/folder/collection, as the trash list labels it. */
export function trashKindLabel(entry: TrashEntry): string {
  switch (entry.kind) {
    case 'node':
      return entry.node.type === 'request' ? 'Запрос' : entry.node.type === 'folder' ? 'Папка' : 'Коллекция'
    case 'environment':
      return 'Среда'
    case 'variable':
      return entry.scope === 'global' ? 'Глобальная переменная' : entry.scope === 'collection' ? 'Переменная коллекции' : 'Переменная среды'
    case 'example':
      return 'Пример ответа'
    case 'history':
      return 'История'
  }
}

/** A retention period as the settings and the trash dialog spell it: «7 дней», «1 год». */
export function trashPeriodLabel(days: number): string {
  if (days === 0) return tr('Пока корзину не очистят')
  if (days === 365) return tr('1 год')
  return `${days} ${trp(days, 'день', 'дня', 'дней')}`
}

/* ============================================================
 * Moving to the trash
 * ============================================================ */

/** Delete a collection node (request, folder or a whole collection) into the trash. */
export function trashNode(id: string, opts: { quiet?: boolean } = {}): string | null {
  const store = useCollections.getState()
  const found = store.locate(id)
  if (!found) return null
  const parent = found.ancestors[found.ancestors.length - 1] ?? null
  const siblings: CollectionNode[] = parent ? parent.children : store.doc.collections
  const index = Math.max(0, siblings.findIndex((n) => n.id === id))
  const name = nodeName(found.node) || 'Без названия'
  const location = found.ancestors.map((a) => tr(a.name)).join(' / ') || undefined
  store.removeNode(id)
  const entryId = put({ kind: 'node', node: structuredClone(found.node), parentId: parent?.id ?? null, index, name, location })
  if (!opts.quiet) announce(tr(name), entryId)
  return entryId
}

/** Every collection to the trash, each restorable on its own. */
export function trashAllCollections(): void {
  const ids = useCollections.getState().doc.collections.map((c) => c.id)
  // Last first, so each recorded index is the one it had among those still there.
  for (const id of [...ids].reverse()) trashNode(id, { quiet: true })
  if (ids.length) {
    useUi.getState().showToast(trf('Коллекции ({n}) перемещены в корзину', { n: ids.length }), 'ok', {
      label: tr('Открыть корзину'),
      run: () => useUi.getState().setTrashOpen(true)
    })
  }
}

export function trashEnvironment(id: string): void {
  const store = useEnvironments.getState()
  const index = store.env.environments.findIndex((e) => e.id === id)
  if (index === -1) return
  const environment = store.env.environments[index]
  const wasActive = store.env.activeEnvironmentId === id
  store.deleteEnv(id)
  const entryId = put({ kind: 'environment', environment: structuredClone(environment), index, wasActive, name: environment.name })
  announce(tr(environment.name), entryId)
}

/**
 * A variable row deleted in an editor. `ownerId` is the environment or the
 * collection it belonged to (null for globals). Blank rows are not kept.
 */
export function trashVariable(scope: TrashVarScope, ownerId: string | null, variable: VariableDef, index: number, location?: string): void {
  if (!variable.key && !variable.value) return
  const entryId = put({ kind: 'variable', variable: { ...variable }, scope, ownerId, index, name: variable.key || tr('(без имени)'), location })
  announce(variable.key || tr('(без имени)'), entryId)
}

/** Delete a response example of a tab's request into the trash. */
export function trashExample(tabId: string, exampleId: string): void {
  const tabs = useTabs.getState()
  const tab = tabs.doc.tabs.find((t) => t.id === tabId)
  const examples = tab?.request.examples ?? []
  const index = examples.findIndex((e) => e.id === exampleId)
  if (!tab || index === -1) return
  const example = examples[index]
  // deleteExample() edits the ACTIVE tab's request — activate ours first.
  if (tabs.doc.activeTabId !== tabId) tabs.setActive(tabId)
  deleteExample(exampleId)
  const entryId = put({
    kind: 'example',
    example: structuredClone(example),
    requestId: tab.request.id,
    savedRequestId: tab.savedRequestId,
    index,
    name: example.name,
    location: tab.request.name
  })
  announce(example.name, entryId)
}

/** Clear the request history into the trash (one entry holding all of it). */
export function trashHistory(): void {
  const entries = useHistory.getState().doc.entries
  if (!entries.length) return
  useHistory.getState().clear()
  const entryId = put({ kind: 'history', entries: structuredClone(entries), name: 'История запросов' })
  useUi.getState().showToast(tr('История очищена'), 'ok', { label: tr('Восстановить'), run: () => void restoreFromTrash(entryId) })
}

/* ============================================================
 * Restoring
 * ============================================================ */

function nodeExists(id: string): boolean {
  return !!useCollections.getState().locate(id)
}

/** Fresh ids throughout (names kept), for a node whose ids are taken again. */
function withNewIds(node: CollectionNode): CollectionNode {
  if (node.type === 'request') {
    const id = makeId('req')
    return { ...node, id, request: { ...node.request, id } }
  }
  return { ...node, id: makeId(node.type === 'collection' ? 'col' : 'fld'), children: node.children.map(withNewIds) }
}

function anyIdTaken(node: CollectionNode): boolean {
  if (nodeExists(node.id)) return true
  return node.type !== 'request' && node.children.some(anyIdTaken)
}

/** The collection orphans are restored into; created on first use. */
function restoredCollectionId(): string {
  const store = useCollections.getState()
  const existing = store.doc.collections.find((c) => c.name === RESTORED_COLLECTION)
  return existing ? existing.id : store.addCollection(RESTORED_COLLECTION)
}

function insertVar(vars: VariableDef[], v: VariableDef, index: number): VariableDef[] {
  const next = [...vars]
  next.splice(Math.max(0, Math.min(index, next.length)), 0, v.id && vars.some((x) => x.id === v.id) ? { ...v, id: makeId('var') } : v)
  return next
}

/**
 * Put an entry back and take it out of the trash. Returns false (and says why)
 * when there is nowhere left to put it.
 */
export function restoreFromTrash(entryId: string): boolean {
  const entry = useTrash.getState().doc.entries.find((e) => e.id === entryId)
  if (!entry) return false
  const ui = useUi.getState()
  let note: string | null = null

  switch (entry.kind) {
    case 'node': {
      const store = useCollections.getState()
      const node = anyIdTaken(entry.node) ? withNewIds(entry.node) : entry.node
      let ok = store.insertNode(node, entry.parentId, entry.index)
      if (!ok) {
        // The folder it lived in was deleted as well.
        if (node.type === 'collection') ok = store.insertNode(node, null, entry.index)
        else {
          ok = store.insertNode(node, restoredCollectionId(), Number.MAX_SAFE_INTEGER)
          note = trf('Папка, где лежал элемент, удалена — он восстановлен в коллекцию «{name}»', { name: tr(RESTORED_COLLECTION) })
        }
      }
      if (!ok) return false
      break
    }
    case 'environment': {
      const store = useEnvironments.getState()
      const taken = store.env.environments.some((e) => e.id === entry.environment.id)
      const environment: Environment = taken ? { ...entry.environment, id: makeId('env') } : entry.environment
      store.insertEnvironment(environment, entry.index, entry.wasActive && !store.env.activeEnvironmentId)
      break
    }
    case 'variable': {
      const env = useEnvironments.getState()
      const v = entry.variable
      if (entry.scope === 'environment' && entry.ownerId && env.env.environments.some((e) => e.id === entry.ownerId)) {
        const target = env.env.environments.find((e) => e.id === entry.ownerId)!
        env.setEnvVars(target.id, insertVar(target.variables, v, entry.index))
      } else if (entry.scope === 'collection' && entry.ownerId) {
        const found = useCollections.getState().locate(entry.ownerId)
        if (found && found.node.type !== 'request') {
          useCollections.getState().updateFolderMeta(found.node.id, { variables: insertVar(found.node.variables ?? [], v, entry.index) })
        } else {
          env.setGlobalVars(insertVar(env.globals.variables, v, env.globals.variables.length))
          note = tr('Коллекция переменной удалена — переменная восстановлена в глобальные')
        }
      } else {
        const index = entry.scope === 'global' ? entry.index : env.globals.variables.length
        env.setGlobalVars(insertVar(env.globals.variables, v, index))
        if (entry.scope !== 'global') note = tr('Среда переменной удалена — переменная восстановлена в глобальные')
      }
      break
    }
    case 'example': {
      const tabs = useTabs.getState()
      const insert = (list: ResponseExample[] | undefined): ResponseExample[] => {
        const next = [...(list ?? [])]
        next.splice(Math.max(0, Math.min(entry.index, next.length)), 0, entry.example)
        return next
      }
      const saved = entry.savedRequestId ? useCollections.getState().getRequest(entry.savedRequestId) : null
      if (saved && entry.savedRequestId) {
        const request = { ...saved, examples: insert(saved.examples) }
        useCollections.getState().updateRequest(entry.savedRequestId, request)
        // Open tabs of that request: a clean one follows the collection, a draft gets the example too.
        tabs.refreshSaved({ [entry.savedRequestId]: request })
        for (const t of useTabs.getState().doc.tabs) {
          if (t.savedRequestId === entry.savedRequestId && t.dirty) tabs.patchTab(t.id, { examples: insert(t.request.examples) })
        }
      } else {
        const tab = tabs.doc.tabs.find((t) => t.request.id === entry.requestId)
        if (!tab) {
          ui.showToast(tr('Запрос этого примера больше не существует'), 'error')
          return false
        }
        tabs.patchTab(tab.id, { examples: insert(tab.request.examples) })
      }
      break
    }
    case 'history': {
      const current = useHistory.getState().doc.entries
      const seen = new Set<string>()
      const merged = [...entry.entries, ...current]
        .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
        .sort((a, b) => b.at - a.at)
      const max = useSettings.getState().settings.maxHistory
      useHistory.getState().setAll(max > 0 ? merged.slice(0, Math.max(max, entry.entries.length)) : merged)
      break
    }
  }

  useTrash.getState().remove(entryId)
  ui.showToast(note ?? trf('«{name}» восстановлено', { name: tr(entry.name) }))
  return true
}

/** Delete one entry for good. */
export function purgeFromTrash(entryId: string): void {
  useTrash.getState().remove(entryId)
}

export function emptyTrash(): void {
  useTrash.getState().clear()
}

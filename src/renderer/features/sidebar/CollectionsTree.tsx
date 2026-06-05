import * as ContextMenu from '@radix-ui/react-context-menu'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { CollectionNode } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useCollections, emptyRequest } from '@renderer/store/collections'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useRunner } from '@renderer/store/runner'
import { ImportDialog } from '@renderer/features/data/ImportDialog'

function MethodTag({ m }: { m: string }) {
  return <span className={`method-tag mtag m-${m}`}>{m === 'DELETE' ? 'DEL' : m}</span>
}

/** Where a dragged node will land relative to the row it is hovering. */
type DropIntent = 'before' | 'after' | 'into'

/**
 * Id of the node currently being dragged. A module-level ref is the most
 * reliable cross-row channel during a native HTML5 drag (dataTransfer.getData
 * is unreadable during dragover, only on drop), and it survives re-renders.
 */
const dragState: { id: string | null } = { id: null }

export function CollectionsTree({ query }: { query: string }) {
  const collections = useCollections((s) => s.doc.collections)
  const addCollection = useCollections((s) => s.addCollection)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <div className="side-section-head">
        <span>Коллекции</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Импорт" onClick={() => setImportOpen(true)}>
            <Icon name="download" size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title="Новая коллекция"
            onClick={() => {
              const id = addCollection('New Collection')
              setRenameId(id)
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <div className="tree">
        {collections.map((n) => (
          <TreeNode key={n.id} node={n} depth={0} query={query} renameId={renameId} setRenameId={setRenameId} />
        ))}
        {collections.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--tx-3)', fontSize: 12 }}>Нет коллекций</div>
        )}
      </div>
    </>
  )
}

function nodeMatches(node: CollectionNode, q: string): boolean {
  if (!q) return true
  const lower = q.toLowerCase()
  if (node.type === 'request') return node.request.name.toLowerCase().includes(lower) || node.request.url.toLowerCase().includes(lower)
  return node.name.toLowerCase().includes(lower) || node.children.some((c) => nodeMatches(c, q))
}

/** True if `id` is `node` itself or a descendant of `node`. */
function isWithin(node: CollectionNode, id: string): boolean {
  if (node.id === id) return true
  if (node.type === 'request') return false
  return node.children.some((c) => isWithin(c, id))
}

/**
 * Decide where a drop of `dragged` onto `target` would land.
 * Returns null when the intent is invalid (so we neither show an indicator nor
 * call moveNode). Mirrors the validation in the store's moveNode.
 */
function resolveIntent(dragged: CollectionNode, target: CollectionNode, rawIntent: DropIntent): DropIntent | null {
  // Never drop onto the dragged node itself, nor anywhere inside its own subtree
  // (that would create a cycle, or be a no-op placement next to itself).
  if (isWithin(dragged, target.id)) return null

  if (target.type === 'request') {
    // Requests accept only sibling placement (before/after), never "into".
    return rawIntent === 'into' ? null : rawIntent
  }

  // Collections may only live at the top level → can only sit before/after
  // another top-level collection, and a collection can never go "into" anything.
  if (dragged.type === 'collection') {
    if (target.type !== 'collection') return null
    return rawIntent === 'into' ? null : rawIntent
  }

  // Folder/request over a folder or collection: all three intents are allowed.
  // A "before"/"after" on a collection would make it a top-level sibling, which
  // is illegal for folders/requests — coerce to "into" instead.
  if (target.type === 'collection' && rawIntent !== 'into') return 'into'
  return rawIntent
}

/** Pointer position → raw intent. Middle band of a container row means "into". */
function intentFromPointer(e: DragEvent, allowInto: boolean): DropIntent {
  const rect = e.currentTarget.getBoundingClientRect()
  const offset = e.clientY - rect.top
  const h = rect.height
  if (!allowInto) return offset < h / 2 ? 'before' : 'after'
  if (offset < h * 0.3) return 'before'
  if (offset > h * 0.7) return 'after'
  return 'into'
}

function TreeNode({
  node,
  depth,
  query,
  renameId,
  setRenameId
}: {
  node: CollectionNode
  depth: number
  query: string
  renameId: string | null
  setRenameId: (id: string | null) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  // Where a dragged node would land relative to this row (drives the indicator).
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null)
  const openSaved = useTabs((s) => s.openSaved)
  const activeSavedId = useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.savedRequestId ?? null)
  const store = useCollections()
  const showToast = useUi((s) => s.showToast)

  if (!nodeMatches(node, query)) return null
  const expanded = query ? true : open

  const renaming = renameId === node.id
  const name = node.type === 'request' ? node.request.name : node.name
  const isContainer = node.type !== 'request'

  const commitRename = (value: string) => {
    if (value.trim()) store.renameNode(node.id, value.trim())
    setRenameId(null)
  }

  // --- Drag & drop ---------------------------------------------------------
  const handleDragStart = (e: DragEvent) => {
    // Don't start a node drag while editing its name (let the input handle text).
    if (renaming) {
      e.preventDefault()
      return
    }
    e.stopPropagation()
    dragState.id = node.id
    e.dataTransfer.setData('text/plain', node.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const computeIntent = (e: DragEvent): DropIntent | null => {
    const draggedId = dragState.id
    if (!draggedId || draggedId === node.id) return null
    const dragged = store.locate(draggedId)
    if (!dragged) return null
    const raw = intentFromPointer(e, isContainer)
    return resolveIntent(dragged.node, node, raw)
  }

  const handleDragOver = (e: DragEvent) => {
    const intent = computeIntent(e)
    if (!intent) {
      if (dropIntent) setDropIntent(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (intent !== dropIntent) setDropIntent(intent)
  }

  const handleDragLeave = (e: DragEvent) => {
    // Only clear when the pointer actually leaves this row (not a child element).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropIntent(null)
  }

  const handleDrop = (e: DragEvent) => {
    const intent = computeIntent(e)
    const draggedId = dragState.id ?? e.dataTransfer.getData('text/plain')
    setDropIntent(null)
    dragState.id = null
    if (!intent || !draggedId || draggedId === node.id) return
    e.preventDefault()
    e.stopPropagation()

    if (intent === 'into') {
      // Append to the end of this container, then reveal it.
      store.moveNode(draggedId, node.id, Number.MAX_SAFE_INTEGER)
      setOpen(true)
      return
    }

    // Sibling placement: parent is this node's parent, index relative to it.
    const located = store.locate(node.id)
    if (!located) return
    const parent = located.ancestors[located.ancestors.length - 1] ?? null
    const parentId = parent ? parent.id : null
    const siblings = parent ? parent.children : store.doc.collections
    const selfIndex = siblings.findIndex((s) => s.id === node.id)
    if (selfIndex < 0) return
    let index = intent === 'after' ? selfIndex + 1 : selfIndex
    // moveNode's index is defined against the array AFTER the dragged node is
    // removed. If the dragged node currently sits in this same parent BEFORE the
    // target, its removal shifts the target down by one, so decrement.
    const draggedIndex = siblings.findIndex((s) => s.id === draggedId)
    if (draggedIndex >= 0 && draggedIndex < index) index -= 1
    store.moveNode(draggedId, parentId, index)
  }

  const handleDragEnd = () => {
    dragState.id = null
    setDropIntent(null)
  }

  const dndProps = {
    draggable: !renaming,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragEnter: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd
  }
  const dropClass =
    dropIntent === 'into' ? ' drop-into' : dropIntent === 'before' ? ' drop-before' : dropIntent === 'after' ? ' drop-after' : ''

  const menuItems =
    node.type === 'request' ? (
      <>
        <ContextMenu.Item className="pop-item" onSelect={() => openSaved(node.request, node.request.id)}>
          <Icon name="arrowR" size={14} /> Открыть
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => store.duplicateNode(node.id)}>
          <Icon name="copy" size={14} /> Дублировать
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => setRenameId(node.id)}>
          <Icon name="doc" size={14} /> Переименовать
        </ContextMenu.Item>
        <ContextMenu.Separator className="pop-sep" />
        <ContextMenu.Item className="pop-item" style={{ color: 'var(--s-5xx)' }} onSelect={() => store.removeNode(node.id)}>
          <Icon name="trash" size={14} /> Удалить
        </ContextMenu.Item>
      </>
    ) : (
      <>
        <ContextMenu.Item
          className="pop-item"
          onSelect={() => {
            const r = emptyRequest('New Request')
            store.addRequest(node.id, r)
            openSaved(r, r.id)
          }}
        >
          <Icon name="plus" size={14} /> Новый запрос
        </ContextMenu.Item>
        <ContextMenu.Item
          className="pop-item"
          onSelect={() => {
            const id = store.addFolder(node.id, 'New Folder')
            setRenameId(id)
          }}
        >
          <Icon name="folder" size={14} /> Новая папка
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => setRenameId(node.id)}>
          <Icon name="doc" size={14} /> Переименовать
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => store.duplicateNode(node.id)}>
          <Icon name="copy" size={14} /> Дублировать
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => useRunner.getState().openFor(node)}>
          <Icon name="play" size={14} /> Запустить
        </ContextMenu.Item>
        {node.type === 'collection' && (
          <ContextMenu.Item
            className="pop-item"
            onSelect={async () => {
              const json = await window.api.exportCollection(JSON.stringify(node))
              const saved = await window.api.saveFile({ defaultName: `${node.name}.postman_collection.json`, content: json })
              if (saved) showToast('Коллекция экспортирована')
            }}
          >
            <Icon name="download" size={14} /> Экспорт (Postman v2.1)
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator className="pop-sep" />
        <ContextMenu.Item
          className="pop-item"
          style={{ color: 'var(--s-5xx)' }}
          onSelect={() => {
            if (window.confirm(`Удалить «${node.name}» и всё содержимое?`)) store.removeNode(node.id)
          }}
        >
          <Icon name="trash" size={14} /> Удалить
        </ContextMenu.Item>
      </>
    )

  const row =
    node.type === 'request' ? (
      <div
        className={`tree-row${activeSavedId === node.request.id ? ' active' : ''}${dropClass}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => openSaved(node.request, node.request.id)}
        {...dndProps}
      >
        <span className="twirl" style={{ marginLeft: 14 }}>
          <Icon name="doc" size={14} style={{ opacity: 0.55 }} />
        </span>
        {renaming ? (
          <RenameInput initial={name} onCommit={commitRename} />
        ) : (
          <span className="name">{node.request.name}</span>
        )}
        <MethodTag m={node.request.method} />
      </div>
    ) : (
      <div
        className={`tree-row${dropClass}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((o) => !o)}
        {...dndProps}
      >
        <span className="chev">
          <Icon name={expanded ? 'chevD' : 'chevR'} size={12} />
        </span>
        <span className="twirl">
          <Icon name="folder" size={15} />
        </span>
        {renaming ? (
          <RenameInput initial={name} onCommit={commitRename} />
        ) : (
          <span className="name" style={{ fontWeight: depth === 0 ? 600 : 500 }}>
            {node.name}
          </span>
        )}
      </div>
    )

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="popover" style={{ position: 'relative', minWidth: 180 }}>
            {menuItems}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {node.type !== 'request' && expanded && (
        <div className="tree-children">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} query={query} renameId={renameId} setRenameId={setRenameId} />
          ))}
        </div>
      )}
    </div>
  )
}

function RenameInput({ initial, onCommit }: { initial: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  // Commit exactly once — Enter/Escape commit then blur, and onBlur must not
  // re-commit (which would override an Escape-cancel with the typed value).
  const done = useRef(false)
  const commit = (v: string) => {
    if (done.current) return
    done.current = true
    onCommit(v)
  }
  return (
    <input
      className="inline-edit"
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(value)
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          commit(initial)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

import * as ContextMenu from '@radix-ui/react-context-menu'
import { useEffect, useRef, useState } from 'react'
import { EnvEditor } from '@renderer/features/environments/EnvEditor'
import type { DragEvent } from 'react'
import type { CollectionNode } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useCollections, emptyRequest } from '@renderer/store/collections'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useRunner } from '@renderer/store/runner'
import { ImportDialog } from '@renderer/features/data/ImportDialog'
import { REQUEST_MIME } from '@renderer/lib/dnd'
import { exportFolderJson, exportRequestJson } from '@renderer/lib/export'
import { RequestTag } from '@renderer/components/RequestTag'

import { tr, trf } from '@renderer/lib/i18n'
/** Where a dragged node will land relative to the row it is hovering. */
type DropIntent = 'before' | 'after' | 'into'

/** Node whose name is being edited; `isNew` nodes are deleted when the edit is cancelled. */
interface RenameState {
  id: string
  isNew: boolean
}

/**
 * Id of the node currently being dragged. A module-level ref is the most
 * reliable cross-row channel during a native HTML5 drag (dataTransfer.getData
 * is unreadable during dragover, only on drop), and it survives re-renders.
 */
const dragState: { id: string | null } = { id: null }

export function CollectionsTree({ query }: { query: string }) {
  const collections = useCollections((s) => s.doc.collections)
  const addCollection = useCollections((s) => s.addCollection)
  const setAll = useCollections((s) => s.setAll)
  const [rename, setRename] = useState<RenameState | null>(null)
  // Global so the command palette can open the dialog too.
  const importOpen = useUi((s) => s.importOpen)
  const setImportOpen = useUi((s) => s.setImportOpen)

  const deleteAll = () => {
    const n = collections.length
    if (n === 0) return
    if (window.confirm(trf('Удалить все коллекции ({n})? Это действие необратимо.', { n }))) setAll([])
  }

  return (
    <>
      <div className="side-section-head">
        <span>{tr('Коллекции')}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {collections.length > 0 && (
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title={tr('Удалить все коллекции')}
              onClick={deleteAll}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
          <button className="icon-btn" style={{ width: 22, height: 22 }} title={tr('Импорт')} onClick={() => setImportOpen(true)}>
            <Icon name="download" size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title={tr('Новая коллекция')}
            onClick={() => {
              const id = addCollection(tr('Новая коллекция'))
              setRename({ id, isNew: true })
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <div className="tree">
        {collections.map((n) => (
          <TreeNode key={n.id} node={n} depth={0} query={query} rename={rename} setRename={setRename} />
        ))}
        {collections.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--tx-3)', fontSize: 12 }}>{tr('Нет коллекций')}</div>
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
  rename,
  setRename
}: {
  node: CollectionNode
  depth: number
  query: string
  rename: RenameState | null
  setRename: (r: RenameState | null) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  // Where a dragged node would land relative to this row (drives the indicator).
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null)
  // Collection variables editor (Postman's collection scope), opened from the menu.
  const [varsOpen, setVarsOpen] = useState(false)
  const openSaved = useTabs((s) => s.openSaved)
  const activeSavedId = useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.savedRequestId ?? null)
  const store = useCollections()

  if (!nodeMatches(node, query)) return null
  const expanded = query ? true : open

  const renaming = rename?.id === node.id
  const name = node.type === 'request' ? node.request.name : node.name
  const isContainer = node.type !== 'request'

  const commitRename = (value: string) => {
    if (value.trim()) store.renameNode(node.id, value.trim())
    setRename(null)
  }

  const cancelRename = () => {
    if (rename?.isNew) store.removeNode(node.id)
    setRename(null)
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
    // A saved request can also be dropped onto the pane grid to open it there.
    if (node.type === 'request') {
      e.dataTransfer.setData(REQUEST_MIME, node.id)
      document.body.classList.add('pane-dragging')
    }
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
    document.body.classList.remove('pane-dragging')
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
          <Icon name="arrowR" size={14} /> {tr('Открыть')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => store.duplicateNode(node.id)}>
          <Icon name="copy" size={14} /> {tr('Дублировать')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => void exportRequestJson(node.request)}>
          <Icon name="download" size={14} /> {tr('Экспорт')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => setRename({ id: node.id, isNew: false })}>
          <Icon name="doc" size={14} /> {tr('Переименовать')} </ContextMenu.Item>
        <ContextMenu.Separator className="pop-sep" />
        <ContextMenu.Item className="pop-item" style={{ color: 'var(--s-5xx)' }} onSelect={() => store.removeNode(node.id)}>
          <Icon name="trash" size={14} /> {tr('Удалить')} </ContextMenu.Item>
      </>
    ) : (
      <>
        <ContextMenu.Item
          className="pop-item"
          onSelect={() => {
            const r = emptyRequest(tr('Новый запрос'))
            store.addRequest(node.id, r)
            openSaved(r, r.id)
          }}
        >
          <Icon name="plus" size={14} /> {tr('Новый запрос')} </ContextMenu.Item>
        <ContextMenu.Item
          className="pop-item"
          onSelect={() => {
            const id = store.addFolder(node.id, tr('Новая папка'))
            setOpen(true)
            setRename({ id, isNew: true })
          }}
        >
          <Icon name="folder" size={14} /> {tr('Новая папка')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => setRename({ id: node.id, isNew: false })}>
          <Icon name="doc" size={14} /> {tr('Переименовать')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => store.duplicateNode(node.id)}>
          <Icon name="copy" size={14} /> {tr('Дублировать')} </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => void exportFolderJson(node)}>
          <Icon name="download" size={14} /> {node.type === 'collection' ? tr('Экспорт (Postman v2.1)') : tr('Экспорт')}
        </ContextMenu.Item>
        <ContextMenu.Item className="pop-item" onSelect={() => useRunner.getState().openFor(node)}>
          <Icon name="play" size={14} /> {tr('Запустить')} </ContextMenu.Item>
        {node.type === 'collection' && (
          <ContextMenu.Item className="pop-item" onSelect={() => setVarsOpen(true)}>
            <Icon name="env" size={14} /> {tr('Переменные коллекции')}
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator className="pop-sep" />
        <ContextMenu.Item
          className="pop-item"
          style={{ color: 'var(--s-5xx)' }}
          onSelect={() => {
            if (window.confirm(trf('Удалить «{name}» и всё содержимое?', { name: tr(node.name) }))) store.removeNode(node.id)
          }}
        >
          <Icon name="trash" size={14} /> {tr('Удалить')} </ContextMenu.Item>
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
          <RenameInput initial={name} onCommit={commitRename} onCancel={cancelRename} />
        ) : (
          <span className="name">{node.request.name}</span>
        )}
        <RequestTag request={node.request} className="mtag" />
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
          <RenameInput initial={name} onCommit={commitRename} onCancel={cancelRename} />
        ) : (
          <span className="name" style={{ fontWeight: depth === 0 ? 600 : 500 }}>
            {node.name}
          </span>
        )}
        {node.type === 'collection' && !renaming && (
          <button
            className="row-action"
            title={tr('Экспорт коллекции (Postman v2.1)')}
            onClick={(e) => {
              e.stopPropagation()
              void exportFolderJson(node)
            }}
          >
            <Icon name="download" size={13} />
          </button>
        )}
      </div>
    )

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="popover"
            style={{ position: 'relative', minWidth: 180 }}
            // Returning focus to the row would steal it from a just-opened name editor.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {menuItems}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {varsOpen && <EnvEditor target={{ kind: 'collection', id: node.id }} onClose={() => setVarsOpen(false)} />}
      {node.type !== 'request' && expanded && (
        <div className="tree-children">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} query={query} rename={rename} setRename={setRename} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Inline name editor: Enter or ✓ saves, Esc / ✕ / Backspace on an empty field
 * cancels, and a click anywhere outside saves. Outside clicks are detected with
 * a document listener rather than blur — blur never fires when the input did
 * not hold focus, e.g. after a context menu restored focus to its trigger.
 */
function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const valueRef = useRef(initial)
  valueRef.current = value
  const wrapRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) onCommit(valueRef.current)
    else onCancel()
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    const raf = requestAnimationFrame(focus)
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      finishRef.current(true)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [])

  return (
    <span className="inline-edit-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="inline-edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
          } else if (e.key === 'Escape' || (e.key === 'Backspace' && value === '')) {
            e.preventDefault()
            finish(false)
          }
        }}
      />
      <button type="button" className="inline-edit-btn ok" title={tr('Сохранить (Enter)')} onMouseDown={(e) => e.preventDefault()} onClick={() => finish(true)}>
        <Icon name="check" size={13} />
      </button>
      <button type="button" className="inline-edit-btn cancel" title={tr('Отменить (Esc)')} onMouseDown={(e) => e.preventDefault()} onClick={() => finish(false)}>
        <Icon name="close" size={13} />
      </button>
    </span>
  )
}

import * as ContextMenu from '@radix-ui/react-context-menu'
import { useState } from 'react'
import type { CollectionNode } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useCollections, emptyRequest } from '@renderer/store/collections'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { ImportDialog } from '@renderer/features/data/ImportDialog'

function MethodTag({ m }: { m: string }) {
  return <span className={`method-tag mtag m-${m}`}>{m === 'DELETE' ? 'DEL' : m}</span>
}

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
  const openSaved = useTabs((s) => s.openSaved)
  const activeSavedId = useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.savedRequestId ?? null)
  const store = useCollections()
  const showToast = useUi((s) => s.showToast)

  if (!nodeMatches(node, query)) return null
  const expanded = query ? true : open

  const renaming = renameId === node.id
  const name = node.type === 'request' ? node.request.name : node.name

  const commitRename = (value: string) => {
    if (value.trim()) store.renameNode(node.id, value.trim())
    setRenameId(null)
  }

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
        className={`tree-row ${activeSavedId === node.request.id ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => openSaved(node.request, node.request.id)}
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
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen((o) => !o)}>
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
  return (
    <input
      className="inline-edit"
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') onCommit(initial)
      }}
    />
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { CollectionNode } from '@shared/types'
import { Modal } from '@renderer/components/primitives'
import { useCollections } from '@renderer/store/collections'

interface Target {
  id: string
  label: string
}

function flattenFolders(nodes: CollectionNode[], depth: number, out: Target[]) {
  for (const n of nodes) {
    if (n.type === 'request') continue
    out.push({ id: n.id, label: `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${n.name}` })
    flattenFolders(n.children, depth + 1, out)
  }
}

export function SaveDialog({
  open,
  initialName,
  onOpenChange,
  onSave
}: {
  open: boolean
  initialName: string
  onOpenChange: (o: boolean) => void
  onSave: (parentId: string, name: string) => void
}) {
  const collections = useCollections((s) => s.doc.collections)
  const addCollection = useCollections((s) => s.addCollection)
  const targets = useMemo(() => {
    const out: Target[] = []
    flattenFolders(collections, 0, out)
    return out
  }, [collections])

  const [name, setName] = useState(initialName)
  const [parentId, setParentId] = useState(targets[0]?.id ?? '')

  // Reset the name when the dialog (re)opens.
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  // Keep the selected parent valid — re-seed if it no longer exists (e.g. the
  // folder was deleted while the dialog was closed), so confirm() can't save
  // into a non-existent parent.
  useEffect(() => {
    setParentId((cur) => (cur && targets.some((t) => t.id === cur) ? cur : targets[0]?.id ?? ''))
  }, [open, targets])

  const confirm = () => {
    let target = parentId
    if (!target) target = addCollection('My Collection')
    onSave(target, name.trim() || 'Untitled')
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Сохранить запрос" width={460}>
      <div className="field">
        <label>Название</label>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
      </div>
      <div className="field">
        <label>Куда сохранить</label>
        {targets.length ? (
          <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ fontFamily: 'var(--font-ui)' }}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)' }}>Коллекций нет — будет создана новая «My Collection».</div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}>
          Отмена
        </button>
        <button className="btn primary" onClick={confirm}>
          Сохранить
        </button>
      </div>
    </Modal>
  )
}

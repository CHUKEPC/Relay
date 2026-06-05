import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '@renderer/components/Icon'
import { Field, Modal } from '@renderer/components/primitives'
import { useWorkspaces } from '@renderer/store/workspaces'

/** Titlebar workspace switcher: switch / create / rename / delete local workspaces. */
export function WorkspaceSwitcher(): JSX.Element {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const activeId = useWorkspaces((s) => s.activeId)
  const busy = useWorkspaces((s) => s.busy)
  const [createOpen, setCreateOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const active = workspaces.find((w) => w.id === activeId)

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <div className="env-pill nodrag" title="Рабочее пространство" style={{ background: 'var(--bg-1)' }}>
            <Icon name="grid" size={13} style={{ color: 'var(--tx-3)' }} />
            {active?.name ?? 'Workspace'}
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)' }} />
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="start" sideOffset={6} style={{ position: 'relative', minWidth: 220 }}>
            <div style={{ padding: '4px 10px 6px', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>
              Рабочие пространства
            </div>
            {workspaces.map((w) => (
              <DropdownMenu.Item
                key={w.id}
                className={`pop-item ${w.id === activeId ? 'on' : ''}`}
                onSelect={() => void useWorkspaces.getState().switchTo(w.id)}
                disabled={busy}
              >
                <Icon name="grid" size={14} style={{ color: 'var(--tx-3)' }} />
                <span style={{ flex: 1 }}>{w.name}</span>
                {w.id === activeId && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="pop-sep" />
            <DropdownMenu.Item className="pop-item" onSelect={() => setCreateOpen(true)}>
              <Icon name="plus" size={14} /> Новое пространство…
            </DropdownMenu.Item>
            <DropdownMenu.Item className="pop-item" onSelect={() => setManageOpen(true)}>
              <Icon name="settings" size={14} /> Управление…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateModal open={createOpen} onOpenChange={setCreateOpen} />
      <ManageModal open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}

function CreateModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const [name, setName] = useState('')
  const commit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    void useWorkspaces.getState().create(trimmed)
    setName('')
    onOpenChange(false)
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Новое рабочее пространство" width={420}>
      <Field label="Название" hint="Изолированный набор коллекций, сред, истории и вкладок.">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="Personal" />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" onClick={() => onOpenChange(false)}>
          Отмена
        </button>
        <button className="btn primary" onClick={commit}>
          Создать
        </button>
      </div>
    </Modal>
  )
}

function ManageModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const workspaces = useWorkspaces((s) => s.workspaces)
  const activeId = useWorkspaces((s) => s.activeId)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (id: string, name: string): void => {
    setEditId(id)
    setDraft(name)
  }
  const commitEdit = (): void => {
    if (editId && draft.trim()) void useWorkspaces.getState().rename(editId, draft.trim())
    setEditId(null)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Управление пространствами" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {workspaces.map((w) => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-2)' }}>
            <Icon name="grid" size={14} style={{ color: 'var(--tx-3)' }} />
            {editId === w.id ? (
              <input
                className="input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditId(null)
                }}
                style={{ flex: 1 }}
              />
            ) : (
              <span style={{ flex: 1, fontSize: 12.5 }}>
                {w.name}
                {w.id === activeId && <span style={{ color: 'var(--tx-3)', fontSize: 11 }}> · активно</span>}
              </span>
            )}
            <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => startEdit(w.id, w.name)} title="Переименовать">
              <Icon name="doc" size={14} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28, color: workspaces.length <= 1 ? 'var(--tx-3)' : 'var(--s-5xx)' }}
              disabled={workspaces.length <= 1}
              onClick={() => {
                if (window.confirm(`Удалить пространство «${w.name}» и все его данные?`)) void useWorkspaces.getState().remove(w.id)
              }}
              title={workspaces.length <= 1 ? 'Нельзя удалить последнее' : 'Удалить'}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

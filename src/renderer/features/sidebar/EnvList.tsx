import * as ContextMenu from '@radix-ui/react-context-menu'
import { useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useEnvironments } from '@renderer/store/environments'
import { EnvEditor, type EnvEditorTarget } from '@renderer/features/environments/EnvEditor'

export function EnvList() {
  const env = useEnvironments((s) => s.env)
  const setActiveEnv = useEnvironments((s) => s.setActiveEnv)
  const createEnv = useEnvironments((s) => s.createEnv)
  const duplicateEnv = useEnvironments((s) => s.duplicateEnv)
  const deleteEnv = useEnvironments((s) => s.deleteEnv)
  const [editor, setEditor] = useState<EnvEditorTarget>(null)

  return (
    <>
      <div className="side-section-head">
        <span>Среды</span>
        <button
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title="Новая среда"
          onClick={() => {
            const id = createEnv('Новая среда')
            setEditor({ kind: 'env', id })
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="tree">
        <div
          className={`env-row ${env.activeEnvironmentId === null ? 'active' : ''}`}
          onClick={() => setActiveEnv(null)}
        >
          <Icon name="env" size={15} style={{ color: 'var(--tx-3)', opacity: 0.9 }} />
          <span className="ename">Без окружения</span>
          {env.activeEnvironmentId === null && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
        </div>

        {env.environments.map((e) => (
          <ContextMenu.Root key={e.id}>
            <ContextMenu.Trigger asChild>
              <div className={`env-row ${env.activeEnvironmentId === e.id ? 'active' : ''}`} onClick={() => setActiveEnv(e.id)}>
                <Icon name="env" size={15} style={{ color: 'var(--m-get)', opacity: 0.9 }} />
                <span className="ename">{e.name}</span>
                <button
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setEditor({ kind: 'env', id: e.id })
                  }}
                  title="Редактировать переменные"
                >
                  <Icon name="settings" size={13} />
                </button>
                {env.activeEnvironmentId === e.id && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="popover" style={{ position: 'relative', minWidth: 170 }}>
                <ContextMenu.Item className="pop-item" onSelect={() => setEditor({ kind: 'env', id: e.id })}>
                  <Icon name="settings" size={14} /> Переменные
                </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => duplicateEnv(e.id)}>
                  <Icon name="copy" size={14} /> Дублировать
                </ContextMenu.Item>
                <ContextMenu.Separator className="pop-sep" />
                <ContextMenu.Item
                  className="pop-item"
                  style={{ color: 'var(--s-5xx)' }}
                  onSelect={() => {
                    if (window.confirm(`Удалить среду «${e.name}»?`)) deleteEnv(e.id)
                  }}
                >
                  <Icon name="trash" size={14} /> Удалить
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ))}

        <div className="env-row" onClick={() => setEditor({ kind: 'globals' })} style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <Icon name="grid" size={15} style={{ color: 'var(--tx-2)' }} />
          <span className="ename">Глобальные переменные</span>
          <Icon name="arrowR" size={13} style={{ color: 'var(--tx-3)' }} />
        </div>
      </div>

      <EnvEditor target={editor} onClose={() => setEditor(null)} />
    </>
  )
}

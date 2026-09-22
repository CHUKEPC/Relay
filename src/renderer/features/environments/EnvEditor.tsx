import { useState } from 'react'
import type { VariableDef } from '@shared/types'
import { makeId } from '@shared/id'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/primitives'
import { useEnvironments } from '@renderer/store/environments'
import { useCollections } from '@renderer/store/collections'
import { VarImportDialog } from './VarImportDialog'
import { VarExportDialog } from './VarExportDialog'

import { tr, trf } from '@renderer/lib/i18n'
/** `collection` edits the variables of a collection or folder (Postman's collection scope). */
export type EnvEditorTarget = { kind: 'env'; id: string } | { kind: 'globals' } | { kind: 'collection'; id: string } | null

export function EnvEditor({ target, onClose }: { target: EnvEditorTarget; onClose: () => void }) {
  const env = useEnvironments((s) => s.env)
  const globals = useEnvironments((s) => s.globals)
  const setEnvVars = useEnvironments((s) => s.setEnvVars)
  const setGlobalVars = useEnvironments((s) => s.setGlobalVars)
  const renameEnv = useEnvironments((s) => s.renameEnv)
  const folder = useCollections((s) => {
    if (target?.kind !== 'collection') return null
    const found = s.locate(target.id)
    return found && found.node.type !== 'request' ? found.node : null
  })
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  if (!target) return null

  const isGlobals = target.kind === 'globals'
  const environment = target.kind === 'env' ? env.environments.find((e) => e.id === target.id) : undefined
  const vars: VariableDef[] = isGlobals ? globals.variables : target.kind === 'collection' ? folder?.variables ?? [] : environment?.variables ?? []
  const title = isGlobals
    ? tr('Глобальные переменные')
    : target.kind === 'collection'
      ? trf('Переменные «{name}»', { name: folder?.name ?? '' })
      : tr(environment?.name || 'Среда')

  const commit = (next: VariableDef[]) => {
    if (isGlobals) setGlobalVars(next)
    else if (target.kind === 'collection') folder && useCollections.getState().updateFolderMeta(folder.id, { variables: withIds(next) })
    else if (environment) setEnvVars(environment.id, next)
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} width={680} title={undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Icon name={target.kind === 'collection' ? 'folder' : 'env'} size={18} style={{ color: 'var(--m-get)' }} />
        {target.kind === 'env' ? (
          <input
            className="input"
            style={{ height: 32, maxWidth: 280, fontWeight: 600 }}
            value={environment?.name ?? ''}
            onChange={(e) => environment && renameEnv(environment.id, e.target.value)}
          />
        ) : (
          <div style={{ fontSize: 15, fontWeight: 650 }}>{title}</div>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setImportOpen(true)} title={tr('Импорт из Postman, JSON, .env или CSV')}>
          <Icon name="download" size={14} /> {tr('Импорт')}
        </button>
        <button className="btn ghost" onClick={() => setExportOpen(true)} title={tr('Экспорт в Postman, JSON, .env или CSV')}>
          <Icon name="upload" size={14} /> {tr('Экспорт')}
        </button>
        <button className="btn" onClick={onClose}> {tr('Готово')} </button>
      </div>
      {target.kind === 'collection' && (
        <div className="env-editor-note">
          {tr('Действуют во всех запросах этой коллекции и важнее переменных окружения и глобальных с тем же именем. Выше них — только локальные переменные сценария (pm.variables).')}
        </div>
      )}
      <VarTable vars={vars} onChange={commit} />
      <VarImportDialog open={importOpen} onOpenChange={setImportOpen} target={target} />
      <VarExportDialog open={exportOpen} onOpenChange={setExportOpen} target={target} />
    </Modal>
  )
}

/** Imported / hand-added collection variables need stable ids like environment ones. */
function withIds(vars: VariableDef[]): VariableDef[] {
  return vars.map((v) => (v.id ? v : { ...v, id: makeId('var') }))
}

function VarTable({ vars, onChange }: { vars: VariableDef[]; onChange: (v: VariableDef[]) => void }) {
  // Reveal state is keyed by row id (not array index) so deleting/reordering a
  // row can't expose the wrong variable's secret value.
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const update = (i: number, patch: Partial<VariableDef>) => onChange(vars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  const remove = (i: number) => onChange(vars.filter((_, idx) => idx !== i))
  const add = () => onChange([...vars, { id: makeId('var'), key: '', value: '', enabled: true }])

  return (
    <div className="kv-table">
      <div className="kv-head" style={{ gridTemplateColumns: '26px 1fr 1.4fr 70px 28px' }}>
        <span />
        <span>{tr('Ключ')}</span>
        <span>{tr('Значение')}</span>
        <span>{tr('Секрет')}</span>
        <span />
      </div>
      {vars.map((v, i) => (
        <div key={v.id ?? i} className={`kv-row ${v.enabled ? '' : 'off'}`} style={{ gridTemplateColumns: '26px 1fr 1.4fr 70px 28px' }}>
          <div className={`ck ${v.enabled ? 'on' : ''}`} onClick={() => update(i, { enabled: !v.enabled })}>
            {v.enabled && <Icon name="check" size={11} strokeWidth={2.4} />}
          </div>
          <div className="kv-cell k">
            <input value={v.key} placeholder="key" onChange={(e) => update(i, { key: e.target.value })} />
          </div>
          <div className="kv-cell">
            <input
              value={v.value}
              type={v.secret && !reveal[v.id ?? i] ? 'password' : 'text'}
              placeholder="value"
              onChange={(e) => update(i, { value: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <div className={`ck ${v.secret ? 'on' : ''}`} onClick={() => update(i, { secret: !v.secret })} title={tr('Секретное значение')}>
              {v.secret && <Icon name="check" size={11} strokeWidth={2.4} />}
            </div>
            {v.secret && (
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setReveal((r) => ({ ...r, [v.id ?? i]: !r[v.id ?? i] }))}>
                <Icon name="eye" size={13} />
              </button>
            )}
          </div>
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => remove(i)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      <div className="kv-row" style={{ cursor: 'pointer', gridTemplateColumns: '26px 1fr 1.4fr 70px 28px' }} onClick={add}>
        <span />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tx-2)', fontSize: 12, height: 30, paddingLeft: 9 }}>
          <Icon name="plus" size={13} /> {tr('Добавить переменную')} </div>
      </div>
    </div>
  )
}

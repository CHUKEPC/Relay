import { useState } from 'react'
import type { VariableDef } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/primitives'
import { useEnvironments } from '@renderer/store/environments'

export type EnvEditorTarget = { kind: 'env'; id: string } | { kind: 'globals' } | null

export function EnvEditor({ target, onClose }: { target: EnvEditorTarget; onClose: () => void }) {
  const env = useEnvironments((s) => s.env)
  const globals = useEnvironments((s) => s.globals)
  const setEnvVars = useEnvironments((s) => s.setEnvVars)
  const setGlobalVars = useEnvironments((s) => s.setGlobalVars)
  const renameEnv = useEnvironments((s) => s.renameEnv)

  if (!target) return null

  const isGlobals = target.kind === 'globals'
  const environment = !isGlobals ? env.environments.find((e) => e.id === target.id) : undefined
  const vars: VariableDef[] = isGlobals ? globals.variables : environment?.variables ?? []
  const title = isGlobals ? 'Глобальные переменные' : environment?.name ?? 'Среда'

  const commit = (next: VariableDef[]) => {
    if (isGlobals) setGlobalVars(next)
    else if (environment) setEnvVars(environment.id, next)
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} width={680} title={undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Icon name="env" size={18} style={{ color: 'var(--m-get)' }} />
        {isGlobals ? (
          <div style={{ fontSize: 15, fontWeight: 650 }}>{title}</div>
        ) : (
          <input
            className="input"
            style={{ height: 32, maxWidth: 280, fontWeight: 600 }}
            value={environment?.name ?? ''}
            onChange={(e) => environment && renameEnv(environment.id, e.target.value)}
          />
        )}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>
          Готово
        </button>
      </div>
      <VarTable vars={vars} onChange={commit} />
    </Modal>
  )
}

function VarTable({ vars, onChange }: { vars: VariableDef[]; onChange: (v: VariableDef[]) => void }) {
  const [reveal, setReveal] = useState<Record<number, boolean>>({})
  const update = (i: number, patch: Partial<VariableDef>) => onChange(vars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  const remove = (i: number) => onChange(vars.filter((_, idx) => idx !== i))
  const add = () => onChange([...vars, { key: '', value: '', enabled: true }])

  return (
    <div className="kv-table">
      <div className="kv-head" style={{ gridTemplateColumns: '26px 1fr 1.4fr 70px 28px' }}>
        <span />
        <span>Ключ</span>
        <span>Значение</span>
        <span>Секрет</span>
        <span />
      </div>
      {vars.map((v, i) => (
        <div key={i} className={`kv-row ${v.enabled ? '' : 'off'}`} style={{ gridTemplateColumns: '26px 1fr 1.4fr 70px 28px' }}>
          <div className={`ck ${v.enabled ? 'on' : ''}`} onClick={() => update(i, { enabled: !v.enabled })}>
            {v.enabled && <Icon name="check" size={11} strokeWidth={2.4} />}
          </div>
          <div className="kv-cell k">
            <input value={v.key} placeholder="key" onChange={(e) => update(i, { key: e.target.value })} />
          </div>
          <div className="kv-cell">
            <input
              value={v.value}
              type={v.secret && !reveal[i] ? 'password' : 'text'}
              placeholder="value"
              onChange={(e) => update(i, { value: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <div className={`ck ${v.secret ? 'on' : ''}`} onClick={() => update(i, { secret: !v.secret })} title="Секретное значение">
              {v.secret && <Icon name="check" size={11} strokeWidth={2.4} />}
            </div>
            {v.secret && (
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setReveal((r) => ({ ...r, [i]: !r[i] }))}>
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
          <Icon name="plus" size={13} />
          Добавить переменную
        </div>
      </div>
    </div>
  )
}

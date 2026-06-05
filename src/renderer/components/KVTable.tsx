import { useState } from 'react'
import type { KV, VariableScope } from '@shared/types'
import { makeId } from '@shared/id'
import { serializeRows, parseBulk, mergeParsed } from '@renderer/lib/bulk-edit'
import { Icon } from './Icon'
import { HighlightedInput } from './HighlightedInput'

function Checkbox({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div className={`ck ${on ? 'on' : ''}`} onClick={onClick} role="checkbox" aria-checked={on}>
      {on && <Icon name="check" size={11} strokeWidth={2.4} />}
    </div>
  )
}

export interface KVTableProps {
  rows: KV[]
  onChange: (rows: KV[]) => void
  showDescription?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  scope?: VariableScope
  keyAutocomplete?: string[]
}

export function KVTable({
  rows,
  onChange,
  showDescription = false,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
  scope,
  keyAutocomplete
}: KVTableProps) {
  const listId = keyAutocomplete ? `kv-keys-${Math.abs(hash(keyAutocomplete.join(',')))}` : undefined

  // Bulk-edit mode is purely local UI state; table mode is the default.
  const [bulk, setBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  // Stable id so React keys by identity, not array index (keeps focus/state on
  // the right row when an earlier row is removed).
  const add = () => onChange([...rows, { id: makeId('kv'), key: '', value: '', enabled: true, description: '' }])

  const enterBulk = () => {
    setBulkText(serializeRows(rows))
    setBulk(true)
  }

  // Parse the current bulk text and push it back through onChange, preserving
  // ids/descriptions by key. Used both on blur and when leaving bulk mode.
  const commitBulk = () => {
    onChange(mergeParsed(parseBulk(bulkText), rows))
  }

  const leaveBulk = () => {
    commitBulk()
    setBulk(false)
  }

  return (
    <div className="kv-area">
      <div className="kv-toolbar">
        <button
          type="button"
          className="btn ghost kv-bulk-toggle"
          onClick={() => (bulk ? leaveBulk() : enterBulk())}
          title={bulk ? 'Вернуться к таблице' : 'Массовое редактирование'}
        >
          <Icon name={bulk ? 'grid' : 'code2'} size={14} />
          {bulk ? 'Таблица' : 'Bulk Edit'}
        </button>
      </div>

      {bulk ? (
        <textarea
          className="kv-bulk"
          value={bulkText}
          spellCheck={false}
          onChange={(e) => setBulkText(e.target.value)}
          onBlur={commitBulk}
          placeholder={'Authorization: Bearer {{token}}\n// disabled-header: value'}
        />
      ) : (
        <>
          {listId && (
            <datalist id={listId}>
              {keyAutocomplete!.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
          <div className="kv-table">
            <div className="kv-head">
              <span />
              <span>Ключ</span>
              <span>Значение</span>
              <span>{showDescription ? 'Описание' : ''}</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.id ?? i} className={`kv-row ${r.enabled ? '' : 'off'}`}>
                <Checkbox on={r.enabled} onClick={() => update(i, { enabled: !r.enabled })} />
                <div className="kv-cell k">
                  <input
                    value={r.key}
                    placeholder={keyPlaceholder}
                    list={listId}
                    spellCheck={false}
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                </div>
                <div className="kv-cell">
                  <HighlightedInput
                    value={r.value}
                    placeholder={valuePlaceholder}
                    scope={scope}
                    onChange={(v) => update(i, { value: v })}
                  />
                </div>
                <div className="kv-cell">
                  <input
                    value={r.description ?? ''}
                    placeholder={showDescription ? 'описание' : ''}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </div>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => remove(i)} title="Удалить">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
            <div className="kv-row" style={{ cursor: 'pointer' }} onClick={add}>
              <span />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tx-2)', fontSize: 12, height: 30, paddingLeft: 9 }}>
                <Icon name="plus" size={13} />
                Добавить
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { VariableDef } from '@shared/types'
import { mergeVariables, parseVariables, type VarImportFormat, type VarMergeMode } from '@shared/var-import'
import { Icon } from '@renderer/components/Icon'
import { Modal, Segmented } from '@renderer/components/primitives'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useUi } from '@renderer/store/ui'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-varpeek.css'

/** Where imported variables go. `env` with id 'new' creates an environment. */
export type VarTarget = { kind: 'globals' } | { kind: 'env'; id: string } | { kind: 'collection'; id: string }

const NEW_ENV = 'new'

const FORMAT_LABEL: Record<VarImportFormat, string> = {
  'postman-environment': 'Окружение Postman',
  'postman-globals': 'Глобальные переменные Postman',
  'postman-collection': 'Переменные коллекции Postman',
  json: 'JSON',
  dotenv: '.env',
  csv: 'CSV / TSV'
}

/** The parser speaks English (shared code); show its known messages in the UI language. */
function localize(msg: string): string {
  if (msg.startsWith('Unknown format')) return tr('Формат не распознан. Подойдут: окружение Postman, JSON, файл .env или CSV.')
  if (msg.includes('not valid JSON')) return tr('Текст похож на JSON, но содержит ошибку.')
  if (msg.startsWith('Nothing to import')) return tr('Вставьте содержимое или выберите файл')
  if (msg.startsWith('JSON must be')) return tr('JSON должен быть объектом или списком переменных.')
  return msg
}

/**
 * Import variables into globals, an environment or a collection from a
 * Postman export, JSON, .env or CSV. Opened with a target from the editors,
 * or without one from the sidebar / palette — then the format suggests it.
 */
export function VarImportDialog({ open, onOpenChange, target }: { open: boolean; onOpenChange: (o: boolean) => void; target?: VarTarget }) {
  const environments = useEnvironments((s) => s.env.environments)
  const globals = useEnvironments((s) => s.globals.variables)
  const collections = useCollections((s) => s.doc.collections)
  const [text, setText] = useState('')
  const [dest, setDest] = useState<VarTarget>(target ?? { kind: 'globals' })
  const [mode, setMode] = useState<VarMergeMode>('merge')
  const [picked, setPicked] = useState(!!target)
  const fileRef = useRef<HTMLInputElement>(null)

  // Callers may pass a fresh object every render; reset only when it really changes.
  const targetKey = target ? JSON.stringify(target) : ''
  useEffect(() => {
    if (!open) return
    setText('')
    setMode('merge')
    setDest(target ?? { kind: 'globals' })
    setPicked(!!target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey])

  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return { ok: true as const, ...parseVariables(text) }
    } catch (err) {
      return { ok: false as const, error: localize((err as Error).message) }
    }
  }, [text])

  // Without an explicit destination, the file says where it belongs.
  useEffect(() => {
    if (picked || !parsed?.ok) return
    if (parsed.format === 'postman-globals') setDest({ kind: 'globals' })
    else if (parsed.format === 'postman-environment') setDest({ kind: 'env', id: NEW_ENV })
    else if (parsed.format === 'postman-collection' && collections[0]) setDest({ kind: 'collection', id: collections[0].id })
  }, [parsed, picked, collections])

  const current: VariableDef[] =
    dest.kind === 'globals'
      ? globals
      : dest.kind === 'env'
        ? environments.find((e) => e.id === dest.id)?.variables ?? []
        : collections.find((c) => c.id === dest.id)?.variables ?? []
  const preview = parsed?.ok ? mergeVariables(current, parsed.variables, mode) : null
  const existingKeys = new Set(current.map((v) => v.key))

  const choose = (next: VarTarget) => {
    setDest(next)
    setPicked(true)
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const doImport = () => {
    if (!parsed?.ok || !preview) return
    const envStore = useEnvironments.getState()
    if (dest.kind === 'globals') envStore.setGlobalVars(preview.variables)
    else if (dest.kind === 'env') {
      const id = dest.id === NEW_ENV ? envStore.createEnv(parsed.name?.trim() || tr('Импортированное окружение')) : dest.id
      envStore.setEnvVars(id, preview.variables)
    } else useCollections.getState().updateFolderMeta(dest.id, { variables: preview.variables })
    useUi
      .getState()
      .showToast(trf('Переменные импортированы: добавлено {added}, обновлено {updated}', { added: preview.added, updated: preview.updated }))
    onOpenChange(false)
  }

  const envValue = dest.kind === 'env' ? dest.id : environments[0]?.id ?? NEW_ENV
  const collectionValue = dest.kind === 'collection' ? dest.id : collections[0]?.id ?? ''

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tr('Импорт переменных')} width={660}>
      <div className="field">
        <label>{tr('Куда')}</label>
        <div className="var-import-dest">
          <Segmented
            value={dest.kind}
            onChange={(k) =>
              choose(k === 'globals' ? { kind: 'globals' } : k === 'env' ? { kind: 'env', id: envValue } : { kind: 'collection', id: collectionValue })
            }
            options={[
              { value: 'globals', label: tr('Глобальные') },
              { value: 'env', label: tr('Окружение') },
              { value: 'collection', label: tr('Коллекция (локальные)') }
            ]}
          />
          {dest.kind === 'env' && (
            <select className="input" value={dest.id} onChange={(e) => choose({ kind: 'env', id: e.target.value })}>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {tr(e.name)}
                </option>
              ))}
              <option value={NEW_ENV}>{tr('+ Новое окружение')}</option>
            </select>
          )}
          {dest.kind === 'collection' &&
            (collections.length ? (
              <select className="input" value={dest.id} onChange={(e) => choose({ kind: 'collection', id: e.target.value })}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="var-import-note">{tr('Сначала создайте коллекцию')}</span>
            ))}
        </div>
      </div>

      <div className="field">
        <label>{tr('Файл или текст')}</label>
        <textarea
          className="input var-import-text"
          placeholder={tr('Вставьте экспорт окружения Postman, JSON, содержимое .env или CSV (key,value)…')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,.env,.csv,.tsv,.txt,application/json,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> {tr('Выбрать файл')}
        </button>
      </div>

      {parsed && !parsed.ok && <div className="var-import-error">{parsed.error}</div>}
      {parsed?.ok && preview && (
        <>
          <div className="var-import-summary">
            {trf('Распознано: {format} · переменных: {n}', { format: tr(FORMAT_LABEL[parsed.format]), n: parsed.variables.length })}
            {parsed.warnings.length > 0 && <span title={parsed.warnings.join('\n')}> · {trf('пропущено: {n}', { n: parsed.warnings.length })}</span>}
          </div>
          <div className="var-import-table">
            {parsed.variables.slice(0, 8).map((v) => (
              <div key={v.id} className={`var-import-row${v.enabled ? '' : ' off'}`}>
                <span className="mono k">{v.key}</span>
                <span className="mono v">{v.secret ? '••••••' : v.value || '—'}</span>
                <span className={`tag ${mode === 'replace' || !existingKeys.has(v.key) ? 'new' : 'upd'}`}>
                  {mode === 'replace' || !existingKeys.has(v.key) ? tr('новая') : tr('обновится')}
                </span>
              </div>
            ))}
            {parsed.variables.length > 8 && <div className="var-import-more">{trf('…и ещё {n}', { n: parsed.variables.length - 8 })}</div>}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>{tr('Совпадающие имена')}</label>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'merge', label: tr('Объединить') },
                { value: 'replace', label: tr('Заменить все') }
              ]}
            />
            <div className="var-import-note">
              {mode === 'merge'
                ? trf('Существующие переменные сохранятся, совпадающие обновятся. Добавится: {added}, обновится: {updated}.', {
                    added: preview.added,
                    updated: preview.updated
                  })
                : trf('Текущие переменные ({n}) будут заменены импортированными.', { n: current.length })}
            </div>
          </div>
        </>
      )}

      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}>
          {tr('Отмена')}
        </button>
        <button
          className="btn primary"
          disabled={!parsed?.ok || !parsed.variables.length || (dest.kind === 'collection' && !collections.length)}
          onClick={doImport}
        >
          {tr('Импортировать')}
        </button>
      </div>
    </Modal>
  )
}

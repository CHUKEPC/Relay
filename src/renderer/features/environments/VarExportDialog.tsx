import { useEffect, useMemo, useState } from 'react'
import type { VariableDef } from '@shared/types'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import { exportVariables, VAR_EXPORT_FORMATS, type VarExportFormat } from '@shared/var-export'
import { Icon } from '@renderer/components/Icon'
import { Modal, Segmented } from '@renderer/components/primitives'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useUi } from '@renderer/store/ui'
import { tr, trf } from '@renderer/lib/i18n'
import type { VarTarget } from './VarImportDialog'
import '@renderer/styles/feat-varpeek.css'

const FORMAT_HINT: Record<VarExportFormat, string> = {
  postman: 'Экспорт окружения Postman: откроется в Postman и в Relay, сохраняет флаги «включена» и «секрет».',
  json: 'Плоский объект { "ключ": "значение" } из включённых переменных.',
  dotenv: 'Файл .env: строки КЛЮЧ=значение из включённых переменных.',
  csv: 'Таблица key,value,enabled,secret — открывается в Excel и импортируется обратно.'
}

/**
 * Save globals, an environment or a collection's variables as a Postman
 * export, JSON, .env or CSV — every format reads back through «Импорт
 * переменных». Secret values are blanked unless the user ticks the box.
 */
export function VarExportDialog({ open, onOpenChange, target }: { open: boolean; onOpenChange: (o: boolean) => void; target?: VarTarget }) {
  const environments = useEnvironments((s) => s.env.environments)
  const activeEnvId = useEnvironments((s) => s.env.activeEnvironmentId)
  const globals = useEnvironments((s) => s.globals.variables)
  const collections = useCollections((s) => s.doc.collections)
  const [source, setSource] = useState<VarTarget>(target ?? { kind: 'globals' })
  const [format, setFormat] = useState<VarExportFormat>('postman')
  const [includeSecrets, setIncludeSecrets] = useState(false)

  // Callers may pass a fresh object every render; reset only when it really changes.
  const targetKey = target ? JSON.stringify(target) : ''
  useEffect(() => {
    if (!open) return
    setSource(target ?? (activeEnvId ? { kind: 'env', id: activeEnvId } : { kind: 'globals' }))
    setIncludeSecrets(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetKey])

  const { vars, name } = useMemo((): { vars: VariableDef[]; name: string } => {
    if (source.kind === 'globals') return { vars: globals, name: 'Globals' }
    if (source.kind === 'env') {
      const e = environments.find((x) => x.id === source.id)
      return { vars: e?.variables ?? [], name: e ? tr(e.name) : '' }
    }
    const c = collections.find((x) => x.id === source.id)
    return { vars: c?.variables ?? [], name: c?.name ?? '' }
  }, [source, globals, environments, collections])

  const result = useMemo(
    () =>
      exportVariables(vars, format, {
        name: name || 'variables',
        scope: source.kind === 'globals' ? 'globals' : 'environment',
        includeSecrets,
        exportedUsing: `${APP_NAME}/${APP_VERSION}`
      }),
    [vars, format, name, source.kind, includeSecrets]
  )
  const secretCount = vars.filter((v) => v.secret && v.value).length
  const empty = !vars.some((v) => v.key.trim())
  const previewLines = result.content.split('\n')
  const preview = previewLines.slice(0, 14).join('\n') + (previewLines.length > 15 ? '\n…' : '')

  const save = async (): Promise<void> => {
    const ext = VAR_EXPORT_FORMATS.find((f) => f.id === format)?.extension ?? 'txt'
    try {
      const saved = await window.api.saveFile({ defaultName: result.fileName, content: result.content, filters: [{ name: format === 'dotenv' ? '.env' : format.toUpperCase(), extensions: [ext] }] })
      if (!saved) return
      useUi.getState().showToast(trf('Переменные сохранены: {file}', { file: saved.split(/[\\/]/).pop() ?? result.fileName }))
      onOpenChange(false)
    } catch (err) {
      useUi.getState().showToast(trf('Не удалось экспортировать: {message}', { message: err instanceof Error ? err.message : String(err) }), 'error')
    }
  }

  const copy = (): void => {
    void navigator.clipboard
      .writeText(result.content)
      .then(() => useUi.getState().showToast(tr('Скопировано в буфер обмена')))
      .catch(() => useUi.getState().showToast(tr('Не удалось скопировать'), 'error'))
  }

  const envValue = source.kind === 'env' ? source.id : activeEnvId ?? environments[0]?.id ?? ''
  const collectionValue = source.kind === 'collection' ? source.id : collections[0]?.id ?? ''

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tr('Экспорт переменных')} width={660}>
      <div className="field">
        <label>{tr('Откуда')}</label>
        <div className="var-import-dest">
          <Segmented
            value={source.kind}
            onChange={(k) =>
              setSource(k === 'globals' ? { kind: 'globals' } : k === 'env' ? { kind: 'env', id: envValue } : { kind: 'collection', id: collectionValue })
            }
            options={[
              { value: 'globals', label: tr('Глобальные') },
              { value: 'env', label: tr('Окружение') },
              { value: 'collection', label: tr('Коллекция (локальные)') }
            ]}
          />
          {source.kind === 'env' &&
            (environments.length ? (
              <select className="input" value={source.id} onChange={(e) => setSource({ kind: 'env', id: e.target.value })}>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {tr(e.name)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="var-import-note">{tr('Окружений пока нет')}</span>
            ))}
          {source.kind === 'collection' &&
            (collections.length ? (
              <select className="input" value={source.id} onChange={(e) => setSource({ kind: 'collection', id: e.target.value })}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="var-import-note">{tr('Коллекций пока нет')}</span>
            ))}
        </div>
      </div>

      <div className="field">
        <label>{tr('Формат')}</label>
        <Segmented value={format} onChange={setFormat} options={VAR_EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label }))} />
        <div className="var-import-note">{tr(FORMAT_HINT[format])}</div>
      </div>

      {secretCount > 0 && (
        <label className="var-export-secrets">
          <input type="checkbox" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
          <span>
            {trf('Включить значения секретных переменных ({n})', { n: secretCount })}
            <span className="var-import-note"> — {tr('без галочки они сохранятся пустыми, чтобы токены не ушли вместе с файлом')}</span>
          </span>
        </label>
      )}

      {empty ? (
        <div className="var-import-note" style={{ margin: '10px 0' }}>{tr('Здесь нет переменных для экспорта.')}</div>
      ) : (
        <pre className="var-export-preview">{preview}</pre>
      )}

      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}>
          {tr('Отмена')}
        </button>
        <button className="btn" disabled={empty} onClick={copy}>
          <Icon name="copy" size={14} /> {tr('Копировать')}
        </button>
        <button className="btn primary" disabled={empty} onClick={() => void save()}>
          <Icon name="upload" size={14} /> {tr('Сохранить файл…')}
        </button>
      </div>
    </Modal>
  )
}

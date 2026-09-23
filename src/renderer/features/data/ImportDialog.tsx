import { useRef, useState } from 'react'
import type { ImportKind } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Modal, Segmented } from '@renderer/components/primitives'
import { useUi } from '@renderer/store/ui'
import { applyImportResults, cleanImportError, countRequests } from '@renderer/lib/import-apply'

import { tr, trf } from '@renderer/lib/i18n'
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<ImportKind>('auto')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = useUi((s) => s.showToast)

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.onerror = () => setError(tr('Не удалось прочитать файл'))
    reader.readAsText(file)
  }

  const doImport = async () => {
    setError(null)
    if (!text.trim()) {
      setError(tr('Вставьте содержимое или выберите файл'))
      return
    }
    try {
      const results = await window.api.importData(kind, text)
      if (!results.length) {
        setError(
          tr(
            'Не удалось распознать формат. Поддерживаются: коллекция Postman v2.1, OpenAPI 3.x / Swagger 2.0 (JSON или YAML), HAR, экспорт Insomnia v4 и команда cURL. Убедитесь, что вы вставили именно файл коллекции, а не произвольный JSON.'
          )
        )
        return
      }
      // A recognized-but-empty collection is almost always a wrong-file paste —
      // tell the user instead of silently adding an empty node.
      // A recognized-but-empty collection is almost always a wrong-file paste —
      // tell the user instead of silently adding an empty node.
      const totalReqs = results.reduce((n, r) => n + (r.collection ? countRequests(r.collection) : 0), 0)
      if (results.every((r) => r.kind === 'collection') && totalReqs === 0) {
        setError(tr('Файл распознан как коллекция, но в нём нет запросов. Проверьте, что выбрали правильный файл.'))
        return
      }
      const applied = applyImportResults(results)
      showToast(
        trf('Импортировано ({what})', { what: applied.summary || tr('данные') }) +
          (applied.warnings.length ? ` · ${trf('предупреждений: {n}', { n: applied.warnings.length })}` : '')
      )
      setText('')
      onOpenChange(false)
    } catch (err) {
      setError(cleanImportError(err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tr('Импорт')} width={620}>
      <div className="field">
        <label>{tr('Формат')}</label>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'auto', label: tr('Авто') },
            { value: 'postman', label: 'Postman v2.1' },
            { value: 'openapi', label: 'OpenAPI 3' },
            { value: 'swagger', label: 'Swagger 2.0' },
            { value: 'curl', label: 'cURL' },
            { value: 'har', label: 'HAR' },
            { value: 'insomnia', label: 'Insomnia' }
          ]}
        />
      </div>
      <div className="field">
        <label>{tr('Содержимое')}</label>
        <textarea
          className="input"
          style={{ height: 200, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 10, resize: 'vertical' }}
          placeholder={tr('Вставьте Postman/OpenAPI JSON или команду curl…')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,.yaml,.yml,.curl,.har,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = '' // allow re-selecting the same file
          }}
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> {tr('Выбрать файл')} </button>
      </div>
      {error && <div style={{ color: 'var(--s-5xx)', fontSize: 12.5, marginTop: 4 }}>{error}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}> {tr('Отмена')} </button>
        <button className="btn primary" onClick={doImport}> {tr('Импортировать')} </button>
      </div>
    </Modal>
  )
}

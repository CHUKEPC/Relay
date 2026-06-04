import { useRef, useState } from 'react'
import type { ImportKind } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Modal, Segmented } from '@renderer/components/primitives'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<ImportKind>('auto')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const addCollectionNode = useCollections((s) => s.addCollectionNode)
  const addEnvironment = useEnvironments((s) => s.addEnvironment)
  const openNew = useTabs((s) => s.openNew)
  const showToast = useUi((s) => s.showToast)

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const doImport = async () => {
    setError(null)
    if (!text.trim()) {
      setError('Вставьте содержимое или выберите файл')
      return
    }
    try {
      const results = await window.api.importData(kind, text)
      if (!results.length) {
        setError('Не удалось распознать формат')
        return
      }
      const warnings: string[] = []
      for (const r of results) {
        warnings.push(...r.warnings)
        if (r.kind === 'collection' && r.collection) addCollectionNode(r.collection)
        else if (r.kind === 'environment' && r.environment) addEnvironment(r.environment)
        else if (r.kind === 'request' && r.request) openNew(r.request)
      }
      showToast(`Импортировано${warnings.length ? ` · предупреждений: ${warnings.length}` : ''}`)
      setText('')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Импорт" width={620}>
      <div className="field">
        <label>Формат</label>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'auto', label: 'Авто' },
            { value: 'postman', label: 'Postman v2.1' },
            { value: 'openapi', label: 'OpenAPI 3' },
            { value: 'curl', label: 'cURL' }
          ]}
        />
      </div>
      <div className="field">
        <label>Содержимое</label>
        <textarea
          className="input"
          style={{ height: 200, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 10, resize: 'vertical' }}
          placeholder={'Вставьте Postman/OpenAPI JSON или команду curl…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,.yaml,.yml,.curl,application/json"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          Выбрать файл
        </button>
      </div>
      {error && <div style={{ color: 'var(--s-5xx)', fontSize: 12.5, marginTop: 4 }}>{error}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}>
          Отмена
        </button>
        <button className="btn primary" onClick={doImport}>
          Импортировать
        </button>
      </div>
    </Modal>
  )
}

import { useRef, useState } from 'react'
import type { CollectionNode, ImportKind } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Modal, Segmented } from '@renderer/components/primitives'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'

/** Strip Electron's IPC wrapper ("Error invoking remote method 'x': Error: …")
 *  so the user sees the clean, actionable message. */
function cleanError(msg: string): string {
  return msg
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

/** Count request leaves in a collection/folder subtree. */
function countRequests(node: CollectionNode): number {
  if (node.type === 'request') return 1
  return node.children.reduce((n, c) => n + countRequests(c), 0)
}

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
    reader.onerror = () => setError('Не удалось прочитать файл')
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
        setError(
          'Не удалось распознать формат. Поддерживаются: коллекция Postman v2.1, OpenAPI 3.x / Swagger 2.0 ' +
            '(JSON или YAML), HAR, экспорт Insomnia v4 и команда cURL. ' +
            'Убедитесь, что вы вставили именно файл коллекции, а не произвольный JSON.'
        )
        return
      }
      // A recognized-but-empty collection is almost always a wrong-file paste —
      // tell the user instead of silently adding an empty node.
      const totalReqs = results.reduce((n, r) => n + (r.collection ? countRequests(r.collection) : 0), 0)
      if (results.every((r) => r.kind === 'collection') && totalReqs === 0) {
        setError('Файл распознан как коллекция, но в нём нет запросов. Проверьте, что выбрали правильный файл.')
        return
      }
      const warnings: string[] = []
      let collections = 0
      let requests = 0
      let environments = 0
      for (const r of results) {
        warnings.push(...r.warnings)
        if (r.kind === 'collection' && r.collection) {
          addCollectionNode(r.collection)
          collections++
        } else if (r.kind === 'environment' && r.environment) {
          addEnvironment(r.environment)
          environments++
        } else if (r.kind === 'request' && r.request) {
          openNew(r.request)
          requests++
        }
      }
      const parts = [
        collections && `коллекций: ${collections}${totalReqs ? ` (запросов: ${totalReqs})` : ''}`,
        requests && `запросов: ${requests}`,
        environments && `сред: ${environments}`
      ].filter(Boolean)
      showToast(`Импортировано (${parts.join(', ') || 'данные'})${warnings.length ? ` · предупреждений: ${warnings.length}` : ''}`)
      setText('')
      onOpenChange(false)
    } catch (err) {
      setError(cleanError(err instanceof Error ? err.message : String(err)))
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
            { value: 'swagger', label: 'Swagger 2.0' },
            { value: 'curl', label: 'cURL' },
            { value: 'har', label: 'HAR' },
            { value: 'insomnia', label: 'Insomnia' }
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
          accept=".json,.txt,.yaml,.yml,.curl,.har,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = '' // allow re-selecting the same file
          }}
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

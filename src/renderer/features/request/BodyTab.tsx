import type { FormDataField, RawLanguage, RequestBody, RequestModel } from '@shared/types'
import { RAW_LANGUAGE_CONTENT_TYPE } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { KVTable } from '@renderer/components/KVTable'
import { useTabs } from '@renderer/store/tabs'
import { useScope } from '@renderer/lib/hooks'
import { beautify } from '@renderer/lib/beautify'

const BODY_TYPES: { id: RequestBody['type']; label: string }[] = [
  { id: 'none', label: 'none' },
  { id: 'raw', label: 'raw' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'binary', label: 'binary' }
]

const RAW_LANGS: RawLanguage[] = ['json', 'text', 'xml', 'html', 'javascript']

function monacoLang(l: RawLanguage): string {
  return l === 'text' ? 'plaintext' : l === 'javascript' ? 'javascript' : l
}

export function BodyTab({ req }: { req: RequestModel }) {
  const patch = useTabs((s) => s.patchActive)
  const scope = useScope()
  const body = req.body

  const setBody = (b: RequestBody) => patch({ body: b })

  const upsertContentType = (value: string | null) => {
    const headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
    if (value) headers.push({ key: 'Content-Type', value, enabled: true })
    patch({ headers })
  }

  const changeType = (type: RequestBody['type']) => {
    switch (type) {
      case 'none':
        setBody({ type: 'none' })
        break
      case 'raw':
        setBody({ type: 'raw', language: 'json', text: body.type === 'raw' ? body.text : '' })
        if (!req.headers.some((h) => h.key.toLowerCase() === 'content-type')) upsertContentType('application/json')
        break
      case 'urlencoded':
        setBody({ type: 'urlencoded', items: body.type === 'urlencoded' ? body.items : [{ key: '', value: '', enabled: true }] })
        break
      case 'formdata':
        setBody({ type: 'formdata', items: body.type === 'formdata' ? body.items : [] })
        break
      case 'graphql':
        setBody({ type: 'graphql', query: body.type === 'graphql' ? body.query : '', variables: body.type === 'graphql' ? body.variables : '{}' })
        break
      case 'binary':
        setBody({ type: 'binary' })
        break
    }
  }

  const setLanguage = (language: RawLanguage) => {
    if (body.type !== 'raw') return
    setBody({ ...body, language })
    const ct = RAW_LANGUAGE_CONTENT_TYPE[language]
    const existing = req.headers.find((h) => h.key.toLowerCase() === 'content-type')
    // only auto-update if the header is empty or a known content-type we set
    if (!existing || Object.values(RAW_LANGUAGE_CONTENT_TYPE).includes(existing.value)) upsertContentType(ct)
  }

  const doBeautify = () => {
    if (body.type !== 'raw') return
    setBody({ ...body, text: beautify(body.text, body.language) })
  }

  return (
    <div>
      <div className="subbar">
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {BODY_TYPES.map((t) => (
            <button key={t.id} className={body.type === t.id ? 'on' : ''} onClick={() => changeType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {body.type === 'raw' && (
          <>
            <div className="seg" style={{ marginLeft: 8 }}>
              {RAW_LANGS.map((l) => (
                <button key={l} className={body.language === l ? 'on' : ''} onClick={() => setLanguage(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            {(body.language === 'json' || body.language === 'xml') && (
              <button className="btn ghost" style={{ marginLeft: 'auto', height: 26 }} onClick={doBeautify}>
                <Icon name="code2" size={14} />
                Beautify
              </button>
            )}
          </>
        )}
      </div>

      {body.type === 'none' && (
        <div style={{ padding: '30px 14px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12.5 }}>
          Тело запроса отсутствует
        </div>
      )}

      {body.type === 'raw' && (
        <div className="code-editor" style={{ height: 300 }}>
          <CodeEditor value={body.text} language={monacoLang(body.language)} onChange={(text) => setBody({ ...body, text })} />
        </div>
      )}

      {body.type === 'urlencoded' && (
        <KVTable rows={body.items} onChange={(items) => setBody({ type: 'urlencoded', items })} scope={scope} keyPlaceholder="key" />
      )}

      {body.type === 'formdata' && <FormDataTable items={body.items} onChange={(items) => setBody({ type: 'formdata', items })} scope={scope} />}

      {body.type === 'binary' && <BinaryPicker body={body} onChange={setBody} />}

      {body.type === 'graphql' && (
        <div>
          <div className="section-title">Query</div>
          <div className="code-editor" style={{ height: 200, marginTop: 0 }}>
            <CodeEditor value={body.query} language="graphql" onChange={(query) => setBody({ ...body, query })} />
          </div>
          <div className="section-title">Variables</div>
          <div className="code-editor" style={{ height: 140, marginTop: 0 }}>
            <CodeEditor value={body.variables} language="json" onChange={(variables) => setBody({ ...body, variables })} />
          </div>
        </div>
      )}
    </div>
  )
}

function FormDataTable({
  items,
  onChange,
  scope
}: {
  items: FormDataField[]
  onChange: (items: FormDataField[]) => void
  scope: ReturnType<typeof useScope>
}) {
  const update = (i: number, patch: Partial<FormDataField>) => onChange(items.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  const add = () => onChange([...items, { key: '', type: 'text', value: '', enabled: true }])

  const pickFile = async (i: number) => {
    const files = await window.api.openFile({ multiple: false })
    if (files && files[0]) update(i, { filePath: files[0].filePath, fileName: files[0].fileName })
  }

  return (
    <div className="kv-area">
      <div className="kv-table">
        <div className="kv-head" style={{ gridTemplateColumns: '26px 1fr 90px 1.3fr 28px' }}>
          <span />
          <span>Ключ</span>
          <span>Тип</span>
          <span>Значение</span>
          <span />
        </div>
        {items.map((r, i) => (
          <div key={i} className={`kv-row ${r.enabled ? '' : 'off'}`} style={{ gridTemplateColumns: '26px 1fr 90px 1.3fr 28px' }}>
            <div className={`ck ${r.enabled ? 'on' : ''}`} onClick={() => update(i, { enabled: !r.enabled })}>
              {r.enabled && <Icon name="check" size={11} strokeWidth={2.4} />}
            </div>
            <div className="kv-cell k">
              <input value={r.key} placeholder="key" onChange={(e) => update(i, { key: e.target.value })} />
            </div>
            <div className="kv-cell" style={{ padding: 0 }}>
              <select
                value={r.type}
                onChange={(e) => update(i, { type: e.target.value as 'text' | 'file' })}
                style={{ background: 'transparent', color: 'var(--tx-1)', border: 0, width: '100%', fontSize: 12 }}
              >
                <option value="text">text</option>
                <option value="file">file</option>
              </select>
            </div>
            <div className="kv-cell">
              {r.type === 'file' ? (
                <button className="btn ghost" style={{ height: 24, fontSize: 11.5 }} onClick={() => pickFile(i)}>
                  <Icon name="upload" size={13} />
                  {r.fileName ?? 'Выбрать файл'}
                </button>
              ) : (
                <input value={r.value} placeholder="value" onChange={(e) => update(i, { value: e.target.value })} />
              )}
            </div>
            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => remove(i)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
        <div className="kv-row" style={{ cursor: 'pointer' }} onClick={add}>
          <span />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tx-2)', fontSize: 12, height: 30, paddingLeft: 9 }}>
            <Icon name="plus" size={13} />
            Добавить поле
          </div>
        </div>
      </div>
    </div>
  )
}

function BinaryPicker({ body, onChange }: { body: Extract<RequestBody, { type: 'binary' }>; onChange: (b: RequestBody) => void }) {
  const pick = async () => {
    const files = await window.api.openFile({ multiple: false })
    if (files && files[0]) onChange({ type: 'binary', filePath: files[0].filePath, fileName: files[0].fileName })
  }
  return (
    <div style={{ padding: '20px 14px' }}>
      <button className="btn" onClick={pick}>
        <Icon name="upload" size={14} />
        {body.fileName ?? 'Выбрать файл'}
      </button>
      {body.filePath && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--tx-2)' }} className="mono">{body.filePath}</div>}
    </div>
  )
}

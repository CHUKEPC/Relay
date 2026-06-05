import { useMemo, useState } from 'react'
import type { KV, RequestMode } from '@shared/types'
import { COMMON_HEADER_NAMES } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { KVTable } from '@renderer/components/KVTable'
import { useTabs } from '@renderer/store/tabs'
import { useScope, useActiveRequest, useActiveTab } from '@renderer/lib/hooks'
import { detectPathVars } from '@renderer/lib/url'
import { UrlBar } from './UrlBar'
import { BodyTab } from './BodyTab'
import { AuthTab } from './AuthTab'
import { ScriptsTab } from './ScriptsTab'
import { ExamplesTab } from './ExamplesTab'
import { CodeGenModal } from '@renderer/features/data/CodeGenModal'

type Tab = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'examples'

export function RequestBuilder() {
  const req = useActiveRequest()
  const activeTab = useActiveTab()
  const patch = useTabs((s) => s.patchActive)
  const scope = useScope()
  const [tab, setTab] = useState<Tab>('params')
  const [codeGenOpen, setCodeGenOpen] = useState(false)

  const pathVars = useMemo(() => (req ? detectPathVars(req.url) : []), [req?.url])

  if (!req) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="empty-card">
          <div className="empty-ico">
            <Icon name="send" size={22} />
          </div>
          <h3>Нет открытого запроса</h3>
          <p>Создайте новый запрос или откройте его из коллекции слева.</p>
        </div>
      </div>
    )
  }

  const mode: RequestMode = req.mode ?? 'http'
  const exampleCount = req.examples?.length ?? 0
  const counts: Partial<Record<Tab, number>> = {
    params: req.query.filter((p) => p.enabled && p.key).length,
    headers: req.headers.filter((h) => h.enabled && h.key).length,
    examples: exampleCount
  }
  const bodyDot = req.body.type !== 'none'

  // WebSocket/SSE only use the URL, query, and handshake headers.
  const tabs: { id: Tab; label: string }[] =
    mode === 'http'
      ? [
          { id: 'params', label: 'Params' },
          { id: 'auth', label: 'Authorization' },
          { id: 'headers', label: 'Headers' },
          { id: 'body', label: 'Body' },
          { id: 'scripts', label: 'Scripts' },
          { id: 'examples', label: 'Examples' }
        ]
      : [
          { id: 'params', label: 'Params' },
          { id: 'headers', label: 'Headers' }
        ]

  // If the active sub-tab isn't valid for the current mode, fall back to Params.
  const activeSubTab: Tab = tabs.some((t) => t.id === tab) ? tab : 'params'

  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <UrlBar req={req} />
      <div className="req-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${activeSubTab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {counts[t.id] != null && counts[t.id]! > 0 && <span className="count">{counts[t.id]}</span>}
            {t.id === 'body' && bodyDot && <span className="dirty" style={{ width: 5, height: 5 }} />}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }} />
        {mode === 'http' && (
          <button className="btn ghost" style={{ height: 28 }} onClick={() => setCodeGenOpen(true)} title="Сгенерировать код">
            <Icon name="code2" size={14} />
            Code
          </button>
        )}
      </div>
      <CodeGenModal open={codeGenOpen} onOpenChange={setCodeGenOpen} />
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {activeSubTab === 'params' && (
          <>
            <KVTable rows={req.query} onChange={(query) => patch({ query })} showDescription scope={scope} keyPlaceholder="param" />
            {pathVars.length > 0 && (
              <>
                <div className="section-title">Path Variables</div>
                <PathVarsTable detected={pathVars} pathVariables={req.pathVariables} onChange={(pathVariables) => patch({ pathVariables })} scope={scope} />
              </>
            )}
          </>
        )}
        {activeSubTab === 'headers' && (
          <>
            <KVTable rows={req.headers} onChange={(headers) => patch({ headers })} scope={scope} keyPlaceholder="Header-Name" keyAutocomplete={COMMON_HEADER_NAMES} />
            <div style={{ padding: '4px 18px 14px', fontSize: 11, color: 'var(--tx-3)' }}>
              {mode === 'http'
                ? 'Host, Content-Length, User-Agent и др. добавляются автоматически при отправке.'
                : 'Заголовки рукопожатия отправляются при подключении.'}
            </div>
          </>
        )}
        {activeSubTab === 'auth' && <AuthTab req={req} />}
        {activeSubTab === 'body' && <BodyTab req={req} />}
        {activeSubTab === 'scripts' && <ScriptsTab req={req} />}
        {activeSubTab === 'examples' && <ExamplesTab req={req} tabId={activeTab?.id ?? null} />}
      </div>
    </div>
  )
}

function PathVarsTable({
  detected,
  pathVariables,
  onChange,
  scope
}: {
  detected: string[]
  pathVariables: KV[]
  onChange: (v: KV[]) => void
  scope: ReturnType<typeof useScope>
}) {
  const valueOf = (key: string) => pathVariables.find((p) => p.key === key)?.value ?? ''
  const set = (key: string, value: string) => {
    const exists = pathVariables.some((p) => p.key === key)
    // Keep path-variable values even when the name isn't currently in the URL —
    // the table only displays `detected`, but pruning here loses stored values
    // during transient URL edits.
    const next = exists
      ? pathVariables.map((p) => (p.key === key ? { ...p, value } : p))
      : [...pathVariables, { key, value, enabled: true }]
    onChange(next)
  }
  return (
    <div className="kv-area">
      <div className="kv-table">
        {detected.map((key) => (
          <div key={key} className="kv-row">
            <span />
            <div className="kv-cell k">
              <input value={`:${key}`} readOnly />
            </div>
            <div className="kv-cell">
              <input value={valueOf(key)} placeholder="значение" onChange={(e) => set(key, e.target.value)} />
            </div>
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

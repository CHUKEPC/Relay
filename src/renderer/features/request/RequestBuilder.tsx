import { lazy, Suspense, useMemo, useState } from 'react'
import type { KV, RequestMode, RequestModel } from '@shared/types'
import { COMMON_HEADER_NAMES } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { KVTable } from '@renderer/components/KVTable'
import { useTabs } from '@renderer/store/tabs'
import { useRequestUi, type RequestSubTab } from '@renderer/store/request-ui'
import { useScope, useTab } from '@renderer/lib/hooks'
import { detectPathVars } from '@renderer/lib/url'
import { saveActiveRequest, openSaveAsDialog } from '@renderer/lib/save'
import { UrlBar } from './UrlBar'
import { BodyTab } from './BodyTab'
import { AuthTab } from './AuthTab'
import { ScriptsTab } from './ScriptsTab'
import { ExamplesTab } from './ExamplesTab'
import { RequestMeta } from './RequestMeta'
import { CodeGenModal } from '@renderer/features/data/CodeGenModal'

import { tr } from '@renderer/lib/i18n'

// gRPC comes from a feature pack; its builder loads only for a gRPC tab.
const GrpcBuilder = lazy(() => import('@renderer/features/grpc/GrpcBuilder').then((m) => ({ default: m.GrpcBuilder })))
type Tab = RequestSubTab

/** Builds the request of `tabId` when given, else the active tab (split-screen). */
export function RequestBuilder({ tabId }: { tabId?: string }) {
  const tab = useTab(tabId)
  const scope = useScope(tabId)
  const subTab = useRequestUi((s) => (tab ? s.subTab[tab.id] : undefined) ?? 'params')
  const setSubTab = (t: Tab) => tab && useRequestUi.getState().setSubTab(tab.id, t)
  const [codeGenOpen, setCodeGenOpen] = useState(false)

  const req = tab?.request ?? null
  const reqUrl = req?.url ?? null
  const pathVars = useMemo(() => (reqUrl !== null ? detectPathVars(reqUrl) : []), [reqUrl])

  if (!tab || !req) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="empty-card">
          <div className="empty-ico">
            <Icon name="send" size={22} />
          </div>
          <h3>{tr('Нет открытого запроса')}</h3>
          <p>{tr('Создайте новый запрос или откройте его из коллекции слева.')}</p>
        </div>
      </div>
    )
  }

  const mode: RequestMode = req.mode ?? 'http'

  const patch = (p: Partial<RequestModel>) => useTabs.getState().patchTab(tab.id, p)

  // save/save-as/codegen helpers operate on the ACTIVE tab; activate this
  // builder's tab first so they target it (split-screen support).
  const activateThis = () => {
    if (useTabs.getState().doc.activeTabId !== tab.id) useTabs.getState().setActive(tab.id)
  }

  // gRPC has a bespoke builder (proto + service/method + message) instead of the
  // HTTP params/headers/body tabs.
  if (mode === 'grpc') {
    return (
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 }} data-undo-tab={tab.id}>
        <div style={{ display: 'contents' }} data-undo-field="url">
          <UrlBar req={req} tabId={tab.id} />
        </div>
        <div style={{ overflowY: 'auto', minHeight: 0 }}>
          <Suspense fallback={null}>
            <GrpcBuilder req={req} tabId={tab.id} />
          </Suspense>
        </div>
      </div>
    )
  }

  const exampleCount = req.examples?.length ?? 0
  const counts: Partial<Record<Tab, number>> = {
    params: req.query.filter((p) => p.enabled && p.key).length,
    headers: req.headers.filter((h) => h.enabled && h.key).length,
    examples: exampleCount
  }
  const bodyDot = req.body.type !== 'none'

  // HTTP & GraphQL get the full builder; realtime modes only use the URL, query,
  // and handshake headers.
  const httpLike = mode === 'http' || mode === 'graphql'
  const tabs: { id: Tab; label: string }[] = httpLike
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
  const activeSubTab: Tab = tabs.some((t) => t.id === subTab) ? subTab : 'params'

  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 }} data-undo-tab={tab.id}>
      <div style={{ display: 'contents' }} data-undo-field="meta">
        <RequestMeta tab={tab} />
      </div>
      <div style={{ display: 'contents' }} data-undo-field="url">
        <UrlBar req={req} tabId={tab.id} />
      </div>
      <div className="req-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${activeSubTab === t.id ? 'on' : ''}`} onClick={() => setSubTab(t.id)}>
            {t.label}
            {counts[t.id] != null && counts[t.id]! > 0 && <span className="count">{counts[t.id]}</span>}
            {t.id === 'body' && bodyDot && <span className="dirty" style={{ width: 5, height: 5 }} />}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }} />
        <button
          className="btn primary"
          data-tour="save"
          style={{ height: 28 }}
          onClick={() => {
            activateThis()
            saveActiveRequest()
          }}
          title={tr('Сохранить (⌘S / Ctrl+S)')}
        >
          <Icon name="save" size={14} /> {tr('Сохранить')} </button>
        <button
          className="btn ghost"
          style={{ height: 28 }}
          onClick={() => {
            activateThis()
            openSaveAsDialog()
          }}
          title={tr('Сохранить как новый запрос в коллекции')}
        >
          <Icon name="copy" size={14} /> {tr('Сохранить как…')} </button>
        {httpLike && (
          <button
            className="btn ghost"
            style={{ height: 28 }}
            onClick={() => {
              // CodeGenModal reads the active request — activate ours first.
              activateThis()
              setCodeGenOpen(true)
            }}
            title={tr('Сгенерировать код')}
          >
            <Icon name="code2" size={14} /> {tr('Код')} </button>
        )}
      </div>
      <CodeGenModal open={codeGenOpen} onOpenChange={setCodeGenOpen} />
      <div style={{ overflowY: 'auto', minHeight: 0 }} data-undo-field={activeSubTab}>
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
                ? tr(
                    'Host, Content-Length, User-Agent и др. добавляются автоматически. Чтобы переопределить любой из них — добавьте заголовок с тем же именем выше.'
                  )
                : tr('Заголовки рукопожатия отправляются при подключении.')}
            </div>
          </>
        )}
        {activeSubTab === 'auth' && <AuthTab req={req} tabId={tab.id} />}
        {activeSubTab === 'body' && <BodyTab req={req} tabId={tab.id} />}
        {activeSubTab === 'scripts' && <ScriptsTab req={req} tabId={tab.id} />}
        {activeSubTab === 'examples' && <ExamplesTab req={req} tabId={tab.id} />}
      </div>
    </div>
  )
}

function PathVarsTable({
  detected,
  pathVariables,
  onChange,
  scope: _scope
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
              <input value={valueOf(key)} placeholder={tr('значение')} onChange={(e) => set(key, e.target.value)} />
            </div>
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

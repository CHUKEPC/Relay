import { useRef } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { useTabs } from '@renderer/store/tabs'
import { useEnvironments } from '@renderer/store/environments'
import { useResponse } from '@renderer/store/response'
import { useAi } from '@renderer/store/ai'
import { currentScope, currentSecretValues } from '@renderer/lib/request-runner'
import { trackDrag } from '@renderer/lib/drag'
import { buildContextSnapshot } from '@renderer/lib/ai-context'
import { interpolate } from '@shared/interpolate'
import { RequestBuilder } from '@renderer/features/request/RequestBuilder'
import { ResponsePanel } from '@renderer/features/response/ResponsePanel'
import { RealtimePanel } from '@renderer/features/realtime/RealtimePanel'
import { GrpcResponse } from '@renderer/features/grpc/GrpcResponse'
import '@renderer/styles/feat-panes.css'

/**
 * One builder + divider + response column for a single tab.
 * Pane 0 passes the global active tab; extra panes pass their pinned tab.
 * respPct/layout are shared across panes via the ui store (by design).
 */
function PaneView({ tabId, hintWhenEmpty }: { tabId: string | null; hintWhenEmpty?: boolean }) {
  const layout = useUi((s) => s.layout)
  const respPct = useUi((s) => s.respPct)
  const setRespPct = useUi((s) => s.setRespPct)
  const toggleLayout = useUi((s) => s.toggleLayout)
  const mode = useTabs((s) => s.doc.tabs.find((t) => t.id === tabId)?.request.mode ?? 'http')
  const wsRef = useRef<HTMLDivElement>(null)

  const onDividerDown = () => {
    trackDrag(
      (ev) => {
        if (!wsRef.current) return
        const r = wsRef.current.getBoundingClientRect()
        const pct = layout === 'split-v' ? (1 - (ev.clientY - r.top) / r.height) * 100 : (1 - (ev.clientX - r.left) / r.width) * 100
        setRespPct(pct)
      },
      { cursor: layout === 'split-v' ? 'row-resize' : 'col-resize' }
    )
  }

  const horizontal = layout === 'split-h'

  // Extra panes without a pinned tab show a hint; pane 0 keeps the classic
  // RequestBuilder empty card (exactly the single-pane behavior).
  if (!tabId && hintWhenEmpty) {
    return <div className="pane-blank">Выберите вкладку для этой панели</div>
  }

  return (
    <div className="workspace" ref={wsRef} style={horizontal ? { flexDirection: 'row' } : undefined}>
      <div
        style={
          horizontal
            ? { width: `${100 - respPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--line)', overflow: 'auto' }
            : { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }
        }
      >
        <RequestBuilder tabId={tabId ?? undefined} />
      </div>

      <div
        className="divider"
        style={horizontal ? { width: 8, height: 'auto', cursor: 'col-resize' } : undefined}
        onMouseDown={onDividerDown}
        onDoubleClick={toggleLayout}
        title="Перетащите, чтобы изменить размер · двойной клик меняет ориентацию"
      >
        <div className="grip" />
      </div>

      <div
        style={
          horizontal
            ? { width: `${respPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }
            : { height: `${respPct}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }
        }
      >
        {tabId &&
          (mode === 'websocket' || mode === 'sse' || mode === 'socketio' || mode === 'mqtt' ? (
            <RealtimePanel key={tabId} tabId={tabId} kind={mode} />
          ) : mode === 'grpc' ? (
            <GrpcResponse key={tabId} tabId={tabId} />
          ) : (
            <ResponsePanel key={tabId} tabId={tabId} onAskAI={() => askAiAboutResponse(tabId)} />
          ))}
      </div>
    </div>
  )
}

/** Removes pane `paneIndex` (>=1): shift later slots left, then shrink the count. */
function closePane(paneIndex: number) {
  const { panes, setPaneTab, setPaneCount } = useUi.getState()
  if (panes.count <= 1) return
  const extra = panes.extraTabIds.slice()
  extra.splice(paneIndex - 1, 1)
  extra.forEach((id, i) => setPaneTab(i, id ?? null))
  // setPaneCount truncates extraTabIds to count-1, dropping the now-stale tail slot.
  setPaneCount((panes.count - 1) as 1 | 2 | 3)
}

export function Workspace() {
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const tabs = useTabs((s) => s.doc.tabs)
  const panes = useUi((s) => s.panes)
  const setPaneTab = useUi((s) => s.setPaneTab)

  // Single pane: exactly the pre-split-screen layout, no pane header.
  if (panes.count === 1) {
    return (
      <div className="main">
        <PaneView tabId={activeTabId} />
      </div>
    )
  }

  // A pinned tab that has been closed degrades to an empty slot.
  const slotTabId = (slot: number): string | null => {
    const id = panes.extraTabIds[slot] ?? null
    return id && tabs.some((t) => t.id === id) ? id : null
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const renderPane = (paneIndex: number) => {
    const tabId = paneIndex === 0 ? activeTabId : slotTabId(paneIndex - 1)
    const pinned = paneIndex === 0 ? null : tabs.find((t) => t.id === tabId)
    return (
      <div className="pane" key={paneIndex}>
        {paneIndex === 0 ? (
          <div className="pane-head">
            <span className="pane-head-label">Активная вкладка</span>
            <span className="pane-head-name">{activeTab ? activeTab.request.name || 'Без названия' : '—'}</span>
          </div>
        ) : (
          <div className="pane-head">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="pane-tab-pick" title="Привязать вкладку к панели">
                  {pinned ? (
                    <>
                      <span className={`method-tag m-${pinned.request.method}`}>
                        {pinned.request.method === 'DELETE' ? 'DEL' : pinned.request.method}
                      </span>
                      <span className="label">{pinned.request.name || 'Без названия'}</span>
                    </>
                  ) : (
                    <span className="ph">Выберите вкладку…</span>
                  )}
                  <Icon name="chevDsm" size={12} style={{ color: 'var(--tx-3)', flex: 'none' }} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="popover" align="start" sideOffset={4} style={{ position: 'relative', minWidth: 220 }}>
                  {tabs.length === 0 && (
                    <div className="pop-item" style={{ color: 'var(--tx-3)', pointerEvents: 'none' }}>
                      Нет открытых вкладок
                    </div>
                  )}
                  {tabs.map((t) => (
                    <DropdownMenu.Item
                      key={t.id}
                      className={`pop-item ${tabId === t.id ? 'on' : ''}`}
                      onSelect={() => setPaneTab(paneIndex - 1, t.id)}
                    >
                      <span className={`method-tag m-${t.request.method}`}>{t.request.method === 'DELETE' ? 'DEL' : t.request.method}</span>
                      <span className="pane-pick-name">{t.request.name || 'Без названия'}</span>
                      {tabId === t.id && <Icon name="check" size={14} className="tick" />}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className="grow" />
            <button className="icon-btn pane-close" title="Закрыть панель" onClick={() => closePane(paneIndex)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <PaneView tabId={tabId} hintWhenEmpty={paneIndex > 0} />
      </div>
    )
  }

  return (
    <div className="main">
      <div className={`panes panes-${panes.count}`}>{Array.from({ length: panes.count }, (_, i) => renderPane(i))}</div>
    </div>
  )
}

/** Open the AI panel and ask about a tab's response (defaults to the active tab). */
export function askAiAboutResponse(tabId?: string) {
  useUi.getState().setAiOpen(true)
  const tabs = useTabs.getState()
  const tab = tabId ? (tabs.doc.tabs.find((t) => t.id === tabId) ?? null) : tabs.activeTab()
  if (!tab) return
  if (!useAi.getState().activeProvider()?.hasKey) return // panel shows the connect prompt
  const req = tab.request
  const result = useResponse.getState().get(tab.id).result
  const scope = currentScope(tab.id)
  const env = useEnvironments.getState().activeEnv()
  const snapshot = buildContextSnapshot({
    request: req,
    resolvedUrl: interpolate(req.url, scope),
    response: result,
    envName: env?.name,
    envVarNames: env?.variables.filter((v) => v.enabled).map((v) => v.key),
    secretValues: currentSecretValues(tab.id)
  })
  const label = { label: `${req.method} ${req.url.replace(/\{\{[^}]+\}\}/g, '')}${result ? ` · ${result.status}` : ''}`, icon: 'doc' }
  void useAi.getState().send('Объясни этот ответ: статус, структуру полей и есть ли проблемы.', snapshot, label)
}

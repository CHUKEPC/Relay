import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { makeId } from '@shared/id'
import { Icon } from './components/Icon'
import { useUi } from './store/ui'
import { useSettings } from './store/settings'
import { useTabs } from './store/tabs'
import { useEnvironments } from './store/environments'
import { useCollections } from './store/collections'
import { useResponse } from './store/response'
import { useAi } from './store/ai'
import { bootstrap } from './store/bootstrap'
import { sendActiveRequest, currentScope, currentSecretValues } from './lib/request-runner'
import { buildContextSnapshot } from './lib/ai-context'
import { interpolate } from '@shared/interpolate'
import { Sidebar } from './features/sidebar/Sidebar'
import { RequestBuilder } from './features/request/RequestBuilder'
import { ResponsePanel } from './features/response/ResponsePanel'
import { RealtimePanel } from './features/realtime/RealtimePanel'
import { AiPanel } from './features/ai/AiPanel'
import { CommandPalette } from './features/palette/CommandPalette'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { SaveDialog } from './features/collections/SaveDialog'
import { ToolConfirmModal } from './features/ai/ToolConfirmModal'
import { RunnerPanel } from './features/runner/RunnerPanel'
import { WorkspaceSwitcher } from './features/workspaces/WorkspaceSwitcher'
import { useWorkspaces } from './store/workspaces'

export function App() {
  const [ready, setReady] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)

  const aiOpen = useUi((s) => s.aiOpen)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const settingsSection = useUi((s) => s.settingsSection)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    bootstrap()
      .then(() => useWorkspaces.getState().load())
      .catch((err) => console.error('bootstrap failed', err))
      .finally(() => setReady(true))
  }, [])

  const saveActive = () => {
    const tab = useTabs.getState().activeTab()
    if (!tab) return
    if (tab.savedRequestId) {
      useCollections.getState().updateRequest(tab.savedRequestId, tab.request)
      useTabs.getState().markSaved(tab.id, tab.savedRequestId)
      useUi.getState().showToast('Сохранено')
    } else {
      setSaveOpen(true)
    }
  }

  const onSaveAs = (parentId: string, name: string) => {
    const tab = useTabs.getState().activeTab()
    if (!tab) return
    const id = makeId('req')
    const req = { ...tab.request, id, name }
    useCollections.getState().addRequest(parentId, req)
    useTabs.getState().patchTab(tab.id, { id, name })
    useTabs.getState().markSaved(tab.id, id)
    useUi.getState().showToast('Сохранено')
  }

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUi.getState().togglePalette()
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        void sendActiveRequest()
      } else if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        useUi.getState().toggleAi()
      } else if (mod && e.key === ',') {
        e.preventDefault()
        useUi.getState().openSettings()
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useTabs.getState().openNew()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveActive()
      } else if (mod && e.key.toLowerCase() === 'w') {
        const tab = useTabs.getState().activeTab()
        if (tab) {
          e.preventDefault()
          useTabs.getState().closeTab(tab.id)
        }
      } else if (e.key === 'Escape') {
        // Close only the topmost overlay (palette sits above settings), not both.
        if (useUi.getState().paletteOpen) {
          e.preventDefault()
          useUi.getState().setPaletteOpen(false)
        } else if (useUi.getState().settingsOpen) {
          e.preventDefault()
          useUi.getState().closeSettings()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="bolt" size={20} style={{ color: 'var(--accent)' }} />
          Загрузка Relay…
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Titlebar />
      <TabStrip />
      <div className="body">
        <Sidebar />
        <Workspace />
        {aiOpen && <AiPanel onClose={() => useUi.getState().setAiOpen(false)} onConnect={() => useUi.getState().openSettings('providers')} />}
      </div>

      {settingsOpen && <SettingsScreen onClose={() => useUi.getState().closeSettings()} initialSection={settingsSection} />}
      {paletteOpen && <CommandPalette />}
      <ToolConfirmModal />
      <RunnerPanel />
      <SaveDialog open={saveOpen} initialName={useTabs.getState().activeTab()?.request.name ?? 'Untitled'} onOpenChange={setSaveOpen} onSave={onSaveAs} />

      {toast && (
        <div className="toast-host">
          <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>
            <Icon name={toast.kind === 'error' ? 'warn' : 'check'} size={14} className={`t-ico ${toast.kind === 'error' ? 'err' : 'ok'}`} />
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Titlebar ---------------- */
function Titlebar() {
  const setTheme = useSettings((s) => s.setTheme)
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const themeChoice = useSettings((s) => s.settings.theme)
  const aiOpen = useUi((s) => s.aiOpen)
  const environments = useEnvironments((s) => s.env.environments)
  const activeEnvId = useEnvironments((s) => s.env.activeEnvironmentId)
  const setActiveEnv = useEnvironments((s) => s.setActiveEnv)
  const activeEnv = environments.find((e) => e.id === activeEnvId)

  return (
    <div className="titlebar drag-region">
      <div className="win-dots nodrag">
        <i title="Закрыть" onClick={() => void window.api.closeWindow()} />
        <i title="Свернуть" onClick={() => void window.api.minimizeWindow()} />
        <i title="Развернуть" onClick={() => void window.api.maximizeWindow()} />
      </div>
      <div className="brand" style={{ marginLeft: 6 }}>
        <div className="brand-mark">
          <Icon name="bolt" size={13} style={{ color: '#fff' }} />
        </div>
        Relay
      </div>
      <WorkspaceSwitcher />
      <div className="grow" />
      <div className="global-search nodrag" onClick={() => useUi.getState().setPaletteOpen(true)}>
        <Icon name="search" size={14} />
        <span className="ph">Поиск или команда…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="grow" />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <div className="env-pill nodrag">
            <span className="dot" />
            {activeEnv ? activeEnv.name : 'No Environment'}
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)' }} />
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={6} style={{ position: 'relative', minWidth: 200 }}>
            <DropdownMenu.Item className={`pop-item ${activeEnvId === null ? 'on' : ''}`} onSelect={() => setActiveEnv(null)}>
              <Icon name="env" size={14} style={{ color: 'var(--tx-3)' }} />
              <span style={{ flex: 1 }}>No Environment</span>
              {activeEnvId === null && <Icon name="check" size={14} className="tick" />}
            </DropdownMenu.Item>
            {environments.map((e) => (
              <DropdownMenu.Item key={e.id} className={`pop-item ${activeEnvId === e.id ? 'on' : ''}`} onSelect={() => setActiveEnv(e.id)}>
                <Icon name="env" size={14} style={{ color: 'var(--m-get)' }} />
                <span style={{ flex: 1 }}>{e.name}</span>
                {activeEnvId === e.id && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className="theme-toggle nodrag">
        <button className={resolvedTheme === 'light' && themeChoice !== 'system' ? 'on' : ''} onClick={() => setTheme('light')} title="Светлая">
          <Icon name="sun" size={15} />
        </button>
        <button className={resolvedTheme === 'dark' && themeChoice !== 'system' ? 'on' : ''} onClick={() => setTheme('dark')} title="Тёмная">
          <Icon name="moon" size={14} />
        </button>
      </div>
      <button className={`icon-btn nodrag ${aiOpen ? 'on' : ''}`} onClick={() => useUi.getState().toggleAi()} title="AI-ассистент (⌘J)">
        <Icon name="sparkle" size={16} />
      </button>
    </div>
  )
}

/* ---------------- Tab strip ---------------- */
function TabStrip() {
  const tabs = useTabs((s) => s.doc.tabs)
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const setActive = useTabs((s) => s.setActive)
  const closeTab = useTabs((s) => s.closeTab)
  const openNew = useTabs((s) => s.openNew)

  return (
    <div className="tabstrip">
      {tabs.map((t) => (
        <div key={t.id} className={`rtab ${activeTabId === t.id ? 'on' : ''}`} onClick={() => setActive(t.id)}>
          <span className={`method-tag m-${t.request.method}`}>{t.request.method === 'DELETE' ? 'DEL' : t.request.method}</span>
          <span className="label">{t.request.name || 'Untitled'}</span>
          {t.dirty ? (
            <span className="dirty" title="Несохранённые изменения" />
          ) : (
            <span
              className="x"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              <Icon name="close" size={12} />
            </span>
          )}
        </div>
      ))}
      <button className="icon-btn" style={{ alignSelf: 'center', marginLeft: 4 }} onClick={() => openNew()} title="Новый запрос (⌘N)">
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}

/* ---------------- Workspace (request + response split) ---------------- */
function Workspace() {
  const layout = useUi((s) => s.layout)
  const respPct = useUi((s) => s.respPct)
  const setRespPct = useUi((s) => s.setRespPct)
  const toggleLayout = useUi((s) => s.toggleLayout)
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const activeMode = useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.request.mode ?? 'http')
  const wsRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const onDividerDown = () => {
    draggingRef.current = true
    document.body.style.cursor = layout === 'split-v' ? 'row-resize' : 'col-resize'
    const move = (ev: MouseEvent) => {
      if (!draggingRef.current || !wsRef.current) return
      const r = wsRef.current.getBoundingClientRect()
      const pct = layout === 'split-v' ? (1 - (ev.clientY - r.top) / r.height) * 100 : (1 - (ev.clientX - r.left) / r.width) * 100
      setRespPct(pct)
    }
    const up = () => {
      draggingRef.current = false
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const horizontal = layout === 'split-h'

  return (
    <div className="main">
      <div className="workspace" ref={wsRef} style={horizontal ? { flexDirection: 'row' } : undefined}>
        <div
          style={
            horizontal
              ? { width: `${100 - respPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--line)', overflow: 'auto' }
              : { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }
          }
        >
          <RequestBuilder />
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
          {activeTabId &&
            (activeMode === 'http' ? (
              <ResponsePanel key={activeTabId} tabId={activeTabId} onAskAI={() => askAiAboutResponse()} />
            ) : (
              <RealtimePanel key={activeTabId} tabId={activeTabId} kind={activeMode === 'websocket' ? 'websocket' : 'sse'} />
            ))}
        </div>
      </div>
    </div>
  )
}

function askAiAboutResponse() {
  useUi.getState().setAiOpen(true)
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  if (!useAi.getState().activeProvider()?.hasKey) return // panel shows the connect prompt
  const req = tab.request
  const result = useResponse.getState().get(tab.id).result
  const scope = currentScope()
  const env = useEnvironments.getState().activeEnv()
  const snapshot = buildContextSnapshot({
    request: req,
    resolvedUrl: interpolate(req.url, scope),
    response: result,
    envName: env?.name,
    envVarNames: env?.variables.filter((v) => v.enabled).map((v) => v.key),
    secretValues: currentSecretValues()
  })
  const label = { label: `${req.method} ${req.url.replace(/\{\{[^}]+\}\}/g, '')}${result ? ` · ${result.status}` : ''}`, icon: 'doc' }
  void useAi.getState().send('Объясни этот ответ: статус, структуру полей и есть ли проблемы.', snapshot, label)
}

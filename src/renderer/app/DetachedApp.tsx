import { useEffect, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { bootstrap } from '@renderer/store/bootstrap'

// Same reason as in App: a language switch remounts this window's tree.
let detachedBooted = false
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useResponse, type TabResponse } from '@renderer/store/response'
import { usePanes, restoreResponse } from '@renderer/store/panes'
import { wireStorageSync } from '@renderer/store/cross-window'
import { useSettings } from '@renderer/store/settings'
import { matchAction, kbdCombo } from '@renderer/lib/keymap'
import { handleUndoKey } from '@renderer/lib/undo'
import { runPaneAction } from '@renderer/lib/pane-actions'
import { sendActiveRequest } from '@renderer/lib/request-runner'
import { saveActiveAs, saveActiveRequest } from '@renderer/lib/save'
import { SaveDialog } from '@renderer/features/collections/SaveDialog'
import { PaneView } from './Workspace'

import { tr, trf } from '@renderer/lib/i18n'
/** The URL fragment `#pane=<tabId>` marks a detached pane window. */
export function detachedTabIdFromUrl(): string | null {
  const m = /(?:^|[#&])pane=([^&]+)/.exec(window.location.hash)
  return m ? decodeURIComponent(m[1]) : null
}

/** One request tab in its own OS window: builder + response, nothing else. */
export function DetachedApp({ tabId }: { tabId: string }) {
  const [ready, setReady] = useState(detachedBooted)
  const tab = useTabs((s) => s.doc.tabs.find((t) => t.id === tabId) ?? null)
  const leaf = usePanes((s) => (s.root.kind === 'leaf' ? s.root : null))
  const saveOpen = useUi((s) => s.saveDialogOpen)
  const toast = useUi((s) => s.toast)
  const keybindings = useSettings((s) => s.settings.keybindings)

  useEffect(() => {
    usePanes.getState().initDetached(tabId)
    wireStorageSync()
    if (detachedBooted) return
    detachedBooted = true
    bootstrap({ detached: true })
      .then(async () => {
        useTabs.getState().setActive(tabId)
        const snap = await window.api.paneTakeSnapshot(tabId)
        if (snap) restoreResponse(tabId, snap as TabResponse)
      })
      .catch((err) => console.error('detached bootstrap failed', err))
      .finally(() => setReady(true))

    // Hand the response back so it is still visible after returning to the main window.
    const onUnload = () => window.api.panePutSnapshot(tabId, useResponse.getState().byTab[tabId] ?? null)
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [tabId])

  // The tab was closed (or its workspace switched away) in the main window.
  // Only after it was actually shown: a failed load must not silently close the window.
  const seenRef = useRef(false)
  if (tab) seenRef.current = true
  useEffect(() => {
    if (ready && !tab && seenRef.current) void window.api.closeWindow()
  }, [ready, tab])

  useEffect(() => {
    document.title = `${tr(tab?.request.name || 'Без названия')} — Relay`
  }, [tab?.request.name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = matchAction(e, useSettings.getState().settings.keybindings)
      if (!action) return
      if (action === 'send') void sendActiveRequest(tabId)
      else if (action === 'save') saveActiveRequest()
      else if (action === 'closeTab') void window.api.paneAttach(tabId)
      else if (!runPaneAction(action)) return
      e.preventDefault()
    }
    // Capture phase, like the main window: Monaco and the request fields must
    // not be able to swallow a shortcut.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', handleUndoKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', handleUndoKey, true)
    }
  }, [tabId])

  if (ready && !tab && !seenRef.current) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--tx-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}> {tr('Не удалось загрузить запрос для этого окна.')} <button className="btn" onClick={() => void window.api.paneAttach(tabId)}> {tr('Закрыть окно')} </button>
        </div>
      </div>
    )
  }

  if (!ready || !leaf) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="bolt" size={20} style={{ color: 'var(--accent)' }} /> {tr('Загрузка…')} </div>
      </div>
    )
  }

  const isMac = window.api.platform === 'darwin'

  return (
    <div className="app detached-app">
      <div className="titlebar drag-region">
        {isMac && (
          <div className="win-dots nodrag">
            <i title={tr('Закрыть')} onClick={() => void window.api.closeWindow()} />
            <i title={tr('Свернуть')} onClick={() => void window.api.minimizeWindow()} />
            <i title={tr('Развернуть')} onClick={() => void window.api.maximizeWindow()} />
          </div>
        )}
        <div className="brand" style={{ marginLeft: isMac ? 6 : 4 }}>
          <div className="brand-mark">
            <Icon name="bolt" size={13} style={{ color: '#fff' }} />
          </div>
        </div>
        {tab && (
          <div className="detached-title">
            <span className={`method-tag m-${tab.request.method}`}>{tab.request.method === 'DELETE' ? 'DEL' : tab.request.method}</span>
            <span className="detached-name">{tr(tab.request.name || 'Без названия')}</span>
            {tab.dirty && <span className="pane-dirty" title={tr('Несохранённые изменения')} />}
          </div>
        )}
        <div className="grow" />
        <button
          className="btn ghost nodrag detached-return"
          title={trf('Вернуть в основное окно ({key})', { key: kbdCombo('paneDetach', keybindings) })}
          onClick={() => void window.api.paneAttach(tabId)}
        >
          <Icon name="dockBottom" size={14} /> {tr('Вернуть в основное окно')} </button>
        {!isMac && (
          <div className="win-controls nodrag">
            <button className="wc" title={tr('Свернуть')} onClick={() => void window.api.minimizeWindow()}>
              <Icon name="winMin" size={14} />
            </button>
            <button className="wc" title={tr('Развернуть')} onClick={() => void window.api.maximizeWindow()}>
              <Icon name="winMax" size={12} />
            </button>
            <button className="wc close" title={tr('Закрыть')} onClick={() => void window.api.closeWindow()}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="body">
        <div className="main">
          <div className="panes">
            <div className="pane">
              <PaneView leaf={leaf} />
            </div>
          </div>
        </div>
      </div>

      <SaveDialog
        open={saveOpen}
        initialName={tr(tab?.request.name ?? 'Без названия')}
        onOpenChange={(v) => useUi.getState().setSaveDialogOpen(v)}
        onSave={saveActiveAs}
      />

      {toast && (
        <div className="toast-host">
          <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>
            <Icon name={toast.kind === 'error' ? 'warn' : 'check'} size={14} className={`t-ico ${toast.kind === 'error' ? 'err' : 'ok'}`} />
            {toast.message}
            {toast.action && (
              <button
                className="toast-act"
                onClick={() => {
                  const run = toast.action?.run
                  useUi.getState().dismissToast()
                  run?.()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

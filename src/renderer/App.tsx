import { lazy, Suspense, useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { useUi } from './store/ui'
import { useTabs } from './store/tabs'
import { bootstrap } from './store/bootstrap'
import { sendActiveRequest } from './lib/request-runner'
import { saveActiveAs, saveActiveRequest } from './lib/save'
import { runPaneAction } from './lib/pane-actions'
import { initPanes } from './store/panes'
import { wireStorageSync } from './store/cross-window'
import { matchAction } from './lib/keymap'
import { handleUndoKey } from './lib/undo'
import { useSettings } from './store/settings'
import { Titlebar } from './app/Titlebar'
import { TabStrip } from './app/TabStrip'
import { Workspace } from './app/Workspace'
import { Sidebar } from './features/sidebar/Sidebar'
import { SaveDialog } from './features/collections/SaveDialog'
import { Tour, startTour } from './features/onboarding/Tour'
import { useWorkspaces } from './store/workspaces'
import { useCap, useFeatures } from './store/features'

import { tr } from '@renderer/lib/i18n'
// The AI assistant ships as a feature pack: keep its bundle out of the startup
// path and load it only when the pack is enabled and the panel is opened.
const AiPanel = lazy(() => import('./features/ai/AiPanel').then((m) => ({ default: m.AiPanel })))
const ToolConfirmModal = lazy(() => import('./features/ai/ToolConfirmModal').then((m) => ({ default: m.ToolConfirmModal })))

// Screens that are closed on startup and heavy when opened: the settings tree,
// the command palette, the collection runner and the request console.
const CommandPalette = lazy(() => import('./features/palette/CommandPalette').then((m) => ({ default: m.CommandPalette })))
const SettingsScreen = lazy(() => import('./features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const RunnerPanel = lazy(() => import('./features/runner/RunnerPanel').then((m) => ({ default: m.RunnerPanel })))
const ConsolePanel = lazy(() => import('./features/console/ConsolePanel').then((m) => ({ default: m.ConsolePanel })))

/**
 * Bootstrapping is per window, not per mount: changing the UI language remounts
 * the whole tree (see main.tsx), and re-running bootstrap there would re-read
 * the not-yet-flushed settings document and undo the switch.
 */
let booted = false

export function App() {
  const [ready, setReady] = useState(booted)

  const aiOpen = useUi((s) => s.aiOpen)
  const hasAi = useCap('ai')
  const settingsOpen = useUi((s) => s.settingsOpen)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const saveOpen = useUi((s) => s.saveDialogOpen)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    if (booted) return
    booted = true
    wireStorageSync()
    bootstrap()
      .then(() => initPanes())
      .then(() => useWorkspaces.getState().load())
      .then(() => {
        // First run only: give the UI a beat to paint before spotlighting it.
        if (!useSettings.getState().settings.onboardingDone) setTimeout(startTour, 800)
      })
      .catch((err) => console.error('bootstrap failed', err))
      .finally(() => setReady(true))
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Read keybindings at event time so rebinding in Settings applies immediately.
      const action = matchAction(e, useSettings.getState().settings.keybindings)
      switch (action) {
        case 'palette':
          e.preventDefault()
          useUi.getState().togglePalette()
          return
        case 'send':
          e.preventDefault()
          void sendActiveRequest()
          return
        case 'toggleAi':
          e.preventDefault()
          // Without the AI pack there is no panel to toggle.
          if (useFeatures.getState().caps.has('ai')) useUi.getState().toggleAi()
          return
        case 'settings':
          e.preventDefault()
          useUi.getState().openSettings()
          return
        case 'newRequest':
          e.preventDefault()
          useTabs.getState().openNew()
          return
        case 'save':
          e.preventDefault()
          saveActiveRequest()
          return
        case 'closeTab': {
          const tab = useTabs.getState().activeTab()
          if (tab) {
            e.preventDefault()
            useTabs.getState().closeTab(tab.id)
          }
          return
        }
        default:
          if (action && !useUi.getState().settingsOpen && runPaneAction(action)) {
            e.preventDefault()
            return
          }
      }
      if (e.key === 'Escape') {
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
    // Capture phase so request-field undo runs before Monaco's own handler.
    window.addEventListener('keydown', handleUndoKey, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', handleUndoKey, true)
    }
  }, [])

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--tx-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="bolt" size={20} style={{ color: 'var(--accent)' }} /> {tr('Загрузка Relay…')} </div>
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
        {hasAi && aiOpen && (
          <Suspense fallback={null}>
            <AiPanel onClose={() => useUi.getState().setAiOpen(false)} onConnect={() => useUi.getState().openSettings('providers')} />
          </Suspense>
        )}
      </div>

      <Suspense fallback={null}>
        {settingsOpen && <SettingsScreen onClose={() => useUi.getState().closeSettings()} />}
        {paletteOpen && <CommandPalette />}
      </Suspense>
      {hasAi && (
        <Suspense fallback={null}>
          <ToolConfirmModal />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <RunnerPanel />
        <ConsolePanel />
      </Suspense>
      <SaveDialog
        open={saveOpen}
        initialName={tr(useTabs.getState().activeTab()?.request.name ?? 'Без названия')}
        onOpenChange={(v) => useUi.getState().setSaveDialogOpen(v)}
        onSave={saveActiveAs}
      />

      <Tour />

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

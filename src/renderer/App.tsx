import { useEffect, useState } from 'react'
import { makeId } from '@shared/id'
import { Icon } from './components/Icon'
import { useUi } from './store/ui'
import { useTabs } from './store/tabs'
import { useCollections } from './store/collections'
import { bootstrap } from './store/bootstrap'
import { sendActiveRequest } from './lib/request-runner'
import { saveActiveRequest } from './lib/save'
import { matchAction } from './lib/keymap'
import { useSettings } from './store/settings'
import { Titlebar } from './app/Titlebar'
import { TabStrip } from './app/TabStrip'
import { Workspace } from './app/Workspace'
import { Sidebar } from './features/sidebar/Sidebar'
import { AiPanel } from './features/ai/AiPanel'
import { CommandPalette } from './features/palette/CommandPalette'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { SaveDialog } from './features/collections/SaveDialog'
import { ToolConfirmModal } from './features/ai/ToolConfirmModal'
import { RunnerPanel } from './features/runner/RunnerPanel'
import { ConsolePanel } from './features/console/ConsolePanel'
import { Tour, startTour } from './features/onboarding/Tour'
import { useWorkspaces } from './store/workspaces'

export function App() {
  const [ready, setReady] = useState(false)

  const aiOpen = useUi((s) => s.aiOpen)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const settingsSection = useUi((s) => s.settingsSection)
  const paletteOpen = useUi((s) => s.paletteOpen)
  const saveOpen = useUi((s) => s.saveDialogOpen)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    bootstrap()
      .then(() => useWorkspaces.getState().load())
      .then(() => {
        // First run only: give the UI a beat to paint before spotlighting it.
        if (!useSettings.getState().settings.onboardingDone) setTimeout(startTour, 800)
      })
      .catch((err) => console.error('bootstrap failed', err))
      .finally(() => setReady(true))
  }, [])

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
          useUi.getState().toggleAi()
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
      <ConsolePanel />
      <SaveDialog
        open={saveOpen}
        initialName={useTabs.getState().activeTab()?.request.name ?? 'Без названия'}
        onOpenChange={(v) => useUi.getState().setSaveDialogOpen(v)}
        onSave={onSaveAs}
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

import { useEffect, useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '@renderer/components/Icon'
import { useCap } from '@renderer/store/features'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { useEnvironments } from '@renderer/store/environments'
import { collectButtons, usePlugins } from '@renderer/store/plugins'
import { kbd, MOD } from '@renderer/lib/platform'
import { kbdCombo, type KeyActionId } from '@renderer/lib/keymap'
import { leavesOf, PANE_COUNT_LABEL, PANE_PRESETS, usePanes } from '@renderer/store/panes'
import { WorkspaceSwitcher } from '@renderer/features/workspaces/WorkspaceSwitcher'

import { tr, trf } from '@renderer/lib/i18n'
export function Titlebar() {
  const setTheme = useSettings((s) => s.setTheme)
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const themeChoice = useSettings((s) => s.settings.theme)
  const aiOpen = useUi((s) => s.aiOpen)
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed)
  const hasAi = useCap('ai')
  const paneCount = usePanes((s) => leavesOf(s.root).length)
  const keybindings = useSettings((s) => s.settings.keybindings)
  const environments = useEnvironments((s) => s.env.environments)
  const activeEnvId = useEnvironments((s) => s.env.activeEnvironmentId)
  const setActiveEnv = useEnvironments((s) => s.setActiveEnv)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const pluginList = usePlugins((s) => s.plugins)
  const pluginBusy = usePlugins((s) => s.busy)
  const titlebarButtons = useMemo(() => collectButtons(pluginList, 'titlebar'), [pluginList])

  const isMac = window.api.platform === 'darwin'
  // Mirrors the real window state: the OS can maximize it too (Win+Up, a
  // double-click on the drag region, the taskbar).
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.api.onWindowMaximized(setMaximized), [])

  return (
    <div className="titlebar drag-region">
      {isMac && (
        <div className="win-dots nodrag">
          <i title={tr('Закрыть')} onClick={() => void window.api.closeWindow()} />
          <i title={tr('Свернуть')} onClick={() => void window.api.minimizeWindow()} />
          <i title={tr('Развернуть')} onClick={() => void window.api.maximizeWindow()} />
        </div>
      )}
      <button
        className={`icon-btn nodrag${sidebarCollapsed ? '' : ' on'}`}
        style={{ marginLeft: isMac ? 6 : 4 }}
        title={trf('Показать/скрыть боковую панель ({key})', { key: kbd('B') })}
        onClick={() => useUi.getState().toggleSidebar()}
      >
        <Icon name="sidebar" size={15} />
      </button>
      <div className="brand" style={{ marginLeft: 2 }}>
        <div className="brand-mark">
          <Icon name="bolt" size={13} style={{ color: '#fff' }} />
        </div>
        Relay
      </div>
      <WorkspaceSwitcher />
      <div className="grow" />
      <div className="global-search nodrag" data-tour="search" onClick={() => useUi.getState().setPaletteOpen(true)}>
        <Icon name="search" size={14} />
        <span className="ph">{tr('Поиск или команда…')}</span>
        <span className="kbd">{kbd('K')}</span>
      </div>
      <div className="grow" />

      {titlebarButtons.map(({ pluginId, pluginName, button }) => {
        const busy = !!pluginBusy[`${pluginId}:${button.id}`]
        return (
          <button
            key={`${pluginId}:${button.id}`}
            className="icon-btn nodrag"
            title={button.tooltip ?? `${pluginName} — ${button.label}`}
            disabled={busy}
            onClick={() => void usePlugins.getState().invokeButtonFromActiveTab(pluginId, button.id)}
          >
            <Icon name={busy ? 'refresh' : (button.icon ?? 'bolt')} size={15} className={busy ? 'spin' : undefined} />
          </button>
        )
      })}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <div className="env-pill nodrag" data-tour="env">
            <span className="dot" />
            {activeEnv ? tr(activeEnv.name) : tr('Без окружения')}
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)' }} />
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={6} style={{ position: 'relative', minWidth: 200 }}>
            <DropdownMenu.Item className={`pop-item ${activeEnvId === null ? 'on' : ''}`} onSelect={() => setActiveEnv(null)}>
              <Icon name="env" size={14} style={{ color: 'var(--tx-3)' }} />
              <span style={{ flex: 1 }}>{tr('Без окружения')}</span>
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

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={`icon-btn nodrag ${paneCount > 1 ? 'on' : ''}`} title={tr('Разбить экран')}>
            <Icon name="layoutGrid" size={15} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={6} style={{ position: 'relative', minWidth: 270 }}>
            {PANE_PRESETS.map((n) => (
              <DropdownMenu.Item
                key={n}
                className={`pop-item ${paneCount === n ? 'on' : ''}`}
                onSelect={() => usePanes.getState().applyPreset(n)}
              >
                <span style={{ flex: 1 }}>{tr(PANE_COUNT_LABEL[n] ?? `${n}`)}</span>
                <span className="pane-menu-kbd">{kbdCombo(`panePreset${n}` as KeyActionId, keybindings)}</span>
                {paneCount === n && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="pop-sep" />
            <DropdownMenu.Item className="pop-item" onSelect={() => usePanes.getState().splitActive('row')}>
              <Icon name="splitRight" size={14} />
              <span style={{ flex: 1 }}>{tr('Добавить панель справа')}</span>
              <span className="pane-menu-kbd">{kbdCombo('paneSplitRight', keybindings)}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="pop-item" onSelect={() => usePanes.getState().splitActive('col')}>
              <Icon name="splitDown" size={14} />
              <span style={{ flex: 1 }}>{tr('Добавить панель снизу')}</span>
              <span className="pane-menu-kbd">{kbdCombo('paneSplitDown', keybindings)}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="pop-sep" />
            <DropdownMenu.Item className="pop-item" onSelect={() => useUi.getState().openSettings('shortcuts')}>
              <Icon name="bolt" size={14} />
              <span style={{ flex: 1 }}>{tr('Горячие клавиши панелей…')}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Three explicit states. The old two-button version highlighted nothing
          while the theme was 'system', so a fresh install looked light with no
          button marked — the control must always show what is actually set. */}
      <div className="theme-toggle nodrag" role="group" aria-label={tr('Тема')}>
        <button
          className={themeChoice === 'system' ? 'on' : ''}
          aria-pressed={themeChoice === 'system'}
          onClick={() => setTheme('system')}
          title={`${tr('Системная')} — ${resolvedTheme === 'dark' ? tr('Тёмная') : tr('Светлая')}`}
        >
          <Icon name="monitor" size={14} />
        </button>
        <button
          className={themeChoice === 'light' ? 'on' : ''}
          aria-pressed={themeChoice === 'light'}
          onClick={() => setTheme('light')}
          title={tr('Светлая')}
        >
          <Icon name="sun" size={15} />
        </button>
        <button
          className={themeChoice === 'dark' ? 'on' : ''}
          aria-pressed={themeChoice === 'dark'}
          onClick={() => setTheme('dark')}
          title={tr('Тёмная')}
        >
          <Icon name="moon" size={14} />
        </button>
      </div>
      {hasAi && (
        <button className={`icon-btn nodrag ${aiOpen ? 'on' : ''}`} data-tour="ai" onClick={() => useUi.getState().toggleAi()} title={trf('AI-ассистент ({key})', { key: `${MOD}J` })}>
          <Icon name="sparkle" size={16} />
        </button>
      )}

      {/* Windows / Linux native-style window controls (macOS uses the dots above). */}
      {!isMac && (
        <div className="win-controls nodrag">
          <button className="wc" title={tr('Свернуть')} onClick={() => void window.api.minimizeWindow()}>
            <Icon name="winMin" size={14} />
          </button>
          <button className="wc" title={tr(maximized ? 'Свернуть в окно' : 'Развернуть')} onClick={() => void window.api.maximizeWindow()}>
            <Icon name={maximized ? 'restore' : 'winMax'} size={maximized ? 13 : 12} />
          </button>
          <button className="wc close" title={tr('Закрыть')} onClick={() => void window.api.closeWindow()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

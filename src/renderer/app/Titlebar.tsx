import { useMemo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { useEnvironments } from '@renderer/store/environments'
import { collectButtons, usePlugins } from '@renderer/store/plugins'
import { kbd, MOD } from '@renderer/lib/platform'
import { WorkspaceSwitcher } from '@renderer/features/workspaces/WorkspaceSwitcher'

export function Titlebar() {
  const setTheme = useSettings((s) => s.setTheme)
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const themeChoice = useSettings((s) => s.settings.theme)
  const aiOpen = useUi((s) => s.aiOpen)
  const paneCount = useUi((s) => s.panes.count)
  const environments = useEnvironments((s) => s.env.environments)
  const activeEnvId = useEnvironments((s) => s.env.activeEnvironmentId)
  const setActiveEnv = useEnvironments((s) => s.setActiveEnv)
  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const pluginList = usePlugins((s) => s.plugins)
  const pluginBusy = usePlugins((s) => s.busy)
  const titlebarButtons = useMemo(() => collectButtons(pluginList, 'titlebar'), [pluginList])

  const isMac = window.api.platform === 'darwin'

  return (
    <div className="titlebar drag-region">
      {isMac && (
        <div className="win-dots nodrag">
          <i title="Закрыть" onClick={() => void window.api.closeWindow()} />
          <i title="Свернуть" onClick={() => void window.api.minimizeWindow()} />
          <i title="Развернуть" onClick={() => void window.api.maximizeWindow()} />
        </div>
      )}
      <div className="brand" style={{ marginLeft: isMac ? 6 : 4 }}>
        <div className="brand-mark">
          <Icon name="bolt" size={13} style={{ color: '#fff' }} />
        </div>
        Relay
      </div>
      <WorkspaceSwitcher />
      <div className="grow" />
      <div className="global-search nodrag" data-tour="search" onClick={() => useUi.getState().setPaletteOpen(true)}>
        <Icon name="search" size={14} />
        <span className="ph">Поиск или команда…</span>
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
            {activeEnv ? activeEnv.name : 'Без окружения'}
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)' }} />
          </div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={6} style={{ position: 'relative', minWidth: 200 }}>
            <DropdownMenu.Item className={`pop-item ${activeEnvId === null ? 'on' : ''}`} onSelect={() => setActiveEnv(null)}>
              <Icon name="env" size={14} style={{ color: 'var(--tx-3)' }} />
              <span style={{ flex: 1 }}>Без окружения</span>
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
          <button className={`icon-btn nodrag ${paneCount > 1 ? 'on' : ''}`} title="Разбить экран">
            <Icon name="layoutGrid" size={15} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={6} style={{ position: 'relative', minWidth: 150 }}>
            {([1, 2, 3, 4] as const).map((n) => (
              <DropdownMenu.Item
                key={n}
                className={`pop-item ${paneCount === n ? 'on' : ''}`}
                onSelect={() => useUi.getState().setPaneCount(n)}
              >
                <span style={{ flex: 1 }}>
                  {n} {n === 1 ? 'панель' : 'панели'}
                </span>
                {paneCount === n && <Icon name="check" size={14} className="tick" />}
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
      <button className={`icon-btn nodrag ${aiOpen ? 'on' : ''}`} data-tour="ai" onClick={() => useUi.getState().toggleAi()} title={`AI-ассистент (${MOD}J)`}>
        <Icon name="sparkle" size={16} />
      </button>

      {/* Windows / Linux native-style window controls (macOS uses the dots above). */}
      {!isMac && (
        <div className="win-controls nodrag">
          <button className="wc" title="Свернуть" onClick={() => void window.api.minimizeWindow()}>
            <Icon name="winMin" size={14} />
          </button>
          <button className="wc" title="Развернуть" onClick={() => void window.api.maximizeWindow()}>
            <Icon name="winMax" size={12} />
          </button>
          <button className="wc close" title="Закрыть" onClick={() => void window.api.closeWindow()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

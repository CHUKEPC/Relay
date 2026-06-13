import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useUi, type SideTab } from '@renderer/store/ui'
import { useConsole } from '@renderer/store/console'
import { collectButtons, usePlugins } from '@renderer/store/plugins'
import { kbd } from '@renderer/lib/platform'
import { trackDrag } from '@renderer/lib/drag'
import { CollectionsTree } from './CollectionsTree'
import { HistoryList } from './HistoryList'
import { EnvList } from './EnvList'
import '@renderer/styles/feat-resize.css'

const NAV: { id: SideTab; label: string; icon: string }[] = [
  { id: 'collections', label: 'Коллекции', icon: 'collections' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'env', label: 'Среды', icon: 'env' }
]

export function Sidebar() {
  const sideTab = useUi((s) => s.sideTab)
  const setSideTab = useUi((s) => s.setSideTab)
  const openSettings = useUi((s) => s.openSettings)
  const sidebarWidth = useUi((s) => s.sidebarWidth)
  const setSidebarWidth = useUi((s) => s.setSidebarWidth)
  const [query, setQuery] = useState('')
  const asideRef = useRef<HTMLElement>(null)
  const pluginList = usePlugins((s) => s.plugins)
  const pluginBusy = usePlugins((s) => s.busy)
  const sidebarButtons = useMemo(() => collectButtons(pluginList, 'sidebar'), [pluginList])

  const onHandleDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const aside = asideRef.current
    if (!aside) return
    // Left edge is anchored; capture once so the math stays stable mid-drag.
    const left = aside.getBoundingClientRect().left
    const handle = e.currentTarget
    handle.classList.add('dragging')
    document.body.classList.add('wall-resizing')
    trackDrag((ev) => setSidebarWidth(ev.clientX - left), {
      onEnd: () => {
        handle.classList.remove('dragging')
        document.body.classList.remove('wall-resizing')
      }
    })
  }

  return (
    <aside className="sidebar" ref={asideRef} style={{ width: sidebarWidth }}>
      <div className="side-nav">
        <div className="seg" data-tour="nav">
          {NAV.map((t) => (
            <button
              key={t.id}
              className={sideTab === t.id ? 'on' : ''}
              onClick={() => {
                setSideTab(t.id)
                setQuery('') // don't carry one tab's search into another
              }}
              title={t.label}
            >
              <Icon name={t.icon} size={14} />
            </button>
          ))}
        </div>
      </div>

      {sideTab !== 'env' && (
        <div className="side-search">
          <Icon name="search" size={14} />
          <input
            placeholder={sideTab === 'collections' ? 'Поиск запросов…' : 'Поиск в истории…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {sideTab === 'collections' && <CollectionsTree query={query} />}
      {sideTab === 'history' && <HistoryList query={query} />}
      {sideTab === 'env' && <EnvList />}

      <div style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid var(--line)' }}>
        {sidebarButtons.map(({ pluginId, pluginName, button }) => {
          const busy = !!pluginBusy[`${pluginId}:${button.id}`]
          return (
            <button
              key={`${pluginId}:${button.id}`}
              className="tree-row"
              style={{ width: '100%' }}
              disabled={busy}
              title={button.tooltip ?? `${pluginName} — ${button.label}`}
              onClick={() => void usePlugins.getState().invokeButtonFromActiveTab(pluginId, button.id)}
            >
              <span className="twirl">
                <Icon name={busy ? 'refresh' : (button.icon ?? 'bolt')} size={15} className={busy ? 'spin' : undefined} />
              </span>
              <span className="name">{button.label}</span>
            </button>
          )
        })}
        <button className="tree-row" data-tour="console" style={{ width: '100%' }} onClick={() => useConsole.getState().toggle()} title="Консоль запросов">
          <span className="twirl">
            <Icon name="code2" size={15} />
          </span>
          <span className="name">Консоль</span>
        </button>
        <button className="tree-row" data-tour="settings" style={{ width: '100%' }} onClick={() => openSettings()}>
          <span className="twirl">
            <Icon name="settings" size={15} />
          </span>
          <span className="name">Настройки</span>
          <span className="kbd">{kbd(',')}</span>
        </button>
      </div>

      <div
        className="wall-handle right"
        aria-hidden="true"
        onMouseDown={onHandleDown}
        onDoubleClick={() => setSidebarWidth(270)}
        title="Перетащите, чтобы изменить ширину · двойной клик — сброс"
      />
    </aside>
  )
}

import { useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useUi, type SideTab } from '@renderer/store/ui'
import { useConsole } from '@renderer/store/console'
import { useRunner } from '@renderer/store/runner'
import { useFindReplace } from '@renderer/store/find-replace'
import { collectButtons, usePlugins } from '@renderer/store/plugins'
import { kbd } from '@renderer/lib/platform'
import { trackDrag } from '@renderer/lib/drag'
import { ALL_EDGES, DockButtons, FLOAT_MIN_H, FLOAT_MIN_W, PANEL_DOCK_MODES, useDockDrag } from '@renderer/lib/dock'
import { dockSidebar } from '@renderer/lib/dock-swap'
import { CollectionsTree } from './CollectionsTree'
import { HistoryList } from './HistoryList'
import { EnvList } from './EnvList'
import { tr } from '@renderer/lib/i18n'
import '@renderer/styles/feat-resize.css'

const NAV: { id: SideTab; label: string; icon: string }[] = [
  { id: 'collections', label: 'Коллекции', icon: 'collections' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'env', label: 'Среды', icon: 'env' }
]

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const sideTab = useUi((s) => s.sideTab)
  const setSideTab = useUi((s) => s.setSideTab)
  const openSettings = useUi((s) => s.openSettings)
  const sidebarWidth = useUi((s) => s.sidebarWidth)
  const setSidebarWidth = useUi((s) => s.setSidebarWidth)
  const sidebarHeight = useUi((s) => s.sidebarHeight)
  const setSidebarHeight = useUi((s) => s.setSidebarHeight)
  const dock = useUi((s) => s.sidebarDock)
  const float = useUi((s) => s.sidebarFloat)
  const setFloat = useUi((s) => s.setSidebarFloat)
  const [query, setQuery] = useState('')
  const asideRef = useRef<HTMLElement>(null)
  const pluginList = usePlugins((s) => s.plugins)
  const pluginBusy = usePlugins((s) => s.busy)
  const sidebarButtons = useMemo(() => collectButtons(pluginList, 'sidebar'), [pluginList])

  // Dragging the head re-docks the panel to an edge of the app body — the same
  // zones the response and the request zone use; a response panel already on
  // that edge trades places with it (lib/dock-swap).
  const { onGrabDown, overlay } = useDockDrag({
    container: () => document.querySelector('.body'),
    dock,
    onDock: dockSidebar,
    edges: ALL_EDGES,
    float,
    setFloat
  })

  /** Docked: drag the inner edge to resize. Left/right change the width, top/bottom the height. */
  const onHandleDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const aside = asideRef.current
    if (!aside) return
    const box = aside.getBoundingClientRect()
    const handle = e.currentTarget
    handle.classList.add('dragging')
    document.body.classList.add('wall-resizing')
    trackDrag(
      (ev) => {
        if (dock === 'left') setSidebarWidth(ev.clientX - box.left)
        else if (dock === 'right') setSidebarWidth(box.right - ev.clientX)
        else if (dock === 'top') setSidebarHeight(ev.clientY - box.top)
        else setSidebarHeight(box.bottom - ev.clientY)
      },
      {
        cursor: across ? 'row-resize' : 'col-resize',
        onEnd: () => {
          handle.classList.remove('dragging')
          document.body.classList.remove('wall-resizing')
        }
      }
    )
  }

  /** Floating: the bottom-right grip resizes the panel. */
  const onFloatGripDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY }
    const orig = useUi.getState().sidebarFloat
    trackDrag(
      (ev) => {
        setFloat({
          ...orig,
          w: Math.max(FLOAT_MIN_W, orig.w + ev.clientX - start.x),
          h: Math.max(FLOAT_MIN_H, orig.h + ev.clientY - start.y)
        })
      },
      { cursor: 'nwse-resize' }
    )
  }

  // Collapsed (Ctrl+B): the whole rail goes away and the workspace takes the
  // width — the state is kept, so re-opening restores the tab, the width and
  // the position.
  if (collapsed) return null

  const across = dock === 'bottom' || dock === 'top'

  const style: CSSProperties =
    dock === 'float'
      ? { left: float.x, top: float.y, width: float.w, height: float.h }
      : across
        ? { height: sidebarHeight }
        : { width: sidebarWidth }

  return (
    <>
      <aside className={`sidebar dock-${dock}`} ref={asideRef} style={style}>
        <div className="panel-dock-head dock-grip" onMouseDown={onGrabDown} title={tr('Перетащите, чтобы перенести панель')}>
          <Icon name="grip" size={13} style={{ color: 'var(--tx-3)' }} />
          <span className="panel-dock-title">{tr('Навигация')}</span>
          <DockButtons dock={dock} onDock={dockSidebar} modes={PANEL_DOCK_MODES} />
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title={tr('Скрыть панель')}
            aria-label={tr('Скрыть панель')}
            onClick={() => useUi.getState().setSidebarCollapsed(true)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="side-main">
        <div className="side-top">
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
                title={tr(t.label)}
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
              placeholder={sideTab === 'collections' ? tr('Поиск запросов…') : tr('Поиск в истории…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
        </div>

        <div className="side-content">
          {sideTab === 'collections' && <CollectionsTree query={query} />}
          {sideTab === 'history' && <HistoryList query={query} />}
          {sideTab === 'env' && <EnvList />}
        </div>

        <div className="side-foot" style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid var(--line)' }}>
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
          <button
            className="tree-row"
            data-tour="runner"
            style={{ width: '100%' }}
            onClick={() => useRunner.getState().openPicker()}
            title={tr('Запустить коллекцию, папку или набор запросов')}
          >
            <span className="twirl">
              <Icon name="play" size={15} />
            </span>
            <span className="name">{tr('Раннер')}</span>
            <span className="kbd">{kbd('Shift+R')}</span>
          </button>
          <button
            className="tree-row"
            data-tour="find"
            style={{ width: '100%' }}
            onClick={() => useFindReplace.getState().openDialog()}
            title={tr('Поиск и замена по всем коллекциям и переменным')}
          >
            <span className="twirl">
              <Icon name="search" size={15} />
            </span>
            <span className="name">{tr('Найти и заменить')}</span>
            <span className="kbd">{kbd('Shift+F')}</span>
          </button>
          <button className="tree-row" data-tour="console" style={{ width: '100%' }} onClick={() => useConsole.getState().toggle()} title={tr('Консоль запросов')}>
            <span className="twirl">
              <Icon name="code2" size={15} />
            </span>
            <span className="name">{tr('Консоль')}</span>
          </button>
          <button className="tree-row" data-tour="settings" style={{ width: '100%' }} onClick={() => openSettings()}>
            <span className="twirl">
              <Icon name="settings" size={15} />
            </span>
            <span className="name">{tr('Настройки')}</span>
            <span className="kbd">{kbd(',')}</span>
          </button>
        </div>
        </div>

        {dock !== 'float' && (
          <div
            className={`wall-handle ${dock === 'left' ? 'right' : dock === 'right' ? 'left' : dock === 'top' ? 'bottom' : 'top'}`}
            aria-hidden="true"
            onMouseDown={onHandleDown}
            onDoubleClick={() => (across ? setSidebarHeight(260) : setSidebarWidth(270))}
            title={tr('Перетащите, чтобы изменить размер · двойной клик — сброс')}
          />
        )}
        {dock === 'float' && <div className="float-grip" onMouseDown={onFloatGripDown} />}
      </aside>
      {overlay}
    </>
  )
}

import { lazy, Suspense, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Icon } from '@renderer/components/Icon'
import { RequestTag } from '@renderer/components/RequestTag'
import { useUi } from '@renderer/store/ui'
import { useTabs } from '@renderer/store/tabs'
import { useEnvironments } from '@renderer/store/environments'
import { useResponse } from '@renderer/store/response'
import { useAi } from '@renderer/store/ai'
import { useSettings } from '@renderer/store/settings'
import {
  freeTabs,
  leavesInReadingOrder,
  leavesOf,
  usePanes,
  type Direction,
  type DropZone,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit
} from '@renderer/store/panes'
import { currentScope, currentSecretValues } from '@renderer/lib/request-runner'
import { useCollections } from '@renderer/store/collections'
import { trackDrag } from '@renderer/lib/drag'
import { BuilderDockContext, FLOAT_MIN_H, FLOAT_MIN_W, oppositeEdge, PaneDockContext, useDockDrag, type DockEdge, type DockMode, type FloatRect } from '@renderer/lib/dock'
import { dockResponse } from '@renderer/lib/dock-swap'
import { dragId, dragKind, isPaneDrop, PANE_MIME, type DragKind } from '@renderer/lib/dnd'
import { buildContextSnapshot } from '@renderer/lib/ai-context'
import { kbdCombo } from '@renderer/lib/keymap'
import { interpolate } from '@shared/interpolate'
import { RequestBuilder } from '@renderer/features/request/RequestBuilder'
import { ResponsePanel } from '@renderer/features/response/ResponsePanel'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-panes.css'

// Protocol panels ship as feature packs: load their chunks only when a tab is
// actually in that mode, so an HTTP-only session never downloads them.
const RealtimePanel = lazy(() => import('@renderer/features/realtime/RealtimePanel').then((m) => ({ default: m.RealtimePanel })))
const GrpcResponse = lazy(() => import('@renderer/features/grpc/GrpcResponse').then((m) => ({ default: m.GrpcResponse })))

/**
 * Turn whatever was dropped into a tab id, opening the request if needed.
 * Returns null when the payload no longer resolves (e.g. the request was
 * deleted mid-drag).
 */
function tabIdFromDrop(kind: DragKind, id: string): string | null {
  if (!id) return null
  if (kind === 'tab') return useTabs.getState().doc.tabs.some((t) => t.id === id) ? id : null
  const found = useCollections.getState().locate(id)
  if (!found || found.node.type !== 'request') return null
  return useTabs.getState().openSaved(found.node.request, found.node.id)
}

/** Builder + draggable divider + response for one pane; sizes are per pane. */
export function PaneView({ leaf }: { leaf: PaneLeaf }) {
  const setRespPct = usePanes((s) => s.setRespPct)
  const toggleLeafLayout = usePanes((s) => s.toggleLeafLayout)
  const setRespFloat = usePanes((s) => s.setRespFloat)
  const tabId = leaf.tabId
  const mode = useTabs((s) => s.doc.tabs.find((t) => t.id === tabId)?.request.mode ?? 'http')
  const wsRef = useRef<HTMLDivElement>(null)
  const dock = leaf.respDock
  const horizontal = dock === 'right' || dock === 'left'

  const setDock = (d: DockMode): void => dockResponse(leaf.id, d)

  // The response panel is dragged by its status bar to an edge of this pane.
  const { onGrabDown, overlay } = useDockDrag({
    container: () => wsRef.current,
    dock,
    onDock: setDock,
    edges: PANE_EDGES,
    float: leaf.respFloat,
    setFloat: (rect) => setRespFloat(leaf.id, rect),
    coords: 'container'
  })

  // The request zone is dragged by the grip in its header; the response takes
  // the opposite side. With a floating response the builder owns the pane, so
  // there is nothing to move.
  const builderEdge: DockMode = dock === 'float' ? 'float' : oppositeEdge(dock)
  const builderDrag = useDockDrag({
    container: () => wsRef.current,
    dock: builderEdge,
    onDock: (edge) => setDock(oppositeEdge(edge)),
    edges: PANE_EDGES,
    float: leaf.respFloat,
    setFloat: () => undefined,
    coords: 'container'
  })

  if (!tabId) return <EmptyPane paneId={leaf.id} />

  const onDividerDown = () => {
    trackDrag(
      (ev) => {
        if (!wsRef.current) return
        const r = wsRef.current.getBoundingClientRect()
        const along = horizontal ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height
        // Docked left or top, the response grows as the divider moves away from it.
        setRespPct(leaf.id, (dock === 'left' || dock === 'top' ? along : 1 - along) * 100)
      },
      { cursor: horizontal ? 'col-resize' : 'row-resize' }
    )
  }

  /** Pressing the response header (and only it) starts a re-dock drag. */
  const grabFromHead = (e: ReactMouseEvent): void => {
    // The status bar is the response panel's header in every protocol mode.
    if ((e.target as HTMLElement).closest('.resp-statusbar')) onGrabDown(e)
  }

  const response = (
    <PaneDockContext.Provider value={{ dock, setDock, onGrabDown }}>
      {mode === 'websocket' || mode === 'sse' || mode === 'socketio' || mode === 'mqtt' ? (
        <Suspense fallback={null}>
          <RealtimePanel key={tabId} tabId={tabId} kind={mode} />
        </Suspense>
      ) : mode === 'grpc' ? (
        <Suspense fallback={null}>
          <GrpcResponse key={tabId} tabId={tabId} />
        </Suspense>
      ) : (
        <ResponsePanel key={tabId} tabId={tabId} onAskAI={() => askAiAboutResponse(tabId)} />
      )}
    </PaneDockContext.Provider>
  )

  const requestBuilder = (
    <BuilderDockContext.Provider value={dock === 'float' ? null : builderDrag.onGrabDown}>
      <RequestBuilder tabId={tabId} />
    </BuilderDockContext.Provider>
  )

  // Floating: the builder owns the whole pane and the response rides above it.
  if (dock === 'float') {
    return (
      <div className="workspace" ref={wsRef} style={{ position: 'relative' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>{requestBuilder}</div>
        <div
          className="resp-float"
          style={{ left: leaf.respFloat.x, top: leaf.respFloat.y, width: leaf.respFloat.w, height: leaf.respFloat.h }}
          onMouseDownCapture={grabFromHead}
        >
          {response}
          <div className="float-grip" onMouseDown={(e) => onFloatGrip(e, leaf, setRespFloat)} />
        </div>
      </div>
    )
  }

  const builder = (
    <div
      key="builder"
      className="pane-builder"
      style={
        horizontal
          ? { width: `${100 - leaf.respPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }
          : { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }
      }
    >
      {requestBuilder}
    </div>
  )

  const divider = (
    <div
      key="divider"
      className={`divider${horizontal ? ' vertical' : ''}`}
      style={horizontal ? { width: 8, height: 'auto', cursor: 'col-resize' } : undefined}
      onMouseDown={onDividerDown}
      onDoubleClick={() => toggleLeafLayout(leaf.id)}
      title={tr('Перетащите, чтобы изменить размер · двойной клик меняет ориентацию')}
    >
      <div className="grip" />
    </div>
  )

  const responseBox = (
    <div
      key="response"
      className="pane-response"
      onMouseDownCapture={grabFromHead}
      style={
        horizontal
          ? { width: `${leaf.respPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }
          : { height: `${leaf.respPct}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }
      }
    >
      {response}
    </div>
  )

  const responseFirst = dock === 'left' || dock === 'top'
  return (
    <div className={`workspace resp-dock-${dock}`} ref={wsRef} style={horizontal ? { flexDirection: 'row' } : undefined}>
      {responseFirst ? [responseBox, divider, builder] : [builder, divider, responseBox]}
      {overlay}
      {builderDrag.overlay}
    </div>
  )
}

/** Both the response and the request zone may take any edge of their pane. */
const PANE_EDGES: readonly DockEdge[] = ['left', 'right', 'top', 'bottom']

/** Resize a floating response panel from its bottom-right grip. */
function onFloatGrip(e: ReactMouseEvent, leaf: PaneLeaf, setRespFloat: (paneId: string, rect: FloatRect) => void): void {
  e.preventDefault()
  e.stopPropagation()
  const start = { x: e.clientX, y: e.clientY }
  const orig = leaf.respFloat
  trackDrag(
    (ev) => {
      setRespFloat(leaf.id, {
        ...orig,
        w: Math.max(FLOAT_MIN_W, orig.w + ev.clientX - start.x),
        h: Math.max(FLOAT_MIN_H, orig.h + ev.clientY - start.y)
      })
    },
    { cursor: 'nwse-resize' }
  )
}

function EmptyPane({ paneId }: { paneId: string }) {
  useTabs((s) => s.doc.tabs.length)
  const hasFree = usePanes((s) => freeTabs(s, paneId).length > 0)
  return (
    <div className="pane-blank">
      <div className="pane-blank-title">{tr('Пустая панель')}</div>
      <div className="pane-blank-sub">
        {hasFree ? tr('Выберите вкладку в заголовке панели или создайте новый запрос.') : tr('Создайте новый запрос.')}
      </div>
      <button
        className="btn"
        onClick={() => {
          usePanes.getState().focusPane(paneId)
          useTabs.getState().openNew()
        }}
      >
        <Icon name="plus" size={14} /> {tr('Новый запрос')} </button>
    </div>
  )
}

/** Tab picker: a tab can be shown by only one pane (or one separate window). */
function PaneTabPicker({ leaf }: { leaf: PaneLeaf }) {
  const tabs = useTabs((s) => s.doc.tabs)
  const root = usePanes((s) => s.root)
  const detached = usePanes((s) => s.detached)
  const current = tabs.find((t) => t.id === leaf.tabId) ?? null
  const paneNumber = new Map(leavesInReadingOrder(root).map((l, i) => [l.tabId, i + 1]))

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="pane-tab-pick" title={tr('Какой запрос показывать в этой панели')}>
          {current ? (
            <>
              <RequestTag request={current.request} />
              <span className="label">{tr(current.request.name || 'Без названия')}</span>
              {current.dirty && <span className="pane-dirty" title={tr('Несохранённые изменения')} />}
            </>
          ) : (
            <span className="ph">{tr('Выберите вкладку…')}</span>
          )}
          <Icon name="chevDsm" size={12} style={{ color: 'var(--tx-3)', flex: 'none' }} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="popover" align="start" sideOffset={4} style={{ position: 'relative', minWidth: 260 }}>
          {tabs.map((t) => {
            const inOther = t.id !== leaf.tabId && paneNumber.has(t.id)
            const inWindow = detached.includes(t.id)
            const busy = inOther || inWindow
            return (
              <DropdownMenu.Item
                key={t.id}
                className={`pop-item ${leaf.tabId === t.id ? 'on' : ''}`}
                disabled={busy}
                onSelect={() => usePanes.getState().setLeafTab(leaf.id, t.id)}
              >
                <RequestTag request={t.request} />
                <span className="pane-pick-name">{tr(t.request.name || 'Без названия')}</span>
                {inOther && <span className="pane-pick-note">{trf('панель {n}', { n: paneNumber.get(t.id) ?? '' })}</span>}
                {inWindow && <span className="pane-pick-note">{tr('в окне')}</span>}
                {leaf.tabId === t.id && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            )
          })}
          {tabs.length > 0 && <DropdownMenu.Separator className="pop-sep" />}
          <DropdownMenu.Item
            className="pop-item"
            onSelect={() => {
              usePanes.getState().focusPane(leaf.id)
              useTabs.getState().openNew()
            }}
          >
            <Icon name="plus" size={14} />
            <span className="pane-pick-name">{tr('Новый запрос в этой панели')}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function PaneHeader({ leaf, index, active, maximized }: { leaf: PaneLeaf; index: number; active: boolean; maximized: boolean }) {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const panes = usePanes.getState
  return (
    <div
      className="pane-head"
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData(PANE_MIME, leaf.id)
        e.dataTransfer.effectAllowed = 'move'
        document.body.classList.add('pane-dragging')
      }}
      onDragEnd={() => document.body.classList.remove('pane-dragging')}
      title={tr('Перетащите заголовок на другую панель, чтобы переместить или поменять местами')}
    >
      <span className="pane-grip">
        <Icon name="grip" size={14} strokeWidth={2.6} />
      </span>
      <span className={`pane-num${active ? ' on' : ''}`}>{index + 1}</span>
      <PaneTabPicker leaf={leaf} />
      <div className="grow" />
      <button
        className="icon-btn pane-act"
        title={`${maximized ? tr('Вернуть раскладку') : tr('Развернуть панель')} (${kbdCombo('paneMaximize', keybindings)})`}
        onClick={() => panes().toggleMaximize(leaf.id)}
      >
        <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
      </button>
      {leaf.tabId && (
        <button
          className="icon-btn pane-act"
          title={trf('Открыть в отдельном окне ({key})', { key: kbdCombo('paneDetach', keybindings) })}
          onClick={() => void panes().detachTab(leaf.tabId!)}
        >
          <Icon name="floatWin" size={13} />
        </button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="icon-btn pane-act" title={tr('Действия с панелью')}>
            <Icon name="dots" size={13} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="end" sideOffset={4} style={{ position: 'relative', minWidth: 250 }}>
            <PaneMenuItem icon="splitRight" label={tr('Добавить панель справа')} combo={kbdCombo('paneSplitRight', keybindings)} onSelect={() => { panes().focusPane(leaf.id); panes().splitActive('row') }} />
            <PaneMenuItem icon="splitDown" label={tr('Добавить панель снизу')} combo={kbdCombo('paneSplitDown', keybindings)} onSelect={() => { panes().focusPane(leaf.id); panes().splitActive('col') }} />
            <PaneMenuItem icon="swap" label={tr('Поменять местами с соседней группой')} combo={kbdCombo('paneFlip', keybindings)} onSelect={() => { panes().focusPane(leaf.id); panes().flipActiveGroup() }} />
            <DropdownMenu.Separator className="pop-sep" />
            <PaneMenuItem icon="close" label={tr('Закрыть панель')} combo={kbdCombo('paneClose', keybindings)} onSelect={() => panes().closePane(leaf.id)} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <button className="icon-btn pane-act" title={trf('Закрыть панель ({key})', { key: kbdCombo('paneClose', keybindings) })} onClick={() => panes().closePane(leaf.id)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

function PaneMenuItem({ icon, label, combo, onSelect }: { icon: string; label: string; combo: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item className="pop-item" onSelect={onSelect}>
      <Icon name={icon} size={14} />
      <span style={{ flex: 1 }}>{label}</span>
      {combo && <span className="pane-menu-kbd">{combo}</span>}
    </DropdownMenu.Item>
  )
}

function zoneFor(e: DragEvent, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  if (x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7) return 'center'
  const d = { left: x, right: 1 - x, up: y, down: 1 - y }
  return (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[a] <= d[b] ? a : b))
}

function PaneBox({ leaf, index, showHeader }: { leaf: PaneLeaf; index: number; showHeader: boolean }) {
  const active = usePanes((s) => s.activeId === leaf.id)
  const maximized = usePanes((s) => s.maximizedId === leaf.id)
  const [zone, setZone] = useState<DropZone | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const focus = () => {
    if (usePanes.getState().activeId !== leaf.id) usePanes.getState().focusPane(leaf.id)
  }

  return (
    <div
      ref={boxRef}
      className={`pane${active && showHeader ? ' active' : ''}`}
      data-pane-id={leaf.id}
      onMouseDownCapture={focus}
      onFocusCapture={focus}
      onDragOver={(e) => {
        if (!isPaneDrop(e.dataTransfer) || !boxRef.current) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const z = zoneFor(e, boxRef.current)
        if (z !== zone) setZone(z)
      }}
      onDragLeave={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setZone(null)
      }}
      onDrop={(e) => {
        const kind = dragKind(e.dataTransfer)
        const z = zone
        setZone(null)
        document.body.classList.remove('pane-dragging')
        if (!kind || !z || !boxRef.current) return
        e.preventDefault()
        e.stopPropagation()
        const id = dragId(e.dataTransfer, kind)
        if (!id) return
        if (kind === 'pane') {
          usePanes.getState().movePaneTo(id, leaf.id, z)
          return
        }
        const tabId = tabIdFromDrop(kind, id)
        if (tabId) usePanes.getState().dropTabInto(tabId, leaf.id, z)
      }}
    >
      {showHeader && <PaneHeader leaf={leaf} index={index} active={active} maximized={maximized} />}
      <PaneView leaf={leaf} />
      {zone && <div className={`pane-drop pane-drop-${zone}`} />}
    </div>
  )
}

function SplitView({ node, indexOf }: { node: PaneSplit; indexOf: Map<string, number> }) {
  const setRatio = usePanes((s) => s.setRatio)
  const ref = useRef<HTMLDivElement>(null)
  const row = node.dir === 'row'

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    trackDrag(
      (ev) => {
        const r = ref.current?.getBoundingClientRect()
        if (!r) return
        setRatio(node.id, row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height)
      },
      { cursor: row ? 'col-resize' : 'row-resize' }
    )
  }

  return (
    <div ref={ref} className={`pane-split ${node.dir}`}>
      <div className="pane-slot" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <Tree node={node.a} indexOf={indexOf} />
      </div>
      <div
        className={`pane-divider ${node.dir}`}
        onMouseDown={onDown}
        onDoubleClick={() => setRatio(node.id, 0.5)}
        title={tr('Перетащите, чтобы изменить размер · двойной клик — поровну')}
      />
      <div className="pane-slot" style={{ flexBasis: `${(1 - node.ratio) * 100}%` }}>
        <Tree node={node.b} indexOf={indexOf} />
      </div>
    </div>
  )
}

function Tree({ node, indexOf }: { node: PaneNode; indexOf: Map<string, number> }) {
  if (node.kind === 'leaf') return <PaneBox leaf={node} index={indexOf.get(node.id) ?? 0} showHeader />
  return <SplitView node={node} indexOf={indexOf} />
}

const EDGES: Direction[] = ['left', 'right', 'up', 'down']

/**
 * Outer drop strips along the four sides of the grid, VS Code style: dropping a
 * tab or a saved request here splits the *whole* layout, not just the pane
 * underneath. Only rendered while a drop is in flight so they never eat clicks.
 */
function EdgeDropZones() {
  const [over, setOver] = useState<Direction | null>(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const on = (e: globalThis.DragEvent) => setArmed(!!e.dataTransfer && isPaneDrop(e.dataTransfer))
    const off = () => {
      setArmed(false)
      setOver(null)
    }
    // dragenter/leave on window is noisy; dragover keeps the flag alive and
    // dragend/drop clears it exactly once.
    window.addEventListener('dragover', on)
    window.addEventListener('dragend', off)
    window.addEventListener('drop', off)
    return () => {
      window.removeEventListener('dragover', on)
      window.removeEventListener('dragend', off)
      window.removeEventListener('drop', off)
    }
  }, [])

  if (!armed) return null

  return (
    <>
      {EDGES.map((side) => (
        <div
          key={side}
          className={`pane-edge pane-edge-${side}${over === side ? ' on' : ''}`}
          onDragOver={(e) => {
            if (!isPaneDrop(e.dataTransfer)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            if (over !== side) setOver(side)
          }}
          onDragLeave={() => setOver((cur) => (cur === side ? null : cur))}
          onDrop={(e) => {
            const kind = dragKind(e.dataTransfer)
            setOver(null)
            setArmed(false)
            document.body.classList.remove('pane-dragging')
            if (!kind) return
            e.preventDefault()
            e.stopPropagation()
            const id = dragId(e.dataTransfer, kind)
            if (!id) return
            if (kind === 'pane') {
              const target = leavesOf(usePanes.getState().root).find((l) => l.id !== id)
              if (target) usePanes.getState().movePaneTo(id, target.id, side)
              return
            }
            const tabId = tabIdFromDrop(kind, id)
            if (tabId) usePanes.getState().dropTabAtEdge(tabId, side)
          }}
        />
      ))}
    </>
  )
}

export function Workspace() {
  const root = usePanes((s) => s.root)
  const maximizedId = usePanes((s) => s.maximizedId)
  const leaves = leavesOf(root)
  // Numbers follow the layout, not the tree walk (see leavesInReadingOrder).
  const indexOf = new Map(leavesInReadingOrder(root).map((l, i) => [l.id, i]))
  const maximized = maximizedId ? leaves.find((l) => l.id === maximizedId) : null

  return (
    <div className="main">
      <div className="panes">
        {/* A single pane keeps the classic header-less layout. */}
        {root.kind === 'leaf' ? (
          <PaneBox leaf={root} index={0} showHeader={false} />
        ) : maximized ? (
          <PaneBox leaf={maximized} index={indexOf.get(maximized.id) ?? 0} showHeader />
        ) : (
          <Tree node={root} indexOf={indexOf} />
        )}
        <EdgeDropZones />
      </div>
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
  void useAi.getState().send(tr('Объясни этот ответ: статус, структуру полей и есть ли проблемы.'), snapshot, label)
}

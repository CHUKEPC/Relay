import { createContext, useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@renderer/components/Icon'
import { clamp } from '@renderer/lib/math'
import { trackDrag } from '@renderer/lib/drag'
import { tr } from '@renderer/lib/i18n'
import '@renderer/styles/feat-dock.css'

/**
 * Where a dockable panel sits. The sidebar, the response panel and the request
 * console share this model; each one allows a subset (the sidebar has no top).
 */
export type DockEdge = 'left' | 'right' | 'bottom' | 'top'
export type DockMode = DockEdge | 'float'

export interface FloatRect {
  x: number
  y: number
  w: number
  h: number
}

const DOCK_META: Record<DockMode, { icon: string; title: string }> = {
  top: { icon: 'dockTop', title: 'Закрепить сверху' }, // titles go through tr() at render
  left: { icon: 'dockLeft', title: 'Закрепить слева' },
  bottom: { icon: 'dockBottom', title: 'Закрепить снизу' },
  right: { icon: 'dockRight', title: 'Закрепить справа' },
  float: { icon: 'floatWin', title: 'Плавающая панель' }
}

/** Keep at least this much of a floating panel reachable with the mouse. */
export const FLOAT_HEAD_H = 38
export const FLOAT_MIN_W = 300
export const FLOAT_MIN_H = 200

/** How far into the container an edge zone reaches. */
const EDGE_RATIO = 0.25
const EDGE_MAX_PX = 240

function bands(rect: DOMRect): { x: number; y: number } {
  return { x: Math.min(rect.width * EDGE_RATIO, EDGE_MAX_PX), y: Math.min(rect.height * EDGE_RATIO, EDGE_MAX_PX) }
}

/**
 * The edge a pointer inside `rect` points at, among the allowed ones — or null
 * in the middle and outside. There is deliberately no "float" zone: dropping in
 * the middle cancels the move, and floating is a button.
 */
export function zoneAt(rect: DOMRect, x: number, y: number, edges: readonly DockEdge[] = ['left', 'right', 'bottom']): DockEdge | null {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null
  const b = bands(rect)
  // Distance into each allowed band; the shallowest wins, so a corner resolves
  // to the edge the pointer is closest to.
  const dist: [DockEdge, number][] = []
  if (edges.includes('left') && x - rect.left < b.x) dist.push(['left', x - rect.left])
  if (edges.includes('right') && rect.right - x < b.x) dist.push(['right', rect.right - x])
  if (edges.includes('bottom') && rect.bottom - y < b.y) dist.push(['bottom', rect.bottom - y])
  if (edges.includes('top') && y - rect.top < b.y) dist.push(['top', y - rect.top])
  if (!dist.length) return null
  dist.sort((p, q) => p[1] - q[1])
  return dist[0][0]
}

/** The landing areas shown while a panel is being dragged — one per allowed edge. */
function DockZones({ rect, edges, active }: { rect: DOMRect; edges: readonly DockEdge[]; active: DockEdge | null }): JSX.Element {
  const b = bands(rect)
  const style: Record<DockEdge, React.CSSProperties> = {
    left: { left: 0, top: 0, width: b.x, height: rect.height },
    right: { right: 0, top: 0, width: b.x, height: rect.height },
    bottom: { left: 0, bottom: 0, width: rect.width, height: b.y },
    top: { left: 0, top: 0, width: rect.width, height: b.y }
  }
  return createPortal(
    <div className="dock-zones" style={{ position: 'fixed', pointerEvents: 'none', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      {edges.map((e) => (
        <div key={e} className={`dock-zone${active === e ? ' on' : ''}`} style={style[e]} />
      ))}
    </div>,
    document.body
  )
}

interface DockDragOptions {
  /** The area the panel may dock into (the app body, or one pane). */
  container: () => HTMLElement | null
  dock: DockMode
  /** Called with the edge the panel was dropped on (never with 'float'). */
  onDock: (edge: DockEdge) => void
  /** Edges this panel may take. */
  edges: readonly DockEdge[]
  float: FloatRect
  setFloat: (rect: FloatRect) => void
  /**
   * What the float rect is measured from: the window (a panel positioned
   * `fixed`, like the sidebar) or the container (a panel positioned `absolute`
   * inside it, like the response inside its pane).
   */
  coords?: 'viewport' | 'container'
}

/**
 * Drag a panel by its header.
 *
 * - Docked: the allowed edges of the container light up; releasing over one
 *   docks the panel there, releasing anywhere else changes nothing.
 * - Floating: the panel simply moves with the cursor, like a window. It is
 *   docked again with the buttons in its header, so moving it around never
 *   snaps it somewhere by accident.
 *
 * Nothing happens until the pointer has actually moved, so a plain click on the
 * header (or on a button inside it) still does what it always did.
 */
export function useDockDrag({ container, dock, onDock, edges, float, setFloat, coords = 'viewport' }: DockDragOptions): {
  onGrabDown: (e: ReactMouseEvent) => void
  dragging: boolean
  overlay: JSX.Element | null
} {
  const [zone, setZone] = useState<DockEdge | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  const onGrabDown = (e: ReactMouseEvent): void => {
    // Controls inside the header keep their own clicks.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable="true"]')) return
    if (e.button !== 0) return
    const host = container()
    if (!host) return
    e.preventDefault()

    const box = host.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const orig = float
    let moved = false
    let target: DockEdge | null = null

    cleanupRef.current?.()
    cleanupRef.current = trackDrag(
      (ev) => {
        if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 5) return
        moved = true
        if (dock === 'float') {
          const areaW = coords === 'container' ? box.width : window.innerWidth
          const areaH = coords === 'container' ? box.height : window.innerHeight
          const x = clamp(orig.x + ev.clientX - start.x, 120 - orig.w, areaW - 120)
          const y = clamp(orig.y + ev.clientY - start.y, 0, areaH - FLOAT_HEAD_H)
          setFloat({ ...orig, x, y })
          return
        }
        setRect(box)
        target = zoneAt(box, ev.clientX, ev.clientY, edges)
        setZone(target)
      },
      {
        cursor: 'grabbing',
        onEnd: () => {
          cleanupRef.current = null
          setZone(null)
          setRect(null)
          if (moved && dock !== 'float' && target && target !== dock) onDock(target)
        }
      }
    )
  }

  const showing = rect !== null && dock !== 'float'
  return {
    onGrabDown,
    dragging: showing,
    overlay: showing && rect ? <DockZones rect={rect} edges={edges} active={zone} /> : null
  }
}

/** The position buttons a dockable panel header carries. */
export function DockButtons({
  dock,
  onDock,
  modes = ['left', 'bottom', 'right', 'float'],
  className = ''
}: {
  dock: DockMode
  onDock: (mode: DockMode) => void
  modes?: readonly DockMode[]
  className?: string
}): JSX.Element {
  return (
    <div className={`dock-btn-group ${className}`.trim()}>
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          className={`icon-btn dock-btn${dock === m ? ' on' : ''}`}
          onClick={() => onDock(m)}
          title={tr(DOCK_META[m].title)}
          aria-label={tr(DOCK_META[m].title)}
          aria-pressed={dock === m}
        >
          <Icon name={DOCK_META[m].icon} size={13} />
        </button>
      ))}
    </div>
  )
}

/** The edge across the pane from `edge`. */
export function oppositeEdge(edge: DockEdge): DockEdge {
  return edge === 'left' ? 'right' : edge === 'right' ? 'left' : edge === 'top' ? 'bottom' : 'top'
}

/* ============================================================
 * Pane-level dock controls
 * ============================================================ */

interface PaneDockValue {
  dock: DockMode
  setDock: (mode: DockMode) => void
  onGrabDown: (e: ReactMouseEvent) => void
}

/** Positions the response panel offers, in button order. */
export const RESPONSE_DOCK_MODES: readonly DockMode[] = ['top', 'bottom', 'left', 'right', 'float']

/**
 * Provided by a pane around its response panel, so the panel's own status bar
 * can carry the grip and the position buttons without every panel type having
 * to take them as props.
 */
export const PaneDockContext = createContext<PaneDockValue | null>(null)

/** Grip + position buttons for the response panel; nothing outside a pane. */
export function PaneDockControls(): JSX.Element | null {
  const ctx = useContext(PaneDockContext)
  if (!ctx) return null
  return (
    <div className="resp-dock-ctl">
      <div
        className="dock-grip resp-dock-grab"
        onMouseDown={ctx.onGrabDown}
        title={tr('Перетащите к краю панели, чтобы перенести ответ')}
        aria-label={tr('Перетащите к краю панели, чтобы перенести ответ')}
        role="separator"
      >
        <Icon name="grip" size={12} />
      </div>
      <DockButtons dock={ctx.dock} onDock={ctx.setDock} modes={RESPONSE_DOCK_MODES} />
    </div>
  )
}

/**
 * Provided by a pane around its request builder: the grip in the request header
 * drags the request zone to an edge of the pane (the response takes the
 * opposite side).
 */
export const BuilderDockContext = createContext<((e: ReactMouseEvent) => void) | null>(null)

/** The grip at the start of the request header; nothing outside a pane. */
export function BuilderDockGrip(): JSX.Element | null {
  const onGrabDown = useContext(BuilderDockContext)
  if (!onGrabDown) return null
  return (
    <div
      className="dock-grip builder-dock-grab"
      onMouseDown={onGrabDown}
      title={tr('Перетащите к краю панели, чтобы перенести запрос')}
      aria-label={tr('Перетащите к краю панели, чтобы перенести запрос')}
      role="separator"
    >
      <Icon name="grip" size={12} />
    </div>
  )
}

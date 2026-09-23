/**
 * Moving the sidebar and the response panel against each other.
 *
 * Both can sit on the left, right or bottom edge. When one is moved to the edge
 * the other already occupies, they trade places instead of stacking — the
 * sidebar takes the response's edge and the response takes the one the sidebar
 * left. "Occupies" is measured against the window: a response docked right
 * only counts when its pane touches the right edge of the pane area.
 */
import { layoutRects, leavesOf, usePanes, type Rect } from '@renderer/store/panes'
import { useUi, type SideDock } from '@renderer/store/ui'
import type { DockEdge, DockMode } from './dock'

const EPS = 0.001

/** Whether a pane rect (fractions of the pane area) lies against an outer edge. */
export function touchesEdge(rect: Rect | undefined, edge: DockEdge): boolean {
  if (!rect) return false
  switch (edge) {
    case 'left':
      return rect.x < EPS
    case 'right':
      return rect.x + rect.w > 1 - EPS
    case 'top':
      return rect.y < EPS
    case 'bottom':
      return rect.y + rect.h > 1 - EPS
  }
}

const isSideEdge = (d: DockMode): d is 'left' | 'right' | 'bottom' => d === 'left' || d === 'right' || d === 'bottom'

/** Dock the sidebar; a response panel already on that edge moves to where the sidebar was. */
export function dockSidebar(next: SideDock): void {
  const ui = useUi.getState()
  const prev = ui.sidebarDock
  if (prev === next) return
  ui.setSidebarDock(next)
  if (!isSideEdge(next) || !isSideEdge(prev)) return
  const panes = usePanes.getState()
  const rects = layoutRects(panes.root)
  for (const leaf of leavesOf(panes.root)) {
    if (leaf.respDock === next && touchesEdge(rects.get(leaf.id), next)) panes.setRespDock(leaf.id, prev)
  }
}

/** Dock a pane's response; the sidebar on that window edge moves to where the response was. */
export function dockResponse(paneId: string, next: DockMode): void {
  const panes = usePanes.getState()
  const leaf = leavesOf(panes.root).find((l) => l.id === paneId)
  if (!leaf) return
  const prev = leaf.respDock
  if (prev === next) return
  panes.setRespDock(paneId, next)
  const ui = useUi.getState()
  if (ui.sidebarCollapsed || ui.sidebarDock !== next || !isSideEdge(next) || !isSideEdge(prev)) return
  if (!touchesEdge(layoutRects(usePanes.getState().root).get(paneId), next)) return
  ui.setSidebarDock(prev)
}

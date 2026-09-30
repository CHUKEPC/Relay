/**
 * Moving the sidebar and the response panel against each other.
 *
 * Both can sit on any edge. When one is moved to the edge the other already
 * occupies, they trade places instead of stacking — the sidebar takes the
 * response's edge and the response takes the one the sidebar left.
 *
 * Only while the main window shows a single pane: that pane is the whole work
 * area, so its response and the sidebar really compete for the same window
 * edge. With several panes a response moves inside its own pane and the
 * sidebar, which belongs to the whole window, stays put — trading used to throw
 * it to the far side of the window when a response was moved next to it.
 */
import { leavesOf, usePanes, type PaneLeaf } from '@renderer/store/panes'
import { useUi, type SideDock } from '@renderer/store/ui'
import type { DockEdge, DockMode } from './dock'

const isEdge = (d: DockMode): d is DockEdge => d !== 'float'

/** The one pane of the main window, or null when there are several (or in a pane window). */
function onlyPane(): PaneLeaf | null {
  const { root, windowMode } = usePanes.getState()
  return windowMode === 'main' && root.kind === 'leaf' ? root : null
}

/** Dock the sidebar; a response already on that edge moves to where the sidebar was. */
export function dockSidebar(next: SideDock): void {
  const ui = useUi.getState()
  const prev = ui.sidebarDock
  if (prev === next) return
  ui.setSidebarDock(next)
  const leaf = onlyPane()
  if (leaf && isEdge(next) && isEdge(prev) && leaf.respDock === next) usePanes.getState().setRespDock(leaf.id, prev)
}

/** Dock a pane's response; the sidebar on that edge moves to where the response was. */
export function dockResponse(paneId: string, next: DockMode): void {
  const panes = usePanes.getState()
  const leaf = leavesOf(panes.root).find((l) => l.id === paneId)
  if (!leaf) return
  const prev = leaf.respDock
  if (prev === next) return
  panes.setRespDock(paneId, next)
  const ui = useUi.getState()
  if (ui.sidebarCollapsed || ui.sidebarDock !== next || !isEdge(next) || !isEdge(prev)) return
  if (onlyPane()?.id !== paneId) return
  ui.setSidebarDock(prev)
}

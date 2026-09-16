import type { KeyActionId } from './keymap'
import { leavesOf, usePanes, type PanePreset } from '@renderer/store/panes'

/** Pixels a detached pane window moves/grows per key press. */
const WINDOW_STEP = 40

/**
 * Run a pane keyboard action. In the main window it edits the split layout; in
 * a detached pane window "move" moves the OS window and "resize" resizes it.
 * Returns true when the action is a pane action (handled or not applicable).
 */
export function runPaneAction(id: KeyActionId): boolean {
  if (!id.startsWith('pane')) return false
  const p = usePanes.getState()

  if (p.windowMode === 'detached') {
    const s = WINDOW_STEP
    const deltas: Partial<Record<KeyActionId, [number, number, number, number]>> = {
      paneMoveLeft: [-s, 0, 0, 0],
      paneMoveRight: [s, 0, 0, 0],
      paneMoveUp: [0, -s, 0, 0],
      paneMoveDown: [0, s, 0, 0],
      paneResizeLeft: [0, 0, -s, 0],
      paneResizeRight: [0, 0, s, 0],
      paneResizeUp: [0, 0, 0, -s],
      paneResizeDown: [0, 0, 0, s]
    }
    const d = deltas[id]
    if (d) void window.api.windowNudge(...d)
    else if (id === 'paneMaximize') void window.api.maximizeWindow()
    else if ((id === 'paneDetach' || id === 'paneClose') && p.root.kind === 'leaf' && p.root.tabId) void window.api.paneAttach(p.root.tabId)
    return true
  }

  const preset = /^panePreset(\d)$/.exec(id)
  if (preset) {
    p.applyPreset(Number(preset[1]) as PanePreset)
    return true
  }
  switch (id) {
    case 'paneSplitRight':
      p.splitActive('row')
      break
    case 'paneSplitDown':
      p.splitActive('col')
      break
    case 'paneClose':
      p.closePane()
      break
    case 'paneFocusLeft':
      p.focusDirection('left')
      break
    case 'paneFocusRight':
      p.focusDirection('right')
      break
    case 'paneFocusUp':
      p.focusDirection('up')
      break
    case 'paneFocusDown':
      p.focusDirection('down')
      break
    case 'paneMoveLeft':
      p.moveActive('left')
      break
    case 'paneMoveRight':
      p.moveActive('right')
      break
    case 'paneMoveUp':
      p.moveActive('up')
      break
    case 'paneMoveDown':
      p.moveActive('down')
      break
    case 'paneResizeLeft':
      p.resizeActive('left')
      break
    case 'paneResizeRight':
      p.resizeActive('right')
      break
    case 'paneResizeUp':
      p.resizeActive('up')
      break
    case 'paneResizeDown':
      p.resizeActive('down')
      break
    case 'paneMaximize':
      p.toggleMaximize()
      break
    case 'paneDetach': {
      const active = leavesOf(p.root).find((l) => l.id === p.activeId)
      if (active?.tabId) void p.detachTab(active.tabId)
      break
    }
    case 'paneFlip':
      p.flipActiveGroup()
      break
  }
  return true
}

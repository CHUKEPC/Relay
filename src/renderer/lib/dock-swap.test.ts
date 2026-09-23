import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneLeaf } from '@renderer/store/panes'

const api = {
  platform: 'win32',
  storageSave: vi.fn(async () => {}),
  paneFocus: vi.fn(async () => {}),
  paneAttach: vi.fn(async () => {}),
  paneList: vi.fn(async () => []),
  onPaneClosed: vi.fn(() => () => {})
}
;(globalThis as unknown as { window: unknown }).window = {
  api,
  innerWidth: 1400,
  innerHeight: 900,
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
}

let panes: typeof import('@renderer/store/panes')
let ui: typeof import('@renderer/store/ui')
let swap: typeof import('./dock-swap')

beforeAll(async () => {
  panes = await import('@renderer/store/panes')
  ui = await import('@renderer/store/ui')
  swap = await import('./dock-swap')
})

const leaf = (): PaneLeaf => panes.usePanes.getState().root as PaneLeaf

beforeEach(() => {
  const root = panes.newLeaf('t1')
  panes.usePanes.setState({ root, activeId: root.id, maximizedId: null, detached: [], maxPanes: 16 })
  ui.useUi.setState({ sidebarDock: 'left', sidebarCollapsed: false })
})

describe('sidebar and response trade places', () => {
  it('moving the sidebar onto the response edge sends the response to the old sidebar edge', () => {
    panes.usePanes.getState().setRespDock(leaf().id, 'right')
    swap.dockSidebar('right')
    expect(ui.useUi.getState().sidebarDock).toBe('right')
    expect(leaf().respDock).toBe('left')
  })

  it('moving the response onto the sidebar edge sends the sidebar to the old response edge', () => {
    // response starts at the bottom, sidebar on the left
    swap.dockResponse(leaf().id, 'left')
    expect(leaf().respDock).toBe('left')
    expect(ui.useUi.getState().sidebarDock).toBe('bottom')
  })

  it('does not trade when the edges differ', () => {
    swap.dockSidebar('right')
    expect(leaf().respDock).toBe('bottom')
  })

  it('does not move a hidden sidebar', () => {
    ui.useUi.setState({ sidebarCollapsed: true })
    swap.dockResponse(leaf().id, 'left')
    expect(ui.useUi.getState().sidebarDock).toBe('left')
  })

  it('floating or top never trades — there is no edge to give back', () => {
    swap.dockResponse(leaf().id, 'top')
    expect(ui.useUi.getState().sidebarDock).toBe('left')
    swap.dockSidebar('float')
    expect(leaf().respDock).toBe('top')
  })

  it('only a pane that actually touches that window edge counts', () => {
    const p = panes.usePanes.getState()
    p.splitActive('row') // two panes side by side
    const [first, second] = panes.leavesOf(panes.usePanes.getState().root)
    p.setRespDock(first.id, 'right') // the left pane's right edge is the middle of the window
    p.setRespDock(second.id, 'right')
    swap.dockSidebar('right')
    const [a, b] = panes.leavesOf(panes.usePanes.getState().root)
    expect(a.respDock).toBe('right')
    expect(b.respDock).toBe('left')
  })

  it('switching between a side and top/bottom resets the share to something usable', () => {
    panes.usePanes.getState().setRespPct(leaf().id, 20)
    swap.dockResponse(leaf().id, 'right')
    expect(leaf().respPct).toBe(46)
    panes.usePanes.getState().setRespPct(leaf().id, 30)
    swap.dockResponse(leaf().id, 'top')
    expect(leaf().respPct).toBe(46)
  })
})

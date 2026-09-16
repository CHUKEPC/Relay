import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneLeaf, PaneNode, PaneSplit } from './panes'

// Renderer stores reach for window.api lazily (persistence, IPC); stub what they touch.
const api = {
  platform: 'win32',
  storageSave: vi.fn(async () => {}),
  paneFocus: vi.fn(async () => {}),
  paneAttach: vi.fn(async () => {}),
  paneDetach: vi.fn(async () => {}),
  panePutSnapshot: vi.fn(),
  paneTakeSnapshot: vi.fn(async () => null),
  paneList: vi.fn(async () => []),
  onPaneClosed: vi.fn(() => () => {})
}
;(globalThis as unknown as { window: unknown }).window = {
  api,
  // The store shows a toast when a pane action hits the feature limit.
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
}

let panes: typeof import('./panes')
let tabs: typeof import('./tabs')

beforeAll(async () => {
  tabs = await import('./tabs')
  panes = await import('./panes')
  panes.initPanes()
})

function openTabs(n: number): string[] {
  const t = tabs.useTabs.getState()
  t.closeAll()
  return Array.from({ length: n }, () => t.openNew())
}

const P = () => panes.usePanes.getState()
const leaves = () => panes.leavesOf(P().root)
const tabOf = (leafId: string) => leaves().find((l) => l.id === leafId)?.tabId ?? null

beforeEach(() => {
  // Most tests build more than four panes, which needs the plugin ceiling.
  panes.usePanes.setState({ root: panes.newLeaf(), maximizedId: null, detached: [], maxPanes: 16 })
  panes.usePanes.setState({ activeId: (P().root as PaneLeaf).id })
})

describe('presets', () => {
  it('builds 2/3/4/8 panes and fills them with distinct open tabs', () => {
    const ids = openTabs(8)
    for (const n of [2, 3, 4, 8] as const) {
      P().applyPreset(n)
      const shown = leaves().map((l) => l.tabId)
      expect(shown).toHaveLength(n)
      expect(new Set(shown).size).toBe(n)
      expect(shown.every((id) => id && ids.includes(id))).toBe(true)
    }
  })

  it('refuses to exceed the pane limit of the current feature set', () => {
    openTabs(8)
    panes.usePanes.setState({ maxPanes: panes.CORE_MAX_PANES })
    P().applyPreset(4)
    expect(leaves()).toHaveLength(4)
    // Beyond the cap the layout is left exactly as it was.
    P().applyPreset(8)
    expect(leaves()).toHaveLength(4)
    P().splitActive('row')
    expect(leaves()).toHaveLength(4)
  })

  it('keeps the active tab on screen when shrinking', () => {
    openTabs(4)
    P().applyPreset(4)
    const last = leaves()[3]
    P().focusPane(last.id)
    const activeTab = last.tabId
    P().applyPreset(1)
    expect(P().root.kind).toBe('leaf')
    expect((P().root as PaneLeaf).tabId).toBe(activeTab)
    expect(tabs.useTabs.getState().doc.activeTabId).toBe(activeTab)
  })

  it('3 panes = one big pane beside a stacked pair', () => {
    openTabs(3)
    P().applyPreset(3)
    const root = P().root as PaneSplit
    expect(root.dir).toBe('row')
    expect(root.a.kind).toBe('leaf')
    expect((root.b as PaneSplit).dir).toBe('col')
  })
})

describe('independence', () => {
  it('never shows one tab in two panes', () => {
    const [a] = openTabs(2)
    P().applyPreset(2)
    const [first, second] = leaves()
    P().setLeafTab(second.id, first.tabId)
    expect(tabOf(second.id)).not.toBe(first.tabId)
    expect(leaves().map((l) => l.tabId)).toContain(a)
  })

  it('focuses the pane that already shows a tab picked in the tab strip', () => {
    openTabs(2)
    P().applyPreset(2)
    const [first, second] = leaves()
    P().focusPane(first.id)
    tabs.useTabs.getState().setActive(second.tabId)
    expect(P().activeId).toBe(second.id)
    expect(tabOf(first.id)).not.toBe(second.tabId)
  })

  it('opens a new tab into the active pane only', () => {
    openTabs(2)
    P().applyPreset(2)
    const [first, second] = leaves()
    P().focusPane(second.id)
    const before = tabOf(first.id)
    const created = tabs.useTabs.getState().openNew()
    expect(tabOf(second.id)).toBe(created)
    expect(tabOf(first.id)).toBe(before)
  })

  it('closing the active tab keeps focus in its pane with a free tab', () => {
    openTabs(3)
    P().applyPreset(2)
    const [first, second] = leaves()
    P().focusPane(first.id)
    const closing = first.tabId!
    tabs.useTabs.getState().closeTab(closing)
    expect(P().activeId).toBe(first.id)
    expect(tabOf(first.id)).not.toBeNull()
    expect(tabOf(first.id)).not.toBe(second.tabId)
  })
})

describe('keyboard layout control', () => {
  it('moves focus and swaps panes by direction', () => {
    openTabs(4)
    P().applyPreset(4)
    // Reading order, not tree order: the 2x2 preset is two independent columns.
    const [tl, tr, bl, br] = panes.leavesInReadingOrder(P().root)
    P().focusPane(tl.id)
    P().focusDirection('right')
    expect(P().activeId).toBe(tr.id)
    P().focusDirection('down')
    expect(P().activeId).toBe(br.id)

    P().focusPane(tl.id)
    const tlTab = tl.tabId
    const blTab = bl.tabId
    P().moveActive('down')
    expect(tabOf(bl.id)).toBe(tlTab)
    expect(tabOf(tl.id)).toBe(blTab)
    expect(P().activeId).toBe(bl.id)
  })

  it('gives each column of the 2x2 preset its own horizontal divider', () => {
    openTabs(4)
    P().applyPreset(4)
    const root = P().root as PaneSplit
    // Columns first: resizing one column's divider must not move the other's.
    expect(root.dir).toBe('row')
    expect((root.a as PaneSplit).dir).toBe('col')
    expect((root.b as PaneSplit).dir).toBe('col')
    expect((root.a as PaneSplit).id).not.toBe((root.b as PaneSplit).id)
  })

  it('resizes by moving the nearest divider in the arrow direction', () => {
    openTabs(2)
    P().applyPreset(2)
    const [left] = leaves()
    P().focusPane(left.id)
    P().resizeActive('right')
    expect((P().root as PaneSplit).ratio).toBeCloseTo(0.55)
    P().resizeActive('left')
    P().resizeActive('left')
    expect((P().root as PaneSplit).ratio).toBeCloseTo(0.45)
  })

  it('flips the big pane with the stacked pair', () => {
    openTabs(3)
    P().applyPreset(3)
    const big = leaves()[0]
    P().focusPane(big.id)
    P().flipActiveGroup()
    const root = P().root as PaneSplit
    expect(root.b.id).toBe(big.id)
    expect((root.a as PaneSplit).dir).toBe('col')
  })

  it('adds and closes panes; the sibling takes the freed space', () => {
    openTabs(3)
    P().splitActive('row')
    expect(leaves()).toHaveLength(2)
    const added = P().activeId
    P().splitActive('col')
    expect(leaves()).toHaveLength(3)
    P().closePane()
    expect(leaves()).toHaveLength(2)
    expect(P().activeId).toBe(added)
    P().closePane()
    expect(P().root.kind).toBe('leaf')
    P().closePane()
    expect(P().root.kind).toBe('leaf')
  })

  it('drops a pane on another pane edge to split it there', () => {
    openTabs(3)
    P().applyPreset(3)
    const [big, top, bottom] = leaves()
    P().movePaneTo(bottom.id, big.id, 'down')
    const root = P().root as PaneNode as PaneSplit
    expect(root.dir).toBe('row')
    const left = root.a as PaneSplit
    expect(left.dir).toBe('col')
    expect(left.a.id).toBe(big.id)
    expect(left.b.id).toBe(bottom.id)
    expect(root.b.id).toBe(top.id)
  })
})

describe('dropping tabs into the grid', () => {
  it('splits the target pane and shows the dropped tab in the new one', () => {
    const [a, b] = openTabs(2)
    P().applyPreset(1)
    const only = leaves()[0]
    P().setLeafTab(only.id, a)

    P().dropTabInto(b, only.id, 'right')

    const root = P().root as PaneSplit
    expect(root.kind).toBe('split')
    expect(root.dir).toBe('row')
    expect((root.a as PaneLeaf).tabId).toBe(a)
    expect((root.b as PaneLeaf).tabId).toBe(b)
    // Focus follows the tab the user just dropped.
    expect(P().activeId).toBe(root.b.id)
  })

  it('shows the tab in place when dropped on the middle of a pane', () => {
    const [a, b] = openTabs(2)
    P().applyPreset(1)
    const only = leaves()[0]
    P().setLeafTab(only.id, a)

    P().dropTabInto(b, only.id, 'center')

    expect(leaves()).toHaveLength(1)
    expect(tabOf(only.id)).toBe(b)
  })

  it('moves a tab that already owns a pane instead of duplicating it', () => {
    const [a, b] = openTabs(2)
    P().applyPreset(2)
    const [left, right] = leaves()
    P().setLeafTab(left.id, a)
    P().setLeafTab(right.id, b)

    P().dropTabInto(b, left.id, 'up')

    const shown = leaves().map((l) => l.tabId)
    expect(leaves()).toHaveLength(2)
    expect(shown.filter((id) => id === b)).toHaveLength(1)
  })

  it('splits the whole grid when dropped on an outer edge', () => {
    const ids = openTabs(3)
    P().applyPreset(2)
    // applyPreset picks which tabs are on screen; the spare one is what we drop.
    const shown = leaves().map((l) => l.tabId)
    const spare = ids.find((id) => !shown.includes(id))!

    P().dropTabAtEdge(spare, 'down')

    const root = P().root as PaneSplit
    expect(root.dir).toBe('col')
    // The previous layout stays intact above the new full-width pane.
    expect((root.b as PaneLeaf).tabId).toBe(spare)
    expect(panes.leavesOf(root.a).map((l) => l.tabId)).toEqual(shown)
  })

  it('opens the tab in the target pane instead of splitting past the limit', () => {
    const ids = openTabs(5)
    P().applyPreset(4)
    const seats = leaves()
    seats.forEach((leaf, i) => P().setLeafTab(leaf.id, ids[i]))
    panes.usePanes.setState({ maxPanes: panes.CORE_MAX_PANES })

    P().dropTabInto(ids[4], seats[0].id, 'right')

    expect(leaves()).toHaveLength(4)
    expect(tabOf(seats[0].id)).toBe(ids[4])
  })
})

import { beforeAll, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { window: unknown }).window = {
  api: { storageSave: vi.fn(async () => {}) },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
}

let tabs: typeof import('./tabs')

beforeAll(async () => {
  tabs = await import('./tabs')
})

const order = () => tabs.useTabs.getState().doc.tabs.map((t) => t.id)

function open(n: number): string[] {
  const t = tabs.useTabs.getState()
  t.closeAll()
  return Array.from({ length: n }, () => t.openNew())
}

describe('moveTab (tab strip drag)', () => {
  it('moves a tab to the given final index, both ways', () => {
    const [a, b, c, d] = open(4)
    tabs.useTabs.getState().moveTab(a, 2)
    expect(order()).toEqual([b, c, a, d])
    tabs.useTabs.getState().moveTab(d, 0)
    expect(order()).toEqual([d, b, c, a])
  })

  it('clamps the index and ignores unknown tabs and no-op moves', () => {
    const [a, b, c] = open(3)
    tabs.useTabs.getState().moveTab(a, 99)
    expect(order()).toEqual([b, c, a])
    tabs.useTabs.getState().moveTab(c, -5)
    expect(order()).toEqual([c, b, a])
    const before = tabs.useTabs.getState().doc
    tabs.useTabs.getState().moveTab(b, 1)
    tabs.useTabs.getState().moveTab('missing', 0)
    expect(tabs.useTabs.getState().doc).toBe(before)
  })

  it('keeps the active tab', () => {
    const [a, b] = open(2)
    tabs.useTabs.getState().setActive(a)
    tabs.useTabs.getState().moveTab(a, 1)
    expect(order()).toEqual([b, a])
    expect(tabs.useTabs.getState().doc.activeTabId).toBe(a)
  })
})

describe('tab groups', () => {
  const T = () => tabs.useTabs.getState()
  const groupOf = (id: string) => T().doc.tabs.find((t) => t.id === id)?.groupId ?? null

  it('gathers a new group where its first tab is and names a colour', () => {
    const [a, b, c, d] = open(4)
    const g = T().createGroup([b, d], { name: 'API' })
    expect(order()).toEqual([a, b, d, c])
    expect(groupOf(b)).toBe(g)
    expect(groupOf(d)).toBe(g)
    expect(T().doc.groups).toEqual([{ id: g, name: 'API', color: 'blue', collapsed: false }])
    // The next group takes the next free colour.
    const g2 = T().createGroup([c])
    expect(T().doc.groups?.find((x) => x.id === g2)?.color).toBe('red')
  })

  it('adds a tab at the end of a group and takes it out right after it', () => {
    const [a, b, c] = open(3)
    const g = T().createGroup([b])
    T().addToGroup(a, g)
    expect(order()).toEqual([b, a, c])
    T().removeFromGroup(b)
    expect(order()).toEqual([a, b, c])
    expect(groupOf(b)).toBeNull()
    expect(groupOf(a)).toBe(g)
  })

  it('drops a group once its last tab closes', () => {
    const [a, b] = open(2)
    T().createGroup([b])
    T().closeTab(b)
    expect(T().doc.groups).toEqual([])
    expect(order()).toEqual([a])
  })

  it('joins the group a tab is dragged into and leaves it when dragged out', () => {
    const [a, b, c, d] = open(4)
    const g = T().createGroup([b, c])
    // a dropped between b and c joins the group
    T().moveTab(a, 1)
    expect(order()).toEqual([b, a, c, d])
    expect(groupOf(a)).toBe(g)
    // dragged to the far end, away from the rest of the group, it leaves
    T().moveTab(a, 3)
    expect(order()).toEqual([b, c, d, a])
    expect(groupOf(a)).toBeNull()
  })

  it('takes the group the strip found under the pointer', () => {
    const [a, b, c] = open(3)
    const g = T().createGroup([c])
    T().setGroupCollapsed(g, true)
    // Dropped on the label of a folded group: a joins it, right where it is, and the group opens.
    T().moveTab(a, 0, g)
    expect(groupOf(a)).toBe(g)
    // The group gathers where its first tab now is.
    expect(order()).toEqual([a, c, b])
    expect(T().doc.groups?.find((x) => x.id === g)?.collapsed).toBe(false)
    // Same slot, away from every group: it leaves without moving.
    const before = order()
    T().moveTab(a, order().indexOf(a), null)
    expect(groupOf(a)).toBeNull()
    expect(order()).toEqual(before)
    // An unknown group means none.
    T().moveTab(b, 0, 'no-such-group')
    expect(groupOf(b)).toBeNull()
  })

  it('lets the only tab of a group take the group along', () => {
    const [a, b, c] = open(3)
    const g = T().createGroup([a])
    T().moveTab(a, 2)
    expect(order()).toEqual([b, c, a])
    expect(groupOf(a)).toBe(g)
  })

  it('collapsing moves the active tab out of the group; showing a hidden tab unfolds it', () => {
    const [a, b, c] = open(3)
    const g = T().createGroup([a, b])
    T().setActive(b)
    T().setGroupCollapsed(g, true)
    expect(T().doc.activeTabId).toBe(c)
    expect(T().doc.groups?.[0].collapsed).toBe(true)
    T().setActive(a)
    expect(T().doc.groups?.[0].collapsed).toBe(false)
  })

  it('closing a group closes its tabs; ungrouping keeps them', () => {
    const [a, b, c] = open(3)
    const g = T().createGroup([b, c])
    T().ungroup(g)
    expect(order()).toEqual([a, b, c])
    expect(T().doc.groups).toEqual([])
    const g2 = T().createGroup([a, b])
    T().closeGroup(g2)
    expect(order()).toEqual([c])
    expect(T().doc.groups).toEqual([])
  })

  it('moves a whole group and never splits another one', () => {
    const [a, b, c, d, e] = open(5)
    const g1 = T().createGroup([a, b])
    T().createGroup([c, d])
    // Index 1 among the others (c, d, e) would land inside the c-d group: it steps past it.
    T().moveGroup(g1, 1)
    expect(order()).toEqual([c, d, a, b, e])
  })

  it('heals a document whose groups are inconsistent', () => {
    const { tabs: fixed, groups } = tabs.normalizeGroups(
      [
        { id: 'x', request: {} as never, savedRequestId: null, dirty: false, groupId: 'g' },
        { id: 'y', request: {} as never, savedRequestId: null, dirty: false },
        { id: 'z', request: {} as never, savedRequestId: null, dirty: false, groupId: 'g' },
        { id: 'w', request: {} as never, savedRequestId: null, dirty: false, groupId: 'gone' }
      ],
      [
        { id: 'g', name: '', color: 'blue', collapsed: false },
        { id: 'empty', name: '', color: 'red', collapsed: false }
      ]
    )
    expect(fixed.map((t) => t.id)).toEqual(['x', 'z', 'y', 'w'])
    expect(fixed[3].groupId).toBeNull()
    expect(groups.map((g) => g.id)).toEqual(['g'])
  })
})

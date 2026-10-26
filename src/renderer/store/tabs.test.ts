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

  it('folding one of two neighbour groups leaves the other as it was', () => {
    const [a, b, c, d] = open(4)
    const g1 = T().createGroup([a, b])
    const g2 = T().createGroup([c, d])
    const folded = (g: string) => T().doc.groups?.find((x) => x.id === g)?.collapsed
    T().setGroupCollapsed(g2, true)
    T().setActive(a)
    // Nothing else is on view: the active tab stays put, g2 stays folded.
    T().setGroupCollapsed(g1, true)
    expect(folded(g1)).toBe(true)
    expect(folded(g2)).toBe(true)
    expect(T().doc.activeTabId).toBe(a)
    // Unfolding g2 does not touch g1, and folding it again moves nothing either.
    T().setGroupCollapsed(g2, false)
    expect(folded(g1)).toBe(true)
    expect(folded(g2)).toBe(false)
    T().setActive(c)
    T().setGroupCollapsed(g2, true)
    expect(folded(g1)).toBe(true)
    expect(T().doc.activeTabId).toBe(c)
    // An ungrouped tab on view takes over, past the folded neighbour.
    const e = T().openNew()
    T().setActive(c)
    T().setGroupCollapsed(g2, true)
    expect(T().doc.activeTabId).toBe(e)
    expect(folded(g1)).toBe(true)
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

describe('the same request in several groups', () => {
  const T = () => tabs.useTabs.getState()
  const req = (id: string, name = id) => ({ id, name, method: 'GET' as const, url: '', query: [], headers: [], pathVariables: [], body: { type: 'none' as const }, auth: { type: 'inherit' as const } })
  const ofRequest = (id: string) => T().doc.tabs.filter((t) => t.savedRequestId === id)
  let groupsLib: typeof import('../lib/tab-groups')

  beforeAll(async () => {
    groupsLib = await import('../lib/tab-groups')
  })

  it('opening a collection as a group gives it tabs of its own; the other group keeps its tabs', () => {
    T().closeAll()
    const a = T().openSaved(req('r1'), 'r1')
    const b = T().openSaved(req('r2'), 'r2')
    const loose = T().openSaved(req('r3'), 'r3')
    const g1 = T().createGroup([a, b], { name: 'Orders' })
    const node = { id: 'col', type: 'collection' as const, name: 'Shop', children: ['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, type: 'request' as const, request: req(id) })) }
    groupsLib.openNodeAsGroup(node)
    const g2 = T().doc.groups!.find((g) => g.sourceId === 'col')!
    expect(T().doc.tabs.filter((t) => t.groupId === g2.id).map((t) => t.savedRequestId)).toEqual(['r1', 'r2', 'r3', 'r4'])
    // Orders still has its two tabs, the loose tab stays loose.
    expect(T().doc.tabs.filter((t) => t.groupId === g1).map((t) => t.id)).toEqual([a, b])
    expect(T().doc.tabs.find((t) => t.id === loose)?.groupId ?? null).toBeNull()
    // Closing the new group takes none of them along.
    T().closeGroup(g2.id)
    expect(T().doc.tabs.map((t) => t.id).sort()).toEqual([a, b, loose].sort())
    expect(T().doc.groups!.map((g) => g.id)).toEqual([g1])
  })

  it('opening the same folder again goes back to its group and adds only what it lacks', () => {
    T().closeAll()
    const folder = { id: 'fld', type: 'folder' as const, name: 'F', children: [{ id: 'r1', type: 'request' as const, request: req('r1') }] }
    groupsLib.openNodeAsGroup(folder)
    folder.children.push({ id: 'r2', type: 'request' as const, request: req('r2') })
    groupsLib.openNodeAsGroup(folder)
    expect(T().doc.groups).toHaveLength(1)
    expect(T().doc.tabs.map((t) => t.savedRequestId)).toEqual(['r1', 'r2'])
  })

  it('a sidebar click reuses the tab beside the active one', () => {
    T().closeAll()
    const inA = T().openSaved(req('r1'), 'r1')
    const other = T().openNew()
    const gA = T().createGroup([inA, other])
    const inB = T().openSaved(req('r1'), 'r1', { fresh: true })
    const mate = T().openNew()
    T().createGroup([inB, mate])
    T().setActive(mate)
    expect(T().openSaved(req('r1'), 'r1')).toBe(inB)
    T().setActive(other)
    expect(T().openSaved(req('r1'), 'r1')).toBe(inA)
    expect(T().doc.groups!.find((g) => g.id === gA)).toBeDefined()
  })

  it('saving one tab updates the clean tabs of the same request, not the edited ones', () => {
    T().closeAll()
    const one = T().openSaved(req('r1', 'Old'), 'r1')
    const two = T().openSaved(req('r1', 'Old'), 'r1', { fresh: true })
    const three = T().openSaved(req('r1', 'Old'), 'r1', { fresh: true })
    T().patchTab(three, { url: 'https://draft' })
    T().patchTab(one, { name: 'New', url: 'https://saved' })
    T().markSaved(one, 'r1')
    const byId = (id: string) => T().doc.tabs.find((t) => t.id === id)!
    expect(byId(two).request).toMatchObject({ name: 'New', url: 'https://saved' })
    expect(byId(two).dirty).toBe(false)
    expect(byId(three).request.url).toBe('https://draft')
    expect(ofRequest('r1')).toHaveLength(3)
  })

  it('a rename in the sidebar reaches every tab of the request without dirtying it', () => {
    T().closeAll()
    const one = T().openSaved(req('r1', 'Old'), 'r1')
    T().openSaved(req('r1', 'Old'), 'r1', { fresh: true })
    T().renameSaved('r1', 'Renamed')
    expect(ofRequest('r1').map((t) => [t.request.name, t.dirty])).toEqual([
      ['Renamed', false],
      ['Renamed', false]
    ])
    expect(T().doc.tabs.find((t) => t.id === one)?.dirty).toBe(false)
  })

  it('a duplicated tab remembers its original until it is saved', () => {
    T().closeAll()
    const one = T().openSaved(req('r1'), 'r1')
    T().duplicateTab(one)
    const copy = T().activeTab()!
    expect(copy.copyOf).toBe('r1')
    expect(copy.savedRequestId).toBeNull()
    // A copy of the copy still points at the saved original.
    T().duplicateTab(copy.id)
    expect(T().activeTab()!.copyOf).toBe('r1')
    T().markSaved(copy.id, 'r9')
    expect(T().doc.tabs.find((t) => t.id === copy.id)?.copyOf).toBeUndefined()
  })
})

describe('the unsaved-changes dot', () => {
  const T = () => tabs.useTabs.getState()
  let collections: typeof import('./collections')

  beforeAll(async () => {
    collections = await import('./collections')
  })

  it('goes away when the edits are taken back to the saved request', () => {
    T().closeAll()
    const saved = { ...collections.emptyRequest('Saved'), id: 'r_saved', url: 'https://a' }
    collections.useCollections.getState().setAll([{ id: 'c', type: 'collection', name: 'C', children: [{ id: saved.id, type: 'request', request: saved }] }])
    const id = T().openSaved(saved, saved.id)
    const dirty = () => T().doc.tabs.find((t) => t.id === id)!.dirty
    T().patchTab(id, { url: 'https://ab' })
    expect(dirty()).toBe(true)
    T().patchTab(id, { url: 'https://a' })
    expect(dirty()).toBe(false)
    // An emptied field that the saved request never had is no change either.
    T().patchTab(id, { description: 'x' })
    expect(dirty()).toBe(true)
    T().patchTab(id, { description: '' })
    expect(dirty()).toBe(false)
  })

  it('a blank tab typed in and erased again is clean; a request whose saved copy is gone stays dirty', () => {
    T().closeAll()
    const id = T().openNew()
    const dirty = () => T().doc.tabs.find((t) => t.id === id)!.dirty
    T().patchTab(id, { url: 'h' })
    expect(dirty()).toBe(true)
    T().patchTab(id, { url: '' })
    expect(dirty()).toBe(false)
    const orphan = T().openSaved({ ...collections.emptyRequest('Gone'), id: 'r_gone' }, 'r_gone')
    T().patchTab(orphan, { url: '' })
    expect(T().doc.tabs.find((t) => t.id === orphan)!.dirty).toBe(true)
  })

  it('compares content, not key order', () => {
    const a = collections.emptyRequest('A')
    // The same fields in another order.
    const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())))
    expect(tabs.requestsDiffer(a, b)).toBe(false)
    expect(tabs.requestsDiffer(a, { ...a, headers: [{ key: 'X', value: '1', enabled: true }] })).toBe(true)
  })
})

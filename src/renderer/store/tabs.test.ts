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

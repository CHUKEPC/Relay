import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionFolderNode, CollectionNode } from '@shared/types'

;(globalThis as unknown as { window: unknown }).window = {
  api: { storageSave: vi.fn(async () => {}) },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
}

let collections: typeof import('./collections')

beforeAll(async () => {
  collections = await import('./collections')
})

const C = () => collections.useCollections.getState()
const req = (id: string): CollectionNode => ({ id, type: 'request', request: { ...collections.emptyRequest(id), id } })
const kids = (id: string) => (C().locate(id)?.node as CollectionFolderNode).children.map((c) => c.id)
const names = (id: string) => (C().locate(id)?.node as CollectionFolderNode).children.map((c) => (c.type === 'request' ? c.request.name : c.name))

/** shop{ orders{ r1, r2, r3 }, misc{ }, r4 }, blog{ r5 } */
beforeEach(() => {
  C().setAll([
    {
      id: 'shop',
      type: 'collection',
      name: 'Shop',
      children: [{ id: 'orders', type: 'folder', name: 'Orders', children: [req('r1'), req('r2'), req('r3')] }, { id: 'misc', type: 'folder', name: 'Misc', children: [] }, req('r4')]
    },
    { id: 'blog', type: 'collection', name: 'Blog', children: [req('r5')] }
  ])
})

describe('moveNodes (a sidebar selection)', () => {
  it('moves several nodes to the end of a folder, in tree order', () => {
    expect(C().moveNodes(['r3', 'r1', 'r5'], 'misc')).toBe(3)
    expect(kids('misc')).toEqual(['r1', 'r3', 'r5'])
    expect(kids('orders')).toEqual(['r2'])
    expect(kids('blog')).toEqual([])
  })

  it('places them before or after an anchor', () => {
    C().moveNodes(['r1', 'r4'], 'orders', { id: 'r3', side: 'before' })
    expect(kids('orders')).toEqual(['r2', 'r1', 'r4', 'r3'])
    C().moveNodes(['r5'], 'orders', { id: 'r2', side: 'after' })
    expect(kids('orders')).toEqual(['r2', 'r5', 'r1', 'r4', 'r3'])
  })

  it('leaves what the target cannot take: collections into folders, a folder into itself', () => {
    expect(C().moveNodes(['blog', 'r4'], 'misc')).toBe(1)
    expect(kids('misc')).toEqual(['r4'])
    expect(C().locate('blog')?.ancestors).toEqual([])
    expect(C().moveNodes(['orders'], 'orders')).toBe(0)
  })

  it('a node inside another moved node travels with it', () => {
    C().moveNodes(['orders', 'r2'], 'blog')
    expect(kids('blog')).toEqual(['r5', 'orders'])
    expect(kids('orders')).toEqual(['r1', 'r2', 'r3'])
  })

  it('reorders collections at the top level', () => {
    C().moveNodes(['blog'], null, { id: 'shop', side: 'before' })
    expect(C().doc.collections.map((c) => c.id)).toEqual(['blog', 'shop'])
  })
})

describe('duplicateNode', () => {
  it('puts the copy right after the original and names it «(копия)»', () => {
    const id = C().duplicateNode('r1')!
    expect(kids('orders')).toEqual(['r1', id, 'r2', 'r3'])
    expect(names('orders')[1]).toBe('r1 (копия)')
  })

  it('takes a name of one\'s own and another folder', () => {
    const id = C().duplicateNode('r1', { name: 'Mine', parentId: 'blog' })!
    expect(kids('blog')).toEqual(['r5', id])
    expect(names('blog')[1]).toBe('Mine')
  })

  it('copies a folder deep with fresh ids; only the folder itself is renamed', () => {
    const id = C().duplicateNode('orders')!
    const copy = C().locate(id)!.node as CollectionFolderNode
    expect(copy.name).toBe('Orders (копия)')
    expect(copy.children.map((c) => (c.type === 'request' ? c.request.name : ''))).toEqual(['r1', 'r2', 'r3'])
    expect(copy.children.some((c) => ['r1', 'r2', 'r3'].includes(c.id))).toBe(false)
    expect(kids('shop')).toEqual(['orders', id, 'misc', 'r4'])
  })

  it('never copies a folder into itself; a collection stays on top, after the original', () => {
    expect(C().duplicateNode('orders', { parentId: 'orders' })).toBeNull()
    const id = C().duplicateNode('shop', { parentId: 'blog' })!
    expect(C().doc.collections.map((c) => c.id)).toEqual(['shop', id, 'blog'])
  })
})

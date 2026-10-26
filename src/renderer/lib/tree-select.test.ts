import { describe, expect, it } from 'vitest'
import type { CollectionFolderNode, CollectionNode } from '@shared/types'
import { allIds, pruneToSelection, selectionExport, tickStates, toggleTick, topSelected } from './tree-select'
import { folderTargets, parentIdOf, saveDefaults } from './copy-target'

const req = (id: string): CollectionNode => ({
  id,
  type: 'request',
  request: { id, name: id, method: 'GET', url: '', query: [], headers: [], pathVariables: [], body: { type: 'none' }, auth: { type: 'inherit' } }
})

/** shop{ orders{ r1, r2 }, r3 }, blog{ r4 } */
function tree(): CollectionFolderNode[] {
  return [
    {
      id: 'shop',
      type: 'collection',
      name: 'Shop',
      variables: [{ key: 'base', value: 'https://shop', enabled: true }],
      children: [{ id: 'orders', type: 'folder', name: 'Orders', children: [req('r1'), req('r2')] }, req('r3')]
    },
    { id: 'blog', type: 'collection', name: 'Blog', variables: [{ key: 'base', value: 'https://blog', enabled: true }, { key: 'k', value: '1', enabled: true }], children: [req('r4')] }
  ]
}

describe('ticking rows', () => {
  it('acts on the top-most ticks, in tree order, ignoring gone ids', () => {
    expect(topSelected(tree(), ['r4', 'r1', 'orders', 'gone']).map((n) => n.id)).toEqual(['orders', 'r4'])
  })

  it('shows ticked, ticked through a folder, partly and not ticked', () => {
    const s = tickStates(tree(), ['orders'])
    expect([s.get('orders'), s.get('r1'), s.get('shop'), s.get('r3'), s.get('blog')]).toEqual(['on', 'implied', 'some', 'off', 'off'])
  })

  it('ticking a folder covers the ticks inside it', () => {
    expect(toggleTick(tree(), ['r1', 'r4'], 'orders')).toEqual(['r4', 'orders'])
  })

  it('unticking a row ticked through its parents keeps everything else they held', () => {
    expect(toggleTick(tree(), ['shop'], 'r1').sort()).toEqual(['r2', 'r3'])
    expect(toggleTick(tree(), ['orders', 'r4'], 'orders')).toEqual(['r4'])
  })

  it('select all ticks the collections', () => {
    expect(allIds(tree())).toEqual(['shop', 'blog'])
  })
})

describe('exporting a selection', () => {
  it('cuts a collection down to the ticks and keeps its settings', () => {
    const [shop] = pruneToSelection(tree(), ['r2', 'r3'])
    expect(shop.variables?.[0].key).toBe('base')
    expect(shop.children.map((c) => c.id)).toEqual(['orders', 'r3'])
    expect((shop.children[0] as CollectionFolderNode).children.map((c) => c.id)).toEqual(['r2'])
  })

  it('one collection passes through, a part of one is named so', () => {
    expect(selectionExport(tree(), ['shop'], 'All', (n) => `${n} (part)`)?.name).toBe('Shop')
    expect(selectionExport(tree(), ['r1'], 'All', (n) => `${n} (part)`)?.name).toBe('Shop (part)')
    expect(selectionExport(tree(), [], 'All', (n) => n)).toBeNull()
  })

  it('several collections become folders of one, variables merged (first wins)', () => {
    const out = selectionExport(tree(), ['r1', 'r4'], 'Selected', (n) => n)!
    expect(out.name).toBe('Selected')
    expect(out.children.map((c) => [c.id, c.type])).toEqual([
      ['shop', 'folder'],
      ['blog', 'folder']
    ])
    expect(out.variables).toEqual([
      { key: 'base', value: 'https://shop', enabled: true },
      { key: 'k', value: '1', enabled: true }
    ])
  })
})

describe('where a copy goes', () => {
  it('lists collections and folders, leaving out a folder and what is inside it', () => {
    expect(folderTargets(tree()).map((t) => t.id)).toEqual(['shop', 'orders', 'blog'])
    expect(folderTargets(tree(), 'shop').map((t) => t.id)).toEqual(['blog'])
    expect(folderTargets(tree(), ['orders', 'blog']).map((t) => t.id)).toEqual(['shop'])
  })

  it('finds the container of a node', () => {
    expect(parentIdOf(tree(), 'r1')).toBe('orders')
    expect(parentIdOf(tree(), 'shop')).toBeNull()
    expect(parentIdOf(tree(), 'nope')).toBeUndefined()
  })

  it('offers «… (копия)» and the original folder for a duplicated tab, the own folder for Save As', () => {
    const copy = (n: string) => `${n} (копия)`
    const base = { id: 't', request: (req('r1') as Extract<CollectionNode, { type: 'request' }>).request, dirty: true }
    expect(saveDefaults({ ...base, savedRequestId: null, copyOf: 'r1' }, tree(), 'r1', copy)).toEqual({ copy: true, suggested: 'r1 (копия)', parentId: 'orders' })
    expect(saveDefaults({ ...base, savedRequestId: 'r4' }, tree(), 'r4', copy)).toEqual({ copy: false, suggested: 'r4', parentId: 'blog' })
    expect(saveDefaults({ ...base, savedRequestId: null }, tree(), 'New', copy)).toEqual({ copy: false, suggested: 'New', parentId: null })
    // A copy of a tab that was never saved: still a copy, no folder to offer.
    expect(saveDefaults({ ...base, savedRequestId: null, copyOf: null }, tree(), 'Draft', copy)).toEqual({ copy: true, suggested: 'Draft (копия)', parentId: null })
    // The original was deleted meanwhile: still a copy, no folder to offer.
    expect(saveDefaults({ ...base, savedRequestId: null, copyOf: 'gone' }, tree(), 'X', copy)).toEqual({ copy: true, suggested: 'X (копия)', parentId: null })
  })
})

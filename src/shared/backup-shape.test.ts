import { describe, expect, it } from 'vitest'
import { acceptSnapshot, reidNode } from './backup-shape'
import type { CollectionNode } from './types'

const request = (id: string): CollectionNode => ({
  id,
  type: 'request',
  request: { id, name: id, method: 'GET', url: 'https://x', query: [], headers: [], pathVariables: [], body: { type: 'none' }, auth: { type: 'inherit' } }
})

describe('acceptSnapshot', () => {
  it('keeps a well-formed snapshot as it is', () => {
    const snap = {
      collections: [{ id: 'c1', type: 'collection' as const, name: 'C', children: [request('r1')] }],
      environments: [{ id: 'e1', name: 'Stage', variables: [] }],
      activeEnvironmentId: 'e1',
      globals: [{ key: 'base', value: 'x', enabled: true }],
      history: [{ id: 'h1', method: 'GET', url: 'https://x' }]
    }
    expect(acceptSnapshot(snap)).toEqual(snap)
  })

  it('drops what the app could not render instead of restoring it', () => {
    const out = acceptSnapshot({
      collections: [{ foo: 1 }, { id: 'c1', type: 'collection', name: 'C', children: [request('r1'), { id: 'bad', type: 'request' }] }, request('top')],
      environments: [{ id: 'e1' }, 'nope'],
      activeEnvironmentId: 42,
      globals: [{ value: 'no key' }, { key: 'ok', value: '1' }],
      history: [null, { id: 'h1' }]
    })
    expect(out.collections).toHaveLength(1)
    expect(out.collections[0].children.map((c) => c.id)).toEqual(['r1'])
    expect(out.environments).toEqual([])
    expect(out.activeEnvironmentId).toBeNull()
    expect(out.globals).toEqual([{ key: 'ok', value: '1' }])
    expect(out.history).toEqual([])
  })

  it('treats a non-list as empty', () => {
    expect(acceptSnapshot({ collections: { not: 'a list' } }).collections).toEqual([])
  })
})

describe('reidNode', () => {
  it('gives the tree and every request inside fresh ids, keeping node and request ids equal', () => {
    let n = 0
    const tree: CollectionNode = { id: 'c1', type: 'collection', name: 'C', children: [request('r1'), { id: 'f1', type: 'folder', name: 'F', children: [request('r2')] }] }
    const out = reidNode(tree, (p) => `${p}-${++n}`)
    const ids: string[] = []
    const walk = (node: CollectionNode): void => {
      ids.push(node.id)
      if (node.type === 'request') expect(node.request.id).toBe(node.id)
      else node.children.forEach(walk)
    }
    walk(out)
    expect(ids).not.toContain('c1')
    expect(ids).not.toContain('r1')
    expect(new Set(ids).size).toBe(ids.length)
  })
})

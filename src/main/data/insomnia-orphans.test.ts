/**
 * An Insomnia export can reference a parent that is not in the file (a partial
 * export, or a group deleted after the fact). Those requests must still be
 * imported — dropping them silently is data loss the user cannot see.
 */
import { describe, expect, it } from 'vitest'
import { importInsomnia } from './insomnia'
import type { CollectionNode } from '@shared/types'

function countRequests(nodes: CollectionNode[]): number {
  return nodes.reduce((n, node) => n + (node.type === 'request' ? 1 : countRequests(node.children)), 0)
}

describe('Insomnia import — orphaned resources', () => {
  const doc = {
    _type: 'export',
    __export_format: 4,
    resources: [
      { _id: 'wrk_1', _type: 'workspace', name: 'Workspace' },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'In workspace', method: 'GET', url: 'https://a.example' },
      { _id: 'req_2', _type: 'request', parentId: 'fld_gone', name: 'Orphan', method: 'POST', url: 'https://b.example' },
      { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_missing', name: 'Orphan folder' },
      { _id: 'req_3', _type: 'request', parentId: 'fld_1', name: 'In orphan folder', method: 'PUT', url: 'https://c.example' }
    ]
  }

  it('imports every request even when its parent is missing', () => {
    const { collections, warnings } = importInsomnia(doc)
    expect(countRequests(collections)).toBe(3)
    expect(warnings.join(' ')).toMatch(/3|orphan|parent/i)
  })

  it('keeps an orphan folder with its children instead of dropping the subtree', () => {
    const { collections } = importInsomnia(doc)
    const names: string[] = []
    const walk = (nodes: CollectionNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'request') names.push(n.request.name)
        else {
          names.push(n.name)
          walk(n.children)
        }
      }
    }
    walk(collections)
    expect(names).toContain('Orphan')
    expect(names).toContain('Orphan folder')
    expect(names).toContain('In orphan folder')
  })
})

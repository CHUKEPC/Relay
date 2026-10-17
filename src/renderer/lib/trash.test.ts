import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionFolderNode } from '@shared/types'

;(globalThis as unknown as { window: unknown }).window = {
  api: { storageSave: vi.fn(async () => {}) },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
}

let trash: typeof import('./trash')
let collections: typeof import('../store/collections')
let envs: typeof import('../store/environments')
let history: typeof import('../store/history')
let trashStore: typeof import('../store/trash')

beforeAll(async () => {
  trash = await import('./trash')
  collections = await import('../store/collections')
  envs = await import('../store/environments')
  history = await import('../store/history')
  trashStore = await import('../store/trash')
})

const C = () => collections.useCollections.getState()
const E = () => envs.useEnvironments.getState()
const entries = () => trashStore.useTrash.getState().doc.entries

function seed(): void {
  const req = (id: string) => ({ id, type: 'request' as const, request: { ...collections.emptyRequest(id), id } })
  const tree: CollectionFolderNode[] = [
    {
      id: 'col1',
      type: 'collection',
      name: 'Shop',
      children: [{ id: 'fld1', type: 'folder', name: 'Orders', children: [req('r1'), req('r2'), req('r3')] }]
    }
  ]
  C().setAll(tree)
  envs.useEnvironments.setState({
    env: {
      version: 1,
      activeEnvironmentId: 'env1',
      environments: [
        { id: 'env1', name: 'Dev', variables: [{ id: 'v1', key: 'base', value: 'x', enabled: true }, { id: 'v2', key: 'token', value: 't', enabled: true }] },
        { id: 'env2', name: 'Prod', variables: [] }
      ]
    },
    globals: { version: 1, variables: [] }
  })
  trashStore.useTrash.getState().clear()
}

const childIds = (id: string) => {
  const found = C().locate(id)
  return found && found.node.type !== 'request' ? found.node.children.map((c) => c.id) : null
}

describe('trash', () => {
  beforeEach(seed)

  it('puts a deleted request back at its old index', () => {
    trash.trashNode('r2')
    expect(childIds('fld1')).toEqual(['r1', 'r3'])
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ kind: 'node', parentId: 'fld1', index: 1, location: 'Shop / Orders' })
    expect(trash.restoreFromTrash(entries()[0].id)).toBe(true)
    expect(childIds('fld1')).toEqual(['r1', 'r2', 'r3'])
    expect(entries()).toHaveLength(0)
  })

  it('restores into a fallback collection when the parent is gone too', () => {
    trash.trashNode('r1')
    const reqEntry = entries()[0].id
    trash.trashNode('fld1')
    expect(trash.restoreFromTrash(reqEntry)).toBe(true)
    const restored = C().doc.collections.find((c) => c.name === 'Восстановленное')
    expect(restored?.children.map((c) => c.id)).toEqual(['r1'])
  })

  it('gives fresh ids when the old ones are taken again', () => {
    trash.trashNode('r1')
    const id = entries()[0].id
    C().addRequest('fld1', { ...collections.emptyRequest('r1'), id: 'r1' })
    trash.restoreFromTrash(id)
    const ids = childIds('fld1')!
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })

  it('brings an environment back, active again if nothing else is', () => {
    trash.trashEnvironment('env1')
    expect(E().env.environments.map((e) => e.id)).toEqual(['env2'])
    expect(E().env.activeEnvironmentId).toBeNull()
    trash.restoreFromTrash(entries()[0].id)
    expect(E().env.environments.map((e) => e.id)).toEqual(['env1', 'env2'])
    expect(E().env.activeEnvironmentId).toBe('env1')
  })

  it('restores a variable to its environment, or to the globals once that is gone', () => {
    const env = E().env.environments[0]
    const v = env.variables[0]
    E().setEnvVars('env1', env.variables.slice(1))
    trash.trashVariable('environment', 'env1', v, 0, 'Dev')
    trash.restoreFromTrash(entries()[0].id)
    expect(E().env.environments[0].variables.map((x) => x.key)).toEqual(['base', 'token'])

    trash.trashVariable('environment', 'env-missing', { key: 'lost', value: '1', enabled: true }, 0)
    trash.restoreFromTrash(entries()[0].id)
    expect(E().globals.variables.map((x) => x.key)).toEqual(['lost'])
  })

  it('does not keep blank variable rows', () => {
    trash.trashVariable('global', null, { key: '', value: '', enabled: true }, 0)
    expect(entries()).toHaveLength(0)
  })

  it('restores the cleared history', () => {
    const h = (id: string, at: number) => ({ id, at, method: 'GET' as const, url: id, status: 200, ok: true, timeMs: 1, sizeBytes: 1, request: collections.emptyRequest() })
    history.useHistory.getState().setAll([h('a', 3), h('b', 1)])
    trash.trashHistory()
    expect(history.useHistory.getState().doc.entries).toHaveLength(0)
    history.useHistory.getState().add(h('c', 5), 100)
    trash.restoreFromTrash(entries()[0].id)
    expect(history.useHistory.getState().doc.entries.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('forgets entries past the retention window', () => {
    const old = { id: 'old', kind: 'history' as const, entries: [], name: 'x', deletedAt: Date.now() - 40 * 86400000 }
    const fresh = { ...old, id: 'fresh', deletedAt: Date.now() }
    expect(trashStore.keepFresh([old, fresh]).map((e) => e.id)).toEqual(['fresh'])
  })
})

import { describe, expect, it } from 'vitest'
import type { CollectionFolderNode, Environment, HistoryEntry, VariableDef } from '@shared/types'
import { base64ToBytes, bytesToBase64, describeSnapshot, fromJson, fromZip, toJson, toZip, type WorkspaceSnapshot } from './backup'

function snapshot(): WorkspaceSnapshot {
  const collections: CollectionFolderNode[] = [
    {
      id: 'col_1',
      type: 'collection',
      name: 'Acme API',
      children: [
        {
          id: 'req_1',
          type: 'request',
          request: {
            id: 'req_1',
            name: 'List items',
            method: 'GET',
            url: '{{base}}/items',
            query: [],
            headers: [],
            pathVariables: [],
            body: { type: 'none' },
            auth: { type: 'inherit' }
          }
        },
        {
          id: 'fld_1',
          type: 'folder',
          name: 'Admin',
          children: [
            {
              id: 'req_2',
              type: 'request',
              request: {
                id: 'req_2',
                name: 'Delete item',
                method: 'DELETE',
                url: '{{base}}/items/1',
                query: [],
                headers: [],
                pathVariables: [],
                body: { type: 'none' },
                auth: { type: 'inherit' }
              }
            }
          ]
        }
      ]
    }
  ]
  const environments: Environment[] = [
    { id: 'env_1', name: 'Prod', variables: [{ key: 'base', value: 'https://api.acme.com', enabled: true }] }
  ]
  const globals: VariableDef[] = [{ key: 'ua', value: 'relay', enabled: true }]
  const history: HistoryEntry[] = [
    {
      id: 'h1',
      at: 1_700_000_000_000,
      method: 'GET',
      url: 'https://api.acme.com/items',
      status: 200,
      ok: true,
      timeMs: 42,
      sizeBytes: 10,
      request: {
        id: 'req_1',
        name: 'List items',
        method: 'GET',
        url: '{{base}}/items',
        query: [],
        headers: [],
        pathVariables: [],
        body: { type: 'none' },
        auth: { type: 'inherit' }
      }
    }
  ]
  return { collections, environments, activeEnvironmentId: 'env_1', globals, history }
}

describe('backup formats', () => {
  it('round-trips a workspace through JSON', () => {
    const restored = fromJson(toJson(snapshot()))
    expect(restored).toEqual(snapshot())
  })

  it('round-trips a workspace through ZIP', () => {
    const restored = fromZip(toZip(snapshot()))
    expect(restored).toEqual(snapshot())
  })

  it('accepts a bare snapshot without the envelope', () => {
    const restored = fromJson(JSON.stringify(snapshot()))
    expect(restored.collections).toHaveLength(1)
    expect(restored.environments[0].name).toBe('Prod')
  })

  it('rejects a file that is not a Relay backup', () => {
    expect(() => fromJson('{"hello":"world"}')).toThrow()
    expect(() => fromZip(toZip(snapshot()).slice(0, 8))).toThrow()
  })

  it('fills in parts an older backup does not carry', () => {
    const restored = fromJson(JSON.stringify({ collections: [] }))
    expect(restored).toEqual({ collections: [], environments: [], activeEnvironmentId: null, globals: [], history: [] })
  })

  it('counts what a snapshot holds, requests nested in folders included', () => {
    expect(describeSnapshot(snapshot())).toEqual({ collections: 1, requests: 2, environments: 1, history: 1 })
  })

  it('survives base64 in both directions (binary formats go through the save dialog)', () => {
    const bytes = toZip(snapshot())
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

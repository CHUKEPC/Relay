/**
 * GraphQL introspection tests — a real node:http server on 127.0.0.1 with an
 * ephemeral port, so the whole request path (POST body, headers, error mapping)
 * is exercised offline.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { introspectGraphql } from './index'

const SCHEMA = {
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types: [
        {
          kind: 'OBJECT',
          name: 'Query',
          description: 'Root query',
          fields: [
            {
              name: 'user',
              description: 'one user',
              args: [{ name: 'id', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID', ofType: null } } }],
              type: { kind: 'OBJECT', name: 'User', ofType: null }
            }
          ]
        },
        {
          kind: 'OBJECT',
          name: 'User',
          description: null,
          fields: [
            {
              name: 'tags',
              description: null,
              args: [],
              type: {
                kind: 'LIST',
                name: null,
                ofType: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'String', ofType: null } }
              }
            }
          ]
        },
        { kind: 'SCALAR', name: 'ID', description: null, fields: null }
      ]
    }
  }
}

let server: Server | null = null

function start(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => handler(req, res, body))
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
  }
})

describe('introspectGraphql', () => {
  it('posts the introspection query and flattens the schema', async () => {
    let seenHeaders: Record<string, unknown> = {}
    let seenBody = ''
    let seenMethod = ''
    const port = await start((req, res, body) => {
      seenHeaders = req.headers
      seenBody = body
      seenMethod = req.method ?? ''
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(SCHEMA))
    })

    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [{ key: 'x-relay', value: 'gql' }], true)
    expect(res.ok).toBe(true)
    // `GraphqlIntrospectResult` is not a discriminated union, so narrow by hand.
    const schema = res.schema!
    expect(schema).toBeDefined()

    expect(seenMethod).toBe('POST')
    expect(seenHeaders['content-type']).toBe('application/json')
    expect(seenHeaders['x-relay']).toBe('gql')
    const parsed = JSON.parse(seenBody) as { query: string; operationName: string }
    expect(parsed.operationName).toBe('IntrospectionQuery')
    expect(parsed.query).toContain('__schema')

    expect(schema.queryType).toBe('Query')
    expect(schema.mutationType).toBe('Mutation')
    expect(schema.subscriptionType).toBeUndefined()
    const query = schema.types.find((t) => t.name === 'Query')!
    expect(query.description).toBe('Root query')
    expect(query.fields[0]).toMatchObject({ name: 'user', type: 'User' })
    expect(query.fields[0].args).toEqual([{ name: 'id', type: 'ID!' }])
    const user = schema.types.find((t) => t.name === 'User')!
    expect(user.fields[0].type).toBe('[String!]')
    const scalar = schema.types.find((t) => t.name === 'ID')!
    expect(scalar.fields).toEqual([])
  })

  it('returns the GraphQL errors array as a structured error', async () => {
    const port = await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ message: 'introspection disabled' }, { message: 'nope' }] }))
    })
    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [], true)
    expect(res).toEqual({ ok: false, error: 'introspection disabled; nope' })
  })

  it('reports a non-JSON response with its status', async () => {
    const port = await start((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>not graphql</html>')
    })
    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [], true)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('Non-JSON response (HTTP 200)')
  })

  it('reports an HTTP error status when the payload carries no schema', async () => {
    const port = await start((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'boom' }))
    })
    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [], true)
    expect(res).toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('follows a redirect to the real endpoint', async () => {
    const replayed: { method: string; body: string }[] = []
    const port = await start((req, res, body) => {
      if (req.url === '/graphql') {
        res.writeHead(308, { location: '/api/graphql' })
        res.end()
        return
      }
      replayed.push({ method: req.method ?? '', body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(SCHEMA))
    })
    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [], true)
    expect(res.ok).toBe(true)
    expect(replayed).toHaveLength(1)
    expect(replayed[0].method).toBe('POST')
    expect(replayed[0].body).toContain('IntrospectionQuery')
  })

  it('rejects a non-http(s) URL', async () => {
    const res = await introspectGraphql('ws://127.0.0.1:1/graphql', [], true)
    expect(res.ok).toBe(false)
  })

  it('returns an error (never throws) for an unreachable endpoint', async () => {
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((r) => probe.close(() => r()))
    const res = await introspectGraphql(`http://127.0.0.1:${port}/graphql`, [], true)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/ECONNREFUSED|connect/i)
  })
})

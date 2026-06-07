import { describe, it, expect } from 'vitest'
import { importData } from './index'

function allRequests(node: any, out: any[] = []): any[] {
  for (const c of node.children ?? []) {
    if (c.type === 'request') out.push(c.request)
    else allRequests(c, out)
  }
  return out
}

const OPENAPI_YAML = `
openapi: 3.0.0
info:
  title: YAML API
  version: 1.0.0
servers:
  - url: https://yaml.test/api
paths:
  /things:
    get:
      tags: [things]
      summary: List things
    post:
      tags: [things]
      summary: Create thing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
`

const SWAGGER_YAML = `
swagger: "2.0"
info:
  title: Swagger YAML
  version: 1.0.0
host: swagger.test
basePath: /v1
schemes:
  - https
paths:
  /ping:
    get:
      tags: [health]
      summary: Ping
`

describe('importData dispatch (auto detection)', () => {
  it('parses an OpenAPI 3 YAML document', () => {
    const results = importData('auto', OPENAPI_YAML)
    const col = results.find((r) => r.kind === 'collection')!.collection!
    expect(allRequests(col)).toHaveLength(2)
    const env = results.find((r) => r.kind === 'environment')!.environment!
    expect(env.variables[0]).toMatchObject({ key: 'base_url', value: 'https://yaml.test/api' })
  })

  it('parses a Swagger 2.0 YAML document', () => {
    const results = importData('auto', SWAGGER_YAML)
    const col = results.find((r) => r.kind === 'collection')!.collection!
    const reqs = allRequests(col)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].url).toBe('{{base_url}}/ping')
    const env = results.find((r) => r.kind === 'environment')!.environment!
    expect(env.variables[0]).toMatchObject({ key: 'base_url', value: 'https://swagger.test/v1' })
  })

  it('auto-detects a HAR document', () => {
    const har = JSON.stringify({ log: { entries: [{ request: { method: 'GET', url: 'https://h.test/x' } }] } })
    const results = importData('auto', har)
    expect(results[0].collection!.name).toBe('Imported (HAR)')
    expect(allRequests(results[0].collection!)).toHaveLength(1)
  })

  it('auto-detects an Insomnia export', () => {
    const ins = JSON.stringify({
      _type: 'export',
      resources: [
        { _id: 'w', _type: 'workspace', name: 'W', parentId: null },
        { _id: 'r', _type: 'request', name: 'R', parentId: 'w', method: 'GET', url: 'https://i.test/x' }
      ]
    })
    const results = importData('auto', ins)
    expect(results[0].collection!.name).toBe('W')
    expect(allRequests(results[0].collection!)).toHaveLength(1)
  })

  it('honors an explicit swagger kind for YAML', () => {
    const results = importData('swagger', SWAGGER_YAML)
    expect(allRequests(results[0].collection!)).toHaveLength(1)
  })
})

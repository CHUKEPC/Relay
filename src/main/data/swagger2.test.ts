import { describe, it, expect } from 'vitest'
import { importSwagger2, isSwagger2 } from './swagger2'
import { importOpenApi } from './openapi'

function allRequests(node: any, out: any[] = []): any[] {
  for (const c of node.children ?? []) {
    if (c.type === 'request') out.push(c.request)
    else allRequests(c, out)
  }
  return out
}

function findFolder(node: any, name: string): any {
  return (node.children ?? []).find((c: any) => c.type === 'folder' && c.name === name)
}

const SWAGGER: any = {
  swagger: '2.0',
  info: { title: 'Pet Store', version: '1.0' },
  host: 'petstore.test',
  basePath: '/v2',
  schemes: ['https', 'http'],
  consumes: ['application/json'],
  definitions: {
    Pet: {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } }
    }
  },
  paths: {
    '/pets': {
      get: {
        tags: ['pets'],
        summary: 'List pets',
        parameters: [{ name: 'limit', in: 'query', type: 'integer', required: false }]
      },
      post: {
        tags: ['pets'],
        summary: 'Create pet',
        parameters: [{ name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Pet' } }]
      }
    },
    '/pets/{petId}': {
      get: {
        tags: ['pets'],
        summary: 'Get pet',
        parameters: [{ name: 'petId', in: 'path', required: true, type: 'integer' }]
      }
    }
  }
}

describe('Swagger 2.0 import', () => {
  it('detects a swagger:"2.0" document', () => {
    expect(isSwagger2(SWAGGER)).toBe(true)
    expect(isSwagger2({ swagger: '2.0' })).toBe(true)
    expect(isSwagger2({ openapi: '3.0.0' })).toBe(false)
    expect(isSwagger2({ swagger: '1.2' })).toBe(false) // 1.x is not Swagger 2.0
  })

  it('imports the expected number of requests', () => {
    const { collection } = importSwagger2(SWAGGER)
    expect(allRequests(collection)).toHaveLength(3)
  })

  it('builds {{base_url}} urls and an environment from scheme+host+basePath', () => {
    const { collection, environment } = importSwagger2(SWAGGER)
    const reqs = allRequests(collection)
    const list = reqs.find((r) => r.name === 'List pets')
    expect(list.method).toBe('GET')
    expect(list.url).toBe('{{base_url}}/pets')

    const getOne = reqs.find((r) => r.name === 'Get pet')
    expect(getOne.url).toBe('{{base_url}}/pets/:petId')

    expect(environment?.variables[0]).toEqual({ key: 'base_url', value: 'https://petstore.test/v2', enabled: true })
  })

  it('groups by tag into folders', () => {
    const { collection } = importSwagger2(SWAGGER)
    const folder = findFolder(collection, 'pets')
    expect(folder).toBeTruthy()
    expect(folder.children).toHaveLength(3)
  })

  it('imports a body parameter ($ref) as a sampled json raw body', () => {
    const { collection } = importSwagger2(SWAGGER)
    const create = allRequests(collection).find((r) => r.name === 'Create pet')
    expect(create.method).toBe('POST')
    expect(create.body.type).toBe('raw')
    expect(create.body.language).toBe('json')
    const sample = JSON.parse(create.body.text)
    expect(sample).toHaveProperty('name')
    expect(create.headers.some((h: any) => h.key === 'Content-Type' && h.value === 'application/json')).toBe(true)
  })

  it('is reachable through importOpenApi (delegation by swagger version)', () => {
    const { collection } = importOpenApi(SWAGGER)
    expect(allRequests(collection)).toHaveLength(3)
  })
})

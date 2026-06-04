/**
 * OpenAPI 3.x → collection importer. Paths become requests, grouped by tag.
 * The first server URL becomes a {{base_url}} environment variable.
 */
import { makeId } from '@shared/id'
import type {
  CollectionFolderNode,
  CollectionNode,
  Environment,
  KV,
  RequestBody,
  RequestModel
} from '@shared/types'

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

function resolveRef(doc: any, node: any, depth = 0): any {
  if (!node || depth > 20) return node
  if (node.$ref && typeof node.$ref === 'string') {
    const path = node.$ref.replace(/^#\//, '').split('/')
    let cur = doc
    for (const seg of path) cur = cur?.[seg]
    return resolveRef(doc, cur, depth + 1)
  }
  return node
}

function sampleFromSchema(doc: any, schema: any, depth = 0): unknown {
  schema = resolveRef(doc, schema, depth)
  if (!schema || depth > 8) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const type = schema.type ?? (schema.properties ? 'object' : undefined)
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      const props = schema.properties ?? {}
      for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(doc, v, depth + 1)
      return out
    }
    case 'array':
      return [sampleFromSchema(doc, schema.items, depth + 1)]
    case 'string':
      return schema.format === 'date-time' ? new Date(0).toISOString() : 'string'
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    default:
      return null
  }
}

function operationToRequest(doc: any, path: string, method: string, op: any): RequestModel {
  const query: KV[] = []
  const headers: KV[] = []
  const pathVariables: KV[] = []

  const params = [...(op.parameters ?? [])].map((p) => resolveRef(doc, p))
  for (const p of params) {
    if (!p?.name) continue
    const entry: KV = {
      key: p.name,
      value: p.example != null ? String(p.example) : p.schema?.default != null ? String(p.schema.default) : '',
      enabled: p.required === true,
      description: p.description
    }
    if (p.in === 'query') query.push(entry)
    else if (p.in === 'header') headers.push({ ...entry, enabled: true })
    else if (p.in === 'path') pathVariables.push({ ...entry, enabled: true })
  }

  let body: RequestBody = { type: 'none' }
  const content = op.requestBody?.content
  if (content) {
    if (content['application/json']) {
      const sample = sampleFromSchema(doc, content['application/json'].schema)
      body = { type: 'raw', language: 'json', text: JSON.stringify(sample, null, 2) }
      headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
    } else if (content['application/x-www-form-urlencoded']) {
      const schema = resolveRef(doc, content['application/x-www-form-urlencoded'].schema)
      const items = Object.keys(schema?.properties ?? {}).map((k) => ({ key: k, value: '', enabled: true }))
      body = { type: 'urlencoded', items }
    } else if (content['multipart/form-data']) {
      const schema = resolveRef(doc, content['multipart/form-data'].schema)
      const items = Object.keys(schema?.properties ?? {}).map((k) => ({ key: k, type: 'text' as const, value: '', enabled: true }))
      body = { type: 'formdata', items }
    }
  }

  // OpenAPI {param} → Relay :param
  const relayPath = path.replace(/\{([^}]+)\}/g, ':$1')

  return {
    id: makeId('req'),
    name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase() as RequestModel['method'],
    url: `{{base_url}}${relayPath}`,
    query,
    headers,
    pathVariables,
    body,
    auth: { type: 'inherit' },
    description: op.description
  }
}

export interface OpenApiImportResult {
  collection: CollectionFolderNode
  environment?: Environment
  warnings: string[]
}

export function importOpenApi(doc: any): OpenApiImportResult {
  const warnings: string[] = []
  const title = doc.info?.title ?? 'OpenAPI import'

  // Group by tag.
  const folders = new Map<string, CollectionNode[]>()
  const rootItems: CollectionNode[] = []

  for (const [path, pathItem] of Object.entries<any>(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = pathItem?.[method]
      if (!op) continue
      const request = operationToRequest(doc, path, method, op)
      const node: CollectionNode = { id: request.id, type: 'request', request }
      const tag = Array.isArray(op.tags) && op.tags.length ? op.tags[0] : ''
      if (tag) {
        if (!folders.has(tag)) folders.set(tag, [])
        folders.get(tag)!.push(node)
      } else {
        rootItems.push(node)
      }
    }
  }

  const children: CollectionNode[] = [...rootItems]
  for (const [tag, items] of folders) {
    children.push({ id: makeId('fld'), type: 'folder', name: tag, children: items })
  }

  const collection: CollectionFolderNode = {
    id: makeId('col'),
    type: 'collection',
    name: title,
    description: typeof doc.info?.description === 'string' ? doc.info.description : undefined,
    children
  }

  // Server → environment
  let environment: Environment | undefined
  const server = Array.isArray(doc.servers) && doc.servers.length ? doc.servers[0] : null
  if (server?.url) {
    let url: string = server.url
    for (const [k, v] of Object.entries<any>(server.variables ?? {})) {
      url = url.replace(new RegExp(`\\{${k}\\}`, 'g'), v.default ?? '')
    }
    environment = {
      id: makeId('env'),
      name: `${title} server`,
      variables: [{ key: 'base_url', value: url.replace(/\/$/, ''), enabled: true }]
    }
  } else {
    warnings.push('No servers[] found — set {{base_url}} manually.')
  }

  return { collection, environment, warnings }
}

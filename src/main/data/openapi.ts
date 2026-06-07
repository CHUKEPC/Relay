/**
 * OpenAPI 3.x → collection importer. Paths become requests, grouped by tag.
 * The first server URL becomes a {{base_url}} environment variable.
 */
import { makeId } from '@shared/id'
import { escapeRegExp } from '@shared/regex'
import { importSwagger2 } from './swagger2'
import type {
  CollectionFolderNode,
  CollectionNode,
  Environment,
  KV,
  RawLanguage,
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
      // Null-prototype so a schema property literally named `__proto__` is stored
      // as an own key (and round-trips) instead of reassigning the object's prototype.
      const out: Record<string, unknown> = Object.create(null)
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

function operationToRequest(doc: any, path: string, method: string, op: any, warnings: string[]): RequestModel {
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
    } else {
      // Any other content type (xml, text, octet-stream, ...) — import the first
      // declared one as raw instead of silently dropping the body.
      const firstType = Object.keys(content)[0]
      if (firstType) {
        const sample = sampleFromSchema(doc, content[firstType].schema)
        const language: RawLanguage = firstType.includes('xml')
          ? 'xml'
          : firstType.includes('json')
            ? 'json'
            : firstType.includes('html')
              ? 'html'
              : 'text'
        const text = typeof sample === 'string' ? sample : sample == null ? '' : JSON.stringify(sample, null, 2)
        body = { type: 'raw', language, text }
        headers.push({ key: 'Content-Type', value: firstType, enabled: true })
        warnings.push(`Imported "${method.toUpperCase()} ${path}" body as raw (${firstType}).`)
      }
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
  // A Swagger 2.0 document has a fundamentally different shape (host/basePath/
  // schemes, body/formData params, #/definitions). Delegate to the dedicated
  // importer so callers can feed either spec version through one entry point.
  if (typeof doc?.swagger === 'string' && doc.swagger.startsWith('2')) {
    return importSwagger2(doc)
  }
  const warnings: string[] = []
  const title = doc.info?.title ?? 'OpenAPI import'

  // Group by tag.
  const folders = new Map<string, CollectionNode[]>()
  const rootItems: CollectionNode[] = []

  for (const [path, pathItem] of Object.entries<any>(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = pathItem?.[method]
      if (!op) continue
      const request = operationToRequest(doc, path, method, op, warnings)
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
      url = url.replace(new RegExp(`\\{${escapeRegExp(k)}\\}`, 'g'), () => v.default ?? '')
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

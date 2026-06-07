/**
 * Swagger 2.0 (OpenAPI 2.0) → collection importer.
 *
 * Differences from OpenAPI 3.x (handled in ./openapi.ts):
 *  - base URL is assembled from `schemes[0] + host + basePath` (no servers[]).
 *  - request bodies are declared as `body`/`formData` parameters, not requestBody.
 *  - reusable schemas live under `#/definitions/...` (not components/schemas).
 *  - `produces`/`consumes` drive the Content-Type instead of content maps.
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

/** Build a sample JSON value from a Swagger 2.0 schema (definitions-aware). */
function sampleFromSchema(doc: any, schema: any, depth = 0): unknown {
  schema = resolveRef(doc, schema, depth)
  if (!schema || depth > 8) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const type = schema.type ?? (schema.properties ? 'object' : undefined)
  switch (type) {
    case 'object': {
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

/** A non-body, non-formData primitive parameter → a string sample value. */
function paramSample(p: any): string {
  if (p.example != null) return String(p.example)
  if (p.default != null) return String(p.default)
  if (Array.isArray(p.enum) && p.enum.length) return String(p.enum[0])
  return ''
}

function operationToRequest(
  doc: any,
  path: string,
  method: string,
  op: any,
  inheritedParams: any[],
  globalConsumes: string[],
  warnings: string[]
): RequestModel {
  const query: KV[] = []
  const headers: KV[] = []
  const pathVariables: KV[] = []
  let body: RequestBody = { type: 'none' }
  const formItems: KV[] = []
  let hasFormData = false

  // Path-level parameters are inherited by each operation; the operation's own
  // params override matching (name+in) entries.
  const merged = new Map<string, any>()
  for (const raw of [...inheritedParams, ...(op.parameters ?? [])]) {
    const p = resolveRef(doc, raw)
    if (!p?.name && p?.in !== 'body') continue
    merged.set(`${p.in}:${p.name ?? 'body'}`, p)
  }

  const consumes: string[] = Array.isArray(op.consumes) ? op.consumes : globalConsumes

  for (const p of merged.values()) {
    const entry: KV = {
      key: p.name,
      value: paramSample(p),
      enabled: p.required === true,
      description: p.description
    }
    switch (p.in) {
      case 'query':
        query.push(entry)
        break
      case 'header':
        headers.push({ ...entry, enabled: true })
        break
      case 'path':
        pathVariables.push({ ...entry, enabled: true })
        break
      case 'body': {
        const sample = sampleFromSchema(doc, p.schema)
        body = { type: 'raw', language: 'json', text: JSON.stringify(sample, null, 2) }
        const ct = consumes.find((c) => c.includes('json')) ?? 'application/json'
        headers.push({ key: 'Content-Type', value: ct, enabled: true })
        break
      }
      case 'formData':
        hasFormData = true
        formItems.push({ key: p.name, value: '', enabled: p.required === true })
        break
      default:
        break
    }
  }

  // formData parameters → urlencoded or multipart depending on `consumes`.
  if (hasFormData && body.type === 'none') {
    if (consumes.some((c) => c.includes('multipart'))) {
      body = { type: 'formdata', items: formItems.map((i) => ({ key: i.key, type: 'text', value: '', enabled: i.enabled })) }
    } else {
      body = { type: 'urlencoded', items: formItems }
    }
  }

  // Swagger {param} → Relay :param
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

export interface Swagger2ImportResult {
  collection: CollectionFolderNode
  environment?: Environment
  warnings: string[]
}

export function isSwagger2(doc: any): boolean {
  return !!doc && typeof doc === 'object' && typeof doc.swagger === 'string' && doc.swagger.startsWith('2')
}

export function importSwagger2(doc: any): Swagger2ImportResult {
  const warnings: string[] = []
  const title = doc.info?.title ?? 'Swagger import'
  const globalConsumes: string[] = Array.isArray(doc.consumes) ? doc.consumes : []

  const folders = new Map<string, CollectionNode[]>()
  const rootItems: CollectionNode[] = []

  for (const [path, pathItem] of Object.entries<any>(doc.paths ?? {})) {
    if (!pathItem) continue
    const inheritedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const method of METHODS) {
      const op = pathItem[method]
      if (!op) continue
      const request = operationToRequest(doc, path, method, op, inheritedParams, globalConsumes, warnings)
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

  // Base URL from scheme + host + basePath.
  let environment: Environment | undefined
  const host: string = typeof doc.host === 'string' ? doc.host : ''
  const basePath: string = typeof doc.basePath === 'string' ? doc.basePath : ''
  if (host) {
    const schemes: string[] = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes : ['https']
    const scheme = schemes.includes('https') ? 'https' : schemes[0]
    const base = `${scheme}://${host}${basePath}`.replace(/\/$/, '')
    environment = {
      id: makeId('env'),
      name: `${title} server`,
      variables: [{ key: 'base_url', value: base, enabled: true }]
    }
  } else {
    warnings.push('No host found — set {{base_url}} manually.')
  }

  return { collection, environment, warnings }
}

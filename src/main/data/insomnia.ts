/**
 * Insomnia v4 export → collection importer.
 *
 * The export doc has `_type: "export"` and a flat `resources[]` array. Each
 * resource carries a `_type` of "workspace" | "request_group" | "request"
 * (plus environments/cookie jars we ignore here) and a `parentId` linking it to
 * its container. We rebuild the tree from those parent links: the workspace
 * becomes the collection root, request_groups become folders, requests leaves.
 */
import { makeId } from '@shared/id'
import type {
  Auth,
  CollectionFolderNode,
  CollectionNode,
  KV,
  RawLanguage,
  RequestBody,
  RequestModel
} from '@shared/types'

interface InsoNode {
  id: string
  parentId: string | null
  resource: any
  type: 'workspace' | 'request_group' | 'request'
  children: InsoNode[]
}

function headersToKV(headers: any): KV[] {
  if (!Array.isArray(headers)) return []
  return headers
    .filter((h) => h && typeof h.name === 'string')
    .map((h) => ({
      key: h.name,
      value: typeof h.value === 'string' ? h.value : '',
      enabled: h.disabled !== true
    }))
}

function paramsToKV(params: any): KV[] {
  if (!Array.isArray(params)) return []
  return params
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({
      key: p.name,
      value: typeof p.value === 'string' ? p.value : '',
      enabled: p.disabled !== true
    }))
}

function langForMime(mime: string): RawLanguage {
  const m = (mime ?? '').toLowerCase()
  if (m.includes('json')) return 'json'
  if (m.includes('xml')) return 'xml'
  if (m.includes('html')) return 'html'
  if (m.includes('javascript')) return 'javascript'
  return 'text'
}

function importBody(body: any): RequestBody {
  if (!body || typeof body !== 'object') return { type: 'none' }
  const mime: string = typeof body.mimeType === 'string' ? body.mimeType : ''

  // GraphQL is sent as application/json with a {query, variables} text payload.
  if (mime.includes('graphql')) {
    let query = ''
    let variables = '{}'
    try {
      const parsed = JSON.parse(typeof body.text === 'string' ? body.text : '{}')
      query = typeof parsed.query === 'string' ? parsed.query : ''
      variables = parsed.variables != null ? JSON.stringify(parsed.variables, null, 2) : '{}'
    } catch {
      query = typeof body.text === 'string' ? body.text : ''
    }
    return { type: 'graphql', query, variables }
  }

  if (mime.includes('x-www-form-urlencoded')) {
    return { type: 'urlencoded', items: paramsToKV(body.params) }
  }

  if (mime.includes('multipart')) {
    const items = (Array.isArray(body.params) ? body.params : []).map((p: any) => ({
      key: typeof p?.name === 'string' ? p.name : '',
      type: p?.type === 'file' ? ('file' as const) : ('text' as const),
      value: p?.type === 'file' ? '' : typeof p?.value === 'string' ? p.value : '',
      filePath: p?.type === 'file' ? (typeof p?.fileName === 'string' ? p.fileName : undefined) : undefined,
      enabled: p?.disabled !== true
    }))
    return { type: 'formdata', items }
  }

  if (typeof body.fileName === 'string' && body.fileName) {
    return { type: 'binary', filePath: body.fileName }
  }

  if (typeof body.text === 'string' && body.text.length) {
    return { type: 'raw', language: langForMime(mime), text: body.text }
  }
  return { type: 'none' }
}

function importAuth(a: any): Auth {
  if (!a || typeof a !== 'object' || a.disabled === true) return { type: 'inherit' }
  switch (a.type) {
    case 'bearer':
      return { type: 'bearer', token: typeof a.token === 'string' ? a.token : '' }
    case 'basic':
      return {
        type: 'basic',
        username: typeof a.username === 'string' ? a.username : '',
        password: typeof a.password === 'string' ? a.password : ''
      }
    case 'digest':
      return {
        type: 'digest',
        username: typeof a.username === 'string' ? a.username : '',
        password: typeof a.password === 'string' ? a.password : ''
      }
    case 'apikey':
      return {
        type: 'apikey',
        key: typeof a.key === 'string' ? a.key : '',
        value: typeof a.value === 'string' ? a.value : '',
        addTo: a.addTo === 'queryParams' || a.addTo === 'query' ? 'query' : 'header'
      }
    case 'oauth2':
      return {
        type: 'oauth2',
        grant:
          a.grantType === 'authorization_code'
            ? 'authorization_code'
            : a.grantType === 'password'
              ? 'password'
              : 'client_credentials',
        accessToken: typeof a.accessToken === 'string' ? a.accessToken : '',
        headerPrefix: 'Bearer',
        tokenUrl: typeof a.accessTokenUrl === 'string' ? a.accessTokenUrl : undefined,
        authUrl: typeof a.authorizationUrl === 'string' ? a.authorizationUrl : undefined,
        clientId: typeof a.clientId === 'string' ? a.clientId : undefined,
        clientSecret: typeof a.clientSecret === 'string' ? a.clientSecret : undefined,
        scope: typeof a.scope === 'string' ? a.scope : undefined
      }
    default:
      return { type: 'inherit' }
  }
}

/** Insomnia uses {{ _.var }} / {{var}} templating — leave it as-is; Relay's own
 *  {{var}} resolution handles the common case. Only the URL needs the query
 *  split off, since Relay carries query params separately. */
function splitUrl(url: string): { base: string; query: KV[] } {
  if (typeof url !== 'string') return { base: '', query: [] }
  const qi = url.indexOf('?')
  if (qi < 0) return { base: url, query: [] }
  const base = url.slice(0, qi)
  const query: KV[] = url
    .slice(qi + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return {
        key: eq >= 0 ? decodeURIComponent(pair.slice(0, eq)) : pair,
        value: eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '',
        enabled: true
      }
    })
  return { base, query }
}

function requestToModel(res: any): RequestModel {
  const { base, query } = splitUrl(typeof res.url === 'string' ? res.url : '')
  const structuredQuery = paramsToKV(res.parameters)
  return {
    id: makeId('req'),
    name: typeof res.name === 'string' ? res.name : 'Request',
    method: (typeof res.method === 'string' ? res.method : 'GET').toUpperCase() as RequestModel['method'],
    url: base,
    // Prefer the structured parameters[] (Insomnia's canonical query store); fall
    // back to params parsed out of the URL when parameters[] is empty.
    query: structuredQuery.length ? structuredQuery : query,
    headers: headersToKV(res.headers),
    pathVariables: [],
    body: importBody(res.body),
    auth: importAuth(res.authentication),
    description: typeof res.description === 'string' ? res.description : undefined
  }
}

function nodeToCollection(node: InsoNode, isRoot: boolean): CollectionNode {
  if (node.type === 'request') {
    return { id: node.id, type: 'request', request: requestToModel(node.resource) }
  }
  // Sort children by Insonmia's metaSortKey when present for stable ordering.
  const sorted = [...node.children].sort((a, b) => {
    const ka = typeof a.resource?.metaSortKey === 'number' ? a.resource.metaSortKey : 0
    const kb = typeof b.resource?.metaSortKey === 'number' ? b.resource.metaSortKey : 0
    return ka - kb
  })
  const children = sorted.map((c) => nodeToCollection(c, false))
  return {
    id: node.id,
    type: isRoot ? 'collection' : 'folder',
    name: typeof node.resource?.name === 'string' ? node.resource.name : isRoot ? 'Imported (Insomnia)' : 'Folder',
    description: typeof node.resource?.description === 'string' ? node.resource.description : undefined,
    children
  }
}

export interface InsomniaImportResult {
  collections: CollectionFolderNode[]
  warnings: string[]
}

export function isInsomniaExport(doc: any): boolean {
  return !!doc && typeof doc === 'object' && doc._type === 'export' && Array.isArray(doc.resources)
}

export function importInsomnia(doc: any): InsomniaImportResult {
  const warnings: string[] = []
  const resources: any[] = Array.isArray(doc?.resources) ? doc.resources : []

  // Build a node for each workspace / request_group / request, keyed by _id.
  const nodes = new Map<string, InsoNode>()
  for (const res of resources) {
    if (!res || typeof res._id !== 'string') continue
    let type: InsoNode['type'] | null = null
    if (res._type === 'workspace') type = 'workspace'
    else if (res._type === 'request_group') type = 'request_group'
    else if (res._type === 'request') type = 'request'
    if (!type) continue
    nodes.set(res._id, {
      id: makeId(type === 'request' ? 'req' : type === 'workspace' ? 'col' : 'fld'),
      parentId: typeof res.parentId === 'string' ? res.parentId : null,
      resource: res,
      type,
      children: []
    })
  }

  // Wire parent → children using the original Insomnia ids.
  const byOriginalId = new Map<string, InsoNode>()
  for (const res of resources) {
    if (res && typeof res._id === 'string' && nodes.has(res._id)) {
      byOriginalId.set(res._id, nodes.get(res._id)!)
    }
  }
  const roots: InsoNode[] = []
  for (const res of resources) {
    if (!res || typeof res._id !== 'string') continue
    const node = byOriginalId.get(res._id)
    if (!node) continue
    const parent = node.parentId ? byOriginalId.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else if (node.type === 'workspace') roots.push(node)
    else if (!node.parentId) roots.push(node)
  }

  // If no workspace exists, synthesize a single root collection holding all
  // top-level groups/requests so nothing is dropped.
  let workspaceRoots = roots.filter((r) => r.type === 'workspace')
  if (workspaceRoots.length === 0) {
    const synthetic: InsoNode = {
      id: makeId('col'),
      parentId: null,
      resource: { name: 'Imported (Insomnia)' },
      type: 'workspace',
      children: roots
    }
    workspaceRoots = [synthetic]
  }

  const collections = workspaceRoots.map((root) => nodeToCollection(root, true) as CollectionFolderNode)
  return { collections, warnings }
}

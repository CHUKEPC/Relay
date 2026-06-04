/**
 * Postman Collection v2.1 import + export.
 */
import { makeId } from '@shared/id'
import type {
  Auth,
  CollectionFolderNode,
  CollectionNode,
  KV,
  OAuth2Grant,
  RequestBody,
  RequestModel
} from '@shared/types'

/* ---------------- helpers ---------------- */

function headerToKV(h: any): KV {
  return { key: h.key ?? '', value: h.value ?? '', enabled: h.disabled !== true, description: h.description }
}

function parseQueryString(qs: string): KV[] {
  if (!qs) return []
  return qs
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return { key: eq >= 0 ? pair.slice(0, eq) : pair, value: eq >= 0 ? pair.slice(eq + 1) : '', enabled: true }
    })
}

/**
 * Normalize a Postman url (string or object) into a base URL (NO query string)
 * plus parsed query and path variables. The base must exclude the query because
 * the model also carries `query[]`; keeping it in the URL would send/display the
 * params twice (engine appends query[] to the URL).
 */
function urlToString(url: any): { raw: string; query: KV[]; pathVars: KV[] } {
  if (typeof url === 'string') {
    const qi = url.indexOf('?')
    return {
      raw: qi >= 0 ? url.slice(0, qi) : url,
      query: qi >= 0 ? parseQueryString(url.slice(qi + 1)) : [],
      pathVars: []
    }
  }
  if (!url) return { raw: '', query: [], pathVars: [] }

  const query: KV[] = (url.query ?? []).map((q: any) => ({
    key: q.key ?? '',
    value: q.value ?? '',
    enabled: q.disabled !== true,
    description: q.description
  }))

  let base: string
  if (typeof url.raw === 'string') {
    const qi = url.raw.indexOf('?')
    base = qi >= 0 ? url.raw.slice(0, qi) : url.raw
    // Merge any raw query params not already represented in the structured array
    // (Postman lets raw carry params never synced into query[], incl. when query[]
    // holds only disabled entries) so active params aren't silently dropped.
    if (qi >= 0) {
      const seen = new Set(query.map((q) => q.key))
      for (const kv of parseQueryString(url.raw.slice(qi + 1))) {
        if (!seen.has(kv.key)) query.push(kv)
      }
    }
  } else {
    const protocol = url.protocol ? `${url.protocol}://` : ''
    const host = Array.isArray(url.host) ? url.host.join('.') : url.host ?? ''
    const port = url.port ? `:${url.port}` : ''
    const path = Array.isArray(url.path) ? '/' + url.path.join('/') : url.path ?? ''
    base = `${protocol}${host}${port}${path}`
  }

  const pathVars: KV[] = (url.variable ?? []).map((v: any) => ({
    key: v.key ?? '',
    value: v.value ?? '',
    enabled: true,
    description: v.description
  }))
  return { raw: base, query, pathVars }
}

function importAuth(a: any): Auth {
  if (!a || !a.type) return { type: 'inherit' }
  const pick = (arr: any[], key: string) => arr?.find((x) => x.key === key)?.value ?? ''
  switch (a.type) {
    case 'bearer':
      return { type: 'bearer', token: pick(a.bearer ?? [], 'token') }
    case 'basic':
      return { type: 'basic', username: pick(a.basic ?? [], 'username'), password: pick(a.basic ?? [], 'password') }
    case 'apikey': {
      const where = pick(a.apikey ?? [], 'in') || 'header'
      return { type: 'apikey', key: pick(a.apikey ?? [], 'key'), value: pick(a.apikey ?? [], 'value'), addTo: where === 'query' ? 'query' : 'header' }
    }
    case 'oauth2': {
      const o = a.oauth2 ?? []
      const g = pick(o, 'grant_type')
      const grant: OAuth2Grant =
        g === 'password_credentials' || g === 'password'
          ? 'password'
          : g === 'authorization_code'
            ? 'authorization_code'
            : 'client_credentials'
      return {
        type: 'oauth2',
        grant,
        accessToken: pick(o, 'accessToken'),
        headerPrefix: pick(o, 'headerPrefix') || 'Bearer',
        tokenUrl: pick(o, 'accessTokenUrl') || undefined,
        authUrl: pick(o, 'authUrl') || undefined,
        clientId: pick(o, 'clientId') || undefined,
        clientSecret: pick(o, 'clientSecret') || undefined,
        scope: pick(o, 'scope') || undefined
      }
    }
    case 'digest':
      return { type: 'digest', username: pick(a.digest ?? [], 'username'), password: pick(a.digest ?? [], 'password') }
    case 'noauth':
      return { type: 'none' }
    default:
      return { type: 'inherit' }
  }
}

function importBody(body: any): RequestBody {
  if (!body || !body.mode) return { type: 'none' }
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language ?? 'text'
      const language = ['json', 'xml', 'html', 'javascript', 'text'].includes(lang) ? lang : 'text'
      return { type: 'raw', language, text: body.raw ?? '' }
    }
    case 'urlencoded':
      return {
        type: 'urlencoded',
        items: (body.urlencoded ?? []).map((p: any) => ({ key: p.key ?? '', value: p.value ?? '', enabled: p.disabled !== true }))
      }
    case 'formdata':
      return {
        type: 'formdata',
        items: (body.formdata ?? []).map((p: any) => ({
          key: p.key ?? '',
          type: p.type === 'file' ? 'file' : 'text',
          value: p.type === 'file' ? '' : p.value ?? '',
          filePath: p.type === 'file' ? (Array.isArray(p.src) ? p.src[0] : p.src) : undefined,
          enabled: p.disabled !== true
        }))
      }
    case 'graphql':
      return { type: 'graphql', query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '{}' }
    case 'file':
      return { type: 'binary', filePath: body.file?.src }
    default:
      return { type: 'none' }
  }
}

function scriptFromEvents(events: any[], listen: string): string | undefined {
  const ev = (events ?? []).find((e) => e.listen === listen)
  if (!ev) return undefined
  const exec = ev.script?.exec
  if (Array.isArray(exec)) return exec.join('\n')
  return typeof exec === 'string' ? exec : undefined
}

function importItem(item: any): CollectionNode {
  if (item.item) {
    // folder
    const folder: CollectionFolderNode = {
      id: makeId('fld'),
      type: 'folder',
      name: item.name ?? 'Folder',
      auth: item.auth ? importAuth(item.auth) : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      preRequestScript: scriptFromEvents(item.event, 'prerequest'),
      testScript: scriptFromEvents(item.event, 'test'),
      children: item.item.map(importItem)
    }
    return folder
  }
  const r = item.request ?? {}
  const url = urlToString(r.url)
  const request: RequestModel = {
    id: makeId('req'),
    name: item.name ?? 'Request',
    method: (r.method ?? 'GET') as RequestModel['method'],
    url: url.raw,
    query: url.query,
    headers: (r.header ?? []).map(headerToKV),
    pathVariables: url.pathVars,
    body: importBody(r.body),
    auth: importAuth(r.auth),
    preRequestScript: scriptFromEvents(item.event, 'prerequest'),
    testScript: scriptFromEvents(item.event, 'test'),
    description: typeof r.description === 'string' ? r.description : undefined
  }
  return { id: request.id, type: 'request', request }
}

export function importPostmanCollection(obj: any): CollectionFolderNode {
  const collection: CollectionFolderNode = {
    id: makeId('col'),
    type: 'collection',
    name: obj.info?.name ?? 'Imported collection',
    auth: obj.auth ? importAuth(obj.auth) : undefined,
    description: typeof obj.info?.description === 'string' ? obj.info.description : undefined,
    variables: (obj.variable ?? []).map((v: any) => ({ key: v.key ?? '', value: v.value ?? '', enabled: true })),
    preRequestScript: scriptFromEvents(obj.event, 'prerequest'),
    testScript: scriptFromEvents(obj.event, 'test'),
    children: (obj.item ?? []).map(importItem)
  }
  return collection
}

/* ---------------- export ---------------- */

function exportAuth(auth?: Auth): any {
  if (!auth || auth.type === 'inherit') return undefined
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: auth.token, type: 'string' }] }
    case 'basic':
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.username, type: 'string' },
          { key: 'password', value: auth.password, type: 'string' }
        ]
      }
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: auth.key, type: 'string' },
          { key: 'value', value: auth.value, type: 'string' },
          { key: 'in', value: auth.addTo, type: 'string' }
        ]
      }
    case 'oauth2':
      return {
        type: 'oauth2',
        oauth2: [
          { key: 'accessToken', value: auth.accessToken, type: 'string' },
          { key: 'grant_type', value: auth.grant, type: 'string' },
          { key: 'accessTokenUrl', value: auth.tokenUrl ?? '', type: 'string' },
          { key: 'authUrl', value: auth.authUrl ?? '', type: 'string' },
          { key: 'clientId', value: auth.clientId ?? '', type: 'string' },
          { key: 'clientSecret', value: auth.clientSecret ?? '', type: 'string' },
          { key: 'scope', value: auth.scope ?? '', type: 'string' },
          { key: 'headerPrefix', value: auth.headerPrefix ?? 'Bearer', type: 'string' }
        ]
      }
    case 'digest':
      return {
        type: 'digest',
        digest: [
          { key: 'username', value: auth.username, type: 'string' },
          { key: 'password', value: auth.password, type: 'string' }
        ]
      }
    case 'none':
      return { type: 'noauth' }
    default:
      return undefined
  }
}

function exportBody(body: RequestBody): any {
  switch (body.type) {
    case 'none':
      return undefined
    case 'raw':
      return { mode: 'raw', raw: body.text, options: { raw: { language: body.language } } }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: body.items.map((i) => ({ key: i.key, value: i.value, disabled: !i.enabled })) }
    case 'formdata':
      return {
        mode: 'formdata',
        formdata: body.items.map((i) => ({
          key: i.key,
          type: i.type,
          value: i.type === 'text' ? i.value : undefined,
          src: i.type === 'file' ? i.filePath : undefined,
          disabled: !i.enabled
        }))
      }
    case 'graphql':
      return { mode: 'graphql', graphql: { query: body.query, variables: body.variables } }
    case 'binary':
      return { mode: 'file', file: { src: body.filePath } }
  }
}

function exportEvents(pre?: string, test?: string): any[] | undefined {
  const events: any[] = []
  if (pre) events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre.split('\n') } })
  if (test) events.push({ listen: 'test', script: { type: 'text/javascript', exec: test.split('\n') } })
  return events.length ? events : undefined
}

function exportRequest(r: RequestModel): any {
  return {
    name: r.name,
    event: exportEvents(r.preRequestScript, r.testScript),
    request: {
      method: r.method,
      header: r.headers.map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
      url: {
        raw: r.url,
        query: r.query.map((q) => ({ key: q.key, value: q.value, disabled: !q.enabled })),
        variable: r.pathVariables.map((p) => ({ key: p.key, value: p.value }))
      },
      auth: exportAuth(r.auth),
      body: exportBody(r.body),
      description: r.description
    }
  }
}

function exportNode(node: CollectionNode): any {
  if (node.type === 'request') return exportRequest(node.request)
  return {
    name: node.name,
    auth: exportAuth(node.auth),
    event: exportEvents(node.preRequestScript, node.testScript),
    item: node.children.map(exportNode)
  }
}

export function exportPostmanCollection(node: CollectionFolderNode): any {
  return {
    info: {
      _postman_id: node.id,
      name: node.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: exportAuth(node.auth),
    event: exportEvents(node.preRequestScript, node.testScript),
    variable: (node.variables ?? []).map((v) => ({ key: v.key, value: v.value })),
    item: node.children.map(exportNode)
  }
}

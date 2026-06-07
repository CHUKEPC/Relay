/**
 * HAR (HTTP Archive 1.2) → collection importer.
 *
 * Each `log.entries[].request` becomes a Relay request; they are all grouped
 * under one flat collection named "Imported (HAR)". HAR captures real traffic,
 * so we preserve method, full URL, headers, query string, and the post body.
 */
import { makeId } from '@shared/id'
import type {
  CollectionFolderNode,
  CollectionNode,
  KV,
  RawLanguage,
  RequestBody,
  RequestModel
} from '@shared/types'

/** Drop the pseudo-headers HTTP/2 captures expose (`:method`, `:path`, …). */
function isPseudoHeader(name: string): boolean {
  return name.startsWith(':')
}

function headersToKV(headers: any[]): KV[] {
  if (!Array.isArray(headers)) return []
  return headers
    .filter((h) => h && typeof h.name === 'string' && !isPseudoHeader(h.name))
    .map((h) => ({ key: h.name, value: typeof h.value === 'string' ? h.value : '', enabled: true }))
}

function queryToKV(query: any[]): KV[] {
  if (!Array.isArray(query)) return []
  return query
    .filter((q) => q && typeof q.name === 'string')
    .map((q) => ({ key: q.name, value: typeof q.value === 'string' ? q.value : '', enabled: true }))
}

/** Strip the query string from a HAR url (query is carried separately in query[]). */
function baseUrl(url: string): string {
  const qi = url.indexOf('?')
  return qi >= 0 ? url.slice(0, qi) : url
}

function langForMime(mime: string): RawLanguage {
  const m = mime.toLowerCase()
  if (m.includes('json')) return 'json'
  if (m.includes('xml')) return 'xml'
  if (m.includes('html')) return 'html'
  if (m.includes('javascript')) return 'javascript'
  return 'text'
}

function importBody(postData: any): RequestBody {
  if (!postData || typeof postData !== 'object') return { type: 'none' }
  const mime: string = typeof postData.mimeType === 'string' ? postData.mimeType : ''

  // urlencoded / multipart form params are captured in postData.params[].
  if (Array.isArray(postData.params) && postData.params.length) {
    if (mime.includes('multipart')) {
      return {
        type: 'formdata',
        items: postData.params.map((p: any) => ({
          key: typeof p?.name === 'string' ? p.name : '',
          type: p?.fileName ? ('file' as const) : ('text' as const),
          value: p?.fileName ? '' : typeof p?.value === 'string' ? p.value : '',
          fileName: typeof p?.fileName === 'string' ? p.fileName : undefined,
          enabled: true
        }))
      }
    }
    return {
      type: 'urlencoded',
      items: postData.params.map((p: any) => ({
        key: typeof p?.name === 'string' ? p.name : '',
        value: typeof p?.value === 'string' ? p.value : '',
        enabled: true
      }))
    }
  }

  if (typeof postData.text === 'string' && postData.text.length) {
    return { type: 'raw', language: langForMime(mime), text: postData.text }
  }
  return { type: 'none' }
}

function entryToRequest(entry: any, index: number): RequestModel | null {
  const r = entry?.request
  if (!r || typeof r.url !== 'string') return null
  const method = (typeof r.method === 'string' ? r.method : 'GET').toUpperCase()
  return {
    id: makeId('req'),
    name: `${method} ${baseUrl(r.url)}` || `Request ${index + 1}`,
    method: method as RequestModel['method'],
    url: baseUrl(r.url),
    query: queryToKV(r.queryString),
    headers: headersToKV(r.headers),
    pathVariables: [],
    body: importBody(r.postData),
    auth: { type: 'inherit' }
  }
}

export interface HarImportResult {
  collection: CollectionFolderNode
  warnings: string[]
}

/** Detect a HAR document by its `log.entries[]` array. */
export function isHar(doc: any): boolean {
  return !!doc && typeof doc === 'object' && !!doc.log && Array.isArray(doc.log.entries)
}

export function importHar(doc: any): HarImportResult {
  const warnings: string[] = []
  const entries: any[] = Array.isArray(doc?.log?.entries) ? doc.log.entries : []

  const children: CollectionNode[] = []
  let skipped = 0
  entries.forEach((entry, i) => {
    const request = entryToRequest(entry, i)
    if (!request) {
      skipped++
      return
    }
    children.push({ id: request.id, type: 'request', request })
  })

  if (skipped) warnings.push(`Skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} without a usable request.`)

  const collection: CollectionFolderNode = {
    id: makeId('col'),
    type: 'collection',
    name: 'Imported (HAR)',
    children
  }
  return { collection, warnings }
}

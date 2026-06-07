import type { IpcMain } from 'electron'
import { parse as parseYaml } from 'yaml'
import { IPC } from '@shared/ipc-contract'
import type { ImportKind, ImportResult } from '@shared/types'
import { parseCurl } from '@shared/curl'
import { importPostmanCollection, exportPostmanCollection } from './postman'
import { importOpenApi } from './openapi'
import { importHar, isHar } from './har'
import { importInsomnia, isInsomniaExport } from './insomnia'
import { isSwagger2 } from './swagger2'

/** Does this text look like YAML rather than JSON? (no leading `{`/`[`). */
function looksLikeYaml(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // JSON documents start with a brace/bracket; anything else (including the
  // `openapi:`/`swagger:` YAML keys) is treated as a YAML candidate.
  return t[0] !== '{' && t[0] !== '['
}

/**
 * Parse a document that may be JSON or YAML into a plain object.
 * JSON is tried first (it's the common case and a strict subset of YAML), then
 * YAML as a fallback so OpenAPI/Swagger YAML specs are accepted.
 */
function parseDoc(text: string): any {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    return parseYaml(trimmed)
  }
}

function detectKind(text: string): ImportKind {
  const trimmed = text.trim()
  if (/^curl\s/i.test(trimmed) || /^curl$/i.test(trimmed)) return 'curl'

  // Try JSON first, then YAML, so structured detection works for both.
  let obj: any
  try {
    obj = JSON.parse(trimmed)
  } catch {
    if (/\b-H\b|\b--header\b|https?:\/\//.test(trimmed) && /curl/i.test(trimmed)) return 'curl'
    if (looksLikeYaml(trimmed)) {
      try {
        obj = parseYaml(trimmed)
      } catch {
        return 'auto'
      }
    } else {
      return 'auto'
    }
  }

  if (!obj || typeof obj !== 'object') return 'auto'
  if (isHar(obj)) return 'har'
  if (isInsomniaExport(obj)) return 'insomnia'
  if (isSwagger2(obj)) return 'swagger'
  if (obj.openapi) return 'openapi'
  if (obj.swagger) return 'swagger'
  if (obj.info && obj.item) return 'postman'
  return 'auto'
}

function parseJsonOrThrow(text: string, label: string): any {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`This doesn't look like valid ${label} JSON. Check the document.`)
  }
}

/** Parse JSON or YAML, raising a friendly error for the given format label. */
function parseDocOrThrow(text: string, label: string): any {
  try {
    return parseDoc(text)
  } catch {
    throw new Error(`This doesn't look like a valid ${label} document (JSON or YAML).`)
  }
}

export function importData(kind: ImportKind, text: string): ImportResult[] {
  const resolved = kind === 'auto' ? detectKind(text) : kind
  switch (resolved) {
    case 'curl': {
      const { request, warnings } = parseCurl(text)
      return [{ kind: 'request', request, warnings }]
    }
    case 'postman': {
      const obj = parseJsonOrThrow(text, 'Postman')
      const collection = importPostmanCollection(obj)
      return [{ kind: 'collection', collection, warnings: [] }]
    }
    case 'openapi':
    case 'swagger': {
      // Both OpenAPI 3.x and Swagger 2.0 (JSON or YAML) flow through importOpenApi,
      // which delegates to the Swagger 2.0 importer when it sees swagger: "2.x".
      const obj = parseDocOrThrow(text, resolved === 'swagger' ? 'Swagger 2.0' : 'OpenAPI')
      const { collection, environment, warnings } = importOpenApi(obj)
      const results: ImportResult[] = [{ kind: 'collection', collection, warnings }]
      if (environment) results.push({ kind: 'environment', environment, warnings: [] })
      return results
    }
    case 'har': {
      const obj = parseJsonOrThrow(text, 'HAR')
      const { collection, warnings } = importHar(obj)
      return [{ kind: 'collection', collection, warnings }]
    }
    case 'insomnia': {
      const obj = parseDocOrThrow(text, 'Insomnia')
      const { collections, warnings } = importInsomnia(obj)
      return collections.map((collection, i) => ({
        kind: 'collection' as const,
        collection,
        warnings: i === 0 ? warnings : []
      }))
    }
    default:
      throw new Error(
        'Could not detect import format. Paste a cURL command, a Postman v2.1 collection, ' +
          'an OpenAPI 3 / Swagger 2.0 document (JSON or YAML), a HAR file, or an Insomnia v4 export.'
      )
  }
}

export function registerDataHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.data.import, async (_e, kind: ImportKind, text: string) => importData(kind, text))
  ipcMain.handle(IPC.data.export, async (_e, collectionJson: string) => {
    const node = parseJsonOrThrow(collectionJson, 'collection')
    return JSON.stringify(exportPostmanCollection(node), null, 2)
  })
}

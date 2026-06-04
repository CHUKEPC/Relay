import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ImportKind, ImportResult } from '@shared/types'
import { parseCurl } from '@shared/curl'
import { importPostmanCollection, exportPostmanCollection } from './postman'
import { importOpenApi } from './openapi'

function detectKind(text: string): ImportKind {
  const trimmed = text.trim()
  if (/^curl\s/i.test(trimmed) || /^curl$/i.test(trimmed)) return 'curl'
  try {
    const obj = JSON.parse(trimmed)
    if (obj.openapi || obj.swagger) return 'openapi'
    if (obj.info && obj.item) return 'postman'
  } catch {
    if (/\b-H\b|\b--header\b|https?:\/\//.test(trimmed) && /curl/i.test(trimmed)) return 'curl'
  }
  return 'auto'
}

export function importData(kind: ImportKind, text: string): ImportResult[] {
  const resolved = kind === 'auto' ? detectKind(text) : kind
  switch (resolved) {
    case 'curl': {
      const { request, warnings } = parseCurl(text)
      return [{ kind: 'request', request, warnings }]
    }
    case 'postman': {
      const obj = JSON.parse(text)
      const collection = importPostmanCollection(obj)
      return [{ kind: 'collection', collection, warnings: [] }]
    }
    case 'openapi': {
      const obj = JSON.parse(text)
      const { collection, environment, warnings } = importOpenApi(obj)
      const results: ImportResult[] = [{ kind: 'collection', collection, warnings }]
      if (environment) results.push({ kind: 'environment', environment, warnings: [] })
      return results
    }
    default:
      throw new Error('Could not detect import format. Paste a cURL command, a Postman v2.1 collection, or an OpenAPI 3 document.')
  }
}

export function registerDataHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.data.import, async (_e, kind: ImportKind, text: string) => importData(kind, text))
  ipcMain.handle(IPC.data.export, async (_e, collectionJson: string) => {
    const node = JSON.parse(collectionJson)
    return JSON.stringify(exportPostmanCollection(node), null, 2)
  })
}

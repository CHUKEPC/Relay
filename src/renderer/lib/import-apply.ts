/**
 * What happens to parsed import results — shared by the «Импорт» dialog and by
 * files dropped onto the window, so both add collections, environments and
 * globals exactly the same way.
 */
import type { CollectionNode, ImportResult } from '@shared/types'
import { mergeVariables } from '@shared/var-import'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useTabs } from '@renderer/store/tabs'
import { tr, trf } from './i18n'

/** Strip Electron's IPC wrapper ("Error invoking remote method 'x': Error: …")
 *  so the user sees the clean, actionable message. */
export function cleanImportError(msg: string): string {
  const cleaned = msg
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return localizeError(cleaned)
}

/** The import engine in the main process throws English messages (artifacts are
 *  English by project convention) — translate the known shapes for the user.
 *  Format names (Postman, OpenAPI, HAR…) stay English on purpose. */
function localizeError(msg: string): string {
  if (msg.startsWith('Could not detect import format')) {
    return tr(
      'Не удалось распознать формат. Поддерживаются: команда cURL, коллекция Postman v2.1, OpenAPI 3 / Swagger 2.0 (JSON или YAML), HAR и экспорт Insomnia v4.'
    )
  }
  const badJson = msg.match(/^This doesn't look like valid (.+) JSON\. Check the document\.$/)
  if (badJson) return trf('Это не похоже на корректный JSON ({format}). Проверьте документ.', { format: badJson[1] })
  const badDoc = msg.match(/^This doesn't look like a valid (.+) document \(JSON or YAML\)\.$/)
  if (badDoc) return trf('Это не похоже на корректный документ {format} (JSON или YAML).', { format: badDoc[1] })
  return msg
}

/** Count request leaves in a collection/folder subtree. */
export function countRequests(node: CollectionNode): number {
  if (node.type === 'request') return 1
  return node.children.reduce((n, c) => n + countRequests(c), 0)
}

export interface AppliedImport {
  /** «коллекций: 1 (запросов: 12), сред: 1» — empty when nothing was added */
  summary: string
  warnings: string[]
  requestsInCollections: number
}

/** Add every result to the workspace; the caller decides how to report it. */
export function applyImportResults(results: ImportResult[]): AppliedImport {
  const cols = useCollections.getState()
  const envs = useEnvironments.getState()
  const totalReqs = results.reduce((n, r) => n + (r.collection ? countRequests(r.collection) : 0), 0)
  const warnings: string[] = []
  let collections = 0
  let requests = 0
  let environments = 0
  let globals = 0
  for (const r of results) {
    warnings.push(...r.warnings)
    if (r.kind === 'collection' && r.collection) {
      cols.addCollectionNode(r.collection)
      collections++
    } else if (r.kind === 'environment' && r.environment) {
      envs.addEnvironment(r.environment)
      environments++
    } else if (r.kind === 'globals' && r.variables) {
      const current = useEnvironments.getState()
      current.setGlobalVars(mergeVariables(current.globals.variables, r.variables, 'merge').variables)
      globals += r.variables.length
    } else if (r.kind === 'request' && r.request) {
      useTabs.getState().openNew(r.request)
      requests++
    }
  }
  const parts = [
    collections && trf('коллекций: {n}', { n: collections }) + (totalReqs ? ` ${trf('(запросов: {n})', { n: totalReqs })}` : ''),
    requests && trf('запросов: {n}', { n: requests }),
    environments && trf('сред: {n}', { n: environments }),
    globals && trf('глобальных переменных: {n}', { n: globals })
  ].filter(Boolean) as string[]
  return { summary: parts.join(', '), warnings, requestsInCollections: totalReqs }
}

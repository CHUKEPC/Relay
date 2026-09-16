import type { CollectionFolderNode, RequestModel } from '@shared/types'
import { useUi } from '@renderer/store/ui'
import { tr, trf } from '@renderer/lib/i18n'

/** Strip path-hostile characters so the name is safe as a file name on every OS. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .trim()
  return cleaned || 'export'
}

/**
 * Shared pipeline: node (already shaped as a top-level collection) →
 * Postman v2.1 JSON via IPC → native save dialog → toast.
 * Returns true only when the file was actually written.
 */
async function exportNodeAsCollection(node: CollectionFolderNode, okMessage: string): Promise<boolean> {
  const { showToast } = useUi.getState()
  try {
    const json = await window.api.exportCollection(JSON.stringify(node))
    const saved = await window.api.saveFile({
      defaultName: `${sanitizeFileName(node.name)}.postman_collection.json`,
      content: json,
      filters: [{ name: 'Postman Collection', extensions: ['json'] }]
    })
    if (!saved) return false // user canceled the dialog — not an error
    showToast(okMessage)
    return true
  } catch (err) {
    showToast(trf('Не удалось экспортировать: {message}', { message: err instanceof Error ? err.message : String(err) }), 'error')
    return false
  }
}

/**
 * Export a folder (or a whole collection — it passes through unchanged) as a
 * standalone Postman v2.1 collection file.
 */
export async function exportFolderJson(node: CollectionFolderNode): Promise<boolean> {
  const wrapped: CollectionFolderNode = { ...node, type: 'collection' }
  return exportNodeAsCollection(wrapped, node.type === 'collection' ? tr('Коллекция экспортирована') : tr('Папка экспортирована'))
}

/** Export a single request as a one-item Postman v2.1 collection file. */
export async function exportRequestJson(request: RequestModel): Promise<boolean> {
  const wrapped: CollectionFolderNode = {
    id: request.id + '-export',
    type: 'collection',
    name: tr(request.name || 'Без названия'),
    children: [{ id: request.id, type: 'request', request }]
  }
  return exportNodeAsCollection(wrapped, tr('Запрос экспортирован'))
}

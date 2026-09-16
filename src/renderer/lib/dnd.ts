/**
 * Drag payload types shared by the tab strip, the collections tree and the pane
 * grid.
 *
 * Only `DataTransfer.types` is readable during `dragover` (the browser hides
 * the data itself until drop), so the MIME type alone must say what is being
 * dragged — hence one MIME per source rather than one payload with a `kind`.
 */
export const PANE_MIME = 'application/x-relay-pane'
export const TAB_MIME = 'application/x-relay-tab'
export const REQUEST_MIME = 'application/x-relay-request'

export type DragKind = 'pane' | 'tab' | 'request'

/** What a drag carries, decided from the MIME types alone (safe during dragover). */
export function dragKind(dt: DataTransfer): DragKind | null {
  if (dt.types.includes(PANE_MIME)) return 'pane'
  if (dt.types.includes(TAB_MIME)) return 'tab'
  if (dt.types.includes(REQUEST_MIME)) return 'request'
  return null
}

/** Payload id for a kind decided by {@link dragKind}; only valid on drop. */
export function dragId(dt: DataTransfer, kind: DragKind): string {
  const mime = kind === 'pane' ? PANE_MIME : kind === 'tab' ? TAB_MIME : REQUEST_MIME
  return dt.getData(mime)
}

/** True while something droppable into a pane is being dragged. */
export function isPaneDrop(dt: DataTransfer): boolean {
  return dragKind(dt) !== null
}

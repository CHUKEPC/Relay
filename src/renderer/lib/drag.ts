/**
 * Window-level mouse drag session shared by every resize/move handle
 * (sidebar, AI panel, console, workspace divider).
 *
 * Calls `onMove` for each mousemove until mouseup, managing the body cursor
 * and suppressing text selection for the duration. Returns an idempotent
 * cancel function for callers that must abort the session on unmount.
 */
export function trackDrag(
  onMove: (ev: MouseEvent) => void,
  opts: { cursor?: string; onEnd?: () => void } = {}
): () => void {
  const { cursor = '', onEnd } = opts
  if (cursor) document.body.style.cursor = cursor
  const prevUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    if (cursor) document.body.style.cursor = ''
    document.body.style.userSelect = prevUserSelect
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', finish)
    onEnd?.()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', finish)
  return finish
}

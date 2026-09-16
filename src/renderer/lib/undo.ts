import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useRequestUi, type RequestSubTab } from '@renderer/store/request-ui'
import { discard, restorePatch, takeRedo, takeUndo, withoutRecording, type UndoEntry, type UndoSource } from '@renderer/store/undo-history'

const SOURCE_LABELS: Record<UndoSource, string> = {
  url: 'адрес',
  meta: 'название / описание',
  params: 'Params',
  headers: 'Headers',
  auth: 'Authorization',
  body: 'Body',
  scripts: 'Scripts',
  examples: 'Examples',
  other: 'запрос'
}

const SOURCE_SUBTABS: Partial<Record<UndoSource, RequestSubTab>> = {
  params: 'params',
  headers: 'headers',
  auth: 'auth',
  body: 'body',
  scripts: 'scripts',
  examples: 'examples'
}

function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Apply one history step; returns false when nothing could be restored. */
function apply(tabId: string, entry: UndoEntry, direction: 'undo' | 'redo'): boolean {
  const tab = useTabs.getState().doc.tabs.find((t) => t.id === tabId)
  if (!tab) return false
  const patch = restorePatch(tab.request, entry, direction)
  if (Object.keys(patch).length === 0) return false
  withoutRecording(() => useTabs.getState().patchTab(tabId, patch))
  return true
}

/** Switch to the changed area, scroll it into view and flash it. */
function reveal(tabId: string, source: UndoSource): void {
  const sub = SOURCE_SUBTABS[source]
  if (sub) useRequestUi.getState().setSubTab(tabId, sub)
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-undo-tab="${CSS.escape(tabId)}"] [data-undo-field="${source}"]`)
    if (!el) return
    // `display: contents` wrappers have no box — flash their first real child.
    const target = getComputedStyle(el).display === 'contents' ? ((el.firstElementChild as HTMLElement | null) ?? el) : el
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    target.classList.remove('undo-flash')
    void target.offsetWidth
    target.classList.add('undo-flash')
    window.setTimeout(() => target.classList.remove('undo-flash'), 900)
  })
}

function step(tabId: string, direction: 'undo' | 'redo', source?: UndoSource): UndoEntry | null {
  const take = direction === 'undo' ? takeUndo : takeRedo
  // Skip steps whose keys were all overwritten later — they have nothing to restore.
  for (let guard = 0; guard < 50; guard++) {
    const entry = take(tabId, source)
    if (!entry) return null
    if (apply(tabId, entry, direction)) return entry
    discard(tabId, entry)
  }
  return null
}

/**
 * Global Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y handler (capture phase, so it runs
 * before Monaco). Inside a request field it undoes that field's last change,
 * even after focus moved away and came back. With nothing editable focused it
 * undoes the tab's newest change anywhere and scrolls to it.
 */
export function handleUndoKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  const isZ = e.code === 'KeyZ'
  const isY = e.code === 'KeyY'
  if (!isZ && !isY) return
  const direction: 'undo' | 'redo' = isY || e.shiftKey ? 'redo' : 'undo'
  if (isY && e.shiftKey) return

  const ui = useUi.getState()
  if (ui.settingsOpen || ui.paletteOpen) return

  const target = e.target as HTMLElement | null
  const fieldEl = target?.closest?.('[data-undo-field]')
  const tabEl = target?.closest?.('[data-undo-tab]')
  const paneTabId = tabEl?.getAttribute('data-undo-tab') ?? null

  if (fieldEl && paneTabId) {
    e.preventDefault()
    e.stopPropagation()
    step(paneTabId, direction, fieldEl.getAttribute('data-undo-field') as UndoSource)
    return
  }

  // Inputs outside the request builder (AI chat, dialogs) keep native undo.
  if (isEditable(target)) return

  const tabId = paneTabId ?? useTabs.getState().doc.activeTabId
  if (!tabId) return
  e.preventDefault()
  e.stopPropagation()
  const entry = step(tabId, direction)
  if (!entry) {
    ui.showToast(direction === 'undo' ? 'Нечего отменять' : 'Нечего возвращать')
    return
  }
  reveal(tabId, entry.source)
  ui.showToast(`${direction === 'undo' ? 'Отменено' : 'Возвращено'}: ${SOURCE_LABELS[entry.source]}`)
}

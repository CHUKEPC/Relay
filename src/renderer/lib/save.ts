/**
 * Saving the active request. Used by both the toolbar buttons and the keyboard
 * shortcut so saving works regardless of focus (Monaco swallows Ctrl/Cmd+S when
 * a code editor is focused, so a visible button is essential).
 */
import { useTabs } from '../store/tabs'
import { useCollections } from '../store/collections'
import { useUi } from '../store/ui'

/** Save: update the bound request if the tab is saved, else open the Save-As dialog. */
export function saveActiveRequest(): void {
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  if (tab.savedRequestId) {
    useCollections.getState().updateRequest(tab.savedRequestId, tab.request)
    useTabs.getState().markSaved(tab.id, tab.savedRequestId)
    useUi.getState().showToast('Сохранено')
  } else {
    useUi.getState().setSaveDialogOpen(true)
  }
}

/** Save As: always open the dialog to pick a (new) target/name. */
export function openSaveAsDialog(): void {
  if (!useTabs.getState().activeTab()) return
  useUi.getState().setSaveDialogOpen(true)
}

/**
 * Saving the active request. Used by both the toolbar buttons and the keyboard
 * shortcut so saving works regardless of focus (Monaco swallows Ctrl/Cmd+S when
 * a code editor is focused, so a visible button is essential).
 */
import { makeId } from '@shared/id'
import { useTabs } from '../store/tabs'
import { useCollections } from '../store/collections'
import { useUi } from '../store/ui'

import { tr } from '@renderer/lib/i18n'
/**
 * Save: update the bound request if the tab is saved, else open the Save-As
 * dialog (which targets the active tab, so an unsaved `tabId` is activated first).
 */
export function saveActiveRequest(tabId?: string): void {
  const tabs = useTabs.getState()
  const tab = tabId ? tabs.doc.tabs.find((t) => t.id === tabId) : tabs.activeTab()
  if (!tab) return
  if (tab.savedRequestId) {
    useCollections.getState().updateRequest(tab.savedRequestId, tab.request)
    tabs.markSaved(tab.id, tab.savedRequestId)
    useUi.getState().showToast(tr('Сохранено'))
  } else {
    if (tabs.doc.activeTabId !== tab.id) tabs.setActive(tab.id)
    useUi.getState().setSaveDialogOpen(true)
  }
}

/** Save the active tab as a new request under `parentId` (Save-As dialog result). */
export function saveActiveAs(parentId: string, name: string): void {
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  const id = makeId('req')
  useCollections.getState().addRequest(parentId, { ...tab.request, id, name })
  useTabs.getState().patchTab(tab.id, { id, name })
  useTabs.getState().markSaved(tab.id, id)
  useUi.getState().showToast(tr('Сохранено'))
}

/** Save As: always open the dialog to pick a (new) target/name. */
export function openSaveAsDialog(): void {
  if (!useTabs.getState().activeTab()) return
  useUi.getState().setSaveDialogOpen(true)
}

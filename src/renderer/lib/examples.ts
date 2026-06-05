/**
 * Response examples: save the current response onto a request, restore a saved
 * example into the response panel (without sending), and delete one.
 *
 * Examples persist on `RequestModel.examples`. Saving onto an already-saved
 * request writes straight through to the collection (and keeps the tab clean);
 * on an unsaved scratch tab it just edits the draft (dirty until "Save As").
 */
import type { ResponseExample, ResponseResult } from '@shared/types'
import { makeId } from '@shared/id'
import { useTabs } from '../store/tabs'
import { useCollections } from '../store/collections'
import { useResponse } from '../store/response'

/** Build a ResponseExample from a live response result. */
export function exampleFromResult(name: string, result: ResponseResult): ResponseExample {
  return {
    id: makeId('ex'),
    name: name.trim() || 'Example',
    status: result.status,
    headers: result.headers,
    // Examples store text bodies; for a binary body keep the base64 so it round-trips.
    body: result.body.text ?? result.body.base64 ?? '',
    contentType: result.body.contentType
  }
}

/** Persist `examples` onto the active tab's request (and its collection if saved). */
function commitExamples(examples: ResponseExample[]): void {
  const tabsStore = useTabs.getState()
  const tab = tabsStore.activeTab()
  if (!tab) return
  if (tab.savedRequestId) {
    // Write through to the stored request and keep the tab in sync + clean.
    const nextRequest = { ...tab.request, examples }
    useCollections.getState().updateRequest(tab.savedRequestId, nextRequest)
    tabsStore.patchTab(tab.id, { examples })
    tabsStore.markSaved(tab.id, tab.savedRequestId)
  } else {
    // Scratch tab — edit the draft; user persists with Save As.
    tabsStore.patchActive({ examples })
  }
}

/** Save the current response result as a named example on the active request. */
export function saveResponseExample(name: string, result: ResponseResult): void {
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  const examples = [...(tab.request.examples ?? []), exampleFromResult(name, result)]
  commitExamples(examples)
}

/** Delete an example by id from the active request. */
export function deleteExample(exampleId: string): void {
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  const examples = (tab.request.examples ?? []).filter((e) => e.id !== exampleId)
  commitExamples(examples)
}

/** Turn a stored example into a ResponseResult for the response panel. */
export function exampleToResult(ex: ResponseExample): ResponseResult {
  return {
    ok: ex.status >= 200 && ex.status < 400,
    status: ex.status,
    statusText: '',
    headers: ex.headers ?? [],
    cookies: [],
    body: {
      text: ex.body,
      contentType: ex.contentType,
      isBinary: false,
      sizeBytes: ex.body ? ex.body.length : 0
    },
    timings: { startedAt: Date.now(), totalMs: 0 },
    redirects: [],
    finalUrl: ''
  }
}

/** Restore a stored example into the active tab's response panel (no network). */
export function restoreExample(tabId: string, ex: ResponseExample): void {
  useResponse.getState().showExample(tabId, exampleToResult(ex))
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestModel } from '@shared/types'
import { forgetTab, recordPatch, restorePatch, takeRedo, takeUndo, withoutRecording } from './undo-history'

const TAB = 'tab_1'

function request(patch: Partial<RequestModel> = {}): RequestModel {
  return {
    id: 'req_1',
    name: 'Req',
    method: 'GET',
    url: 'https://a.test',
    query: [],
    headers: [],
    pathVariables: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    ...patch
  } as RequestModel
}

/** Apply a patch the way the tabs store does: record first, then mutate. */
function edit(req: RequestModel, patch: Partial<RequestModel>): RequestModel {
  recordPatch(TAB, req, patch)
  return { ...req, ...patch }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  forgetTab(TAB)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('undo history', () => {
  it('merges rapid edits to the same area into one step', () => {
    let req = request()
    req = edit(req, { url: 'https://a.test/u' })
    vi.advanceTimersByTime(200)
    req = edit(req, { url: 'https://a.test/us' })
    vi.advanceTimersByTime(200)
    req = edit(req, { url: 'https://a.test/users' })

    const entry = takeUndo(TAB)!
    expect(restorePatch(req, entry, 'undo')).toEqual({ url: 'https://a.test' })
    expect(takeUndo(TAB)).toBeNull()
  })

  it('starts a new step after a pause or when the area changes', () => {
    let req = request()
    req = edit(req, { url: 'https://a.test/1' })
    vi.advanceTimersByTime(2000)
    req = edit(req, { url: 'https://a.test/2' })
    req = edit(req, { headers: [{ key: 'X', value: '1', enabled: true }] })

    const headersStep = takeUndo(TAB)!
    expect(headersStep.source).toBe('headers')
    req = { ...req, ...restorePatch(req, headersStep, 'undo') }
    const second = restorePatch(req, takeUndo(TAB)!, 'undo')
    expect(second).toEqual({ url: 'https://a.test/1' })
    req = { ...req, ...second }
    expect(restorePatch(req, takeUndo(TAB)!, 'undo')).toEqual({ url: 'https://a.test' })
  })

  it('undoes the newest step of one area, skipping newer steps elsewhere', () => {
    let req = request()
    req = edit(req, { url: 'https://a.test/x' })
    vi.advanceTimersByTime(2000)
    req = edit(req, { body: { type: 'raw', language: 'json', text: '{}' } as RequestModel['body'] })

    const urlStep = takeUndo(TAB, 'url')!
    expect(urlStep.source).toBe('url')
    expect(restorePatch(req, urlStep, 'undo')).toEqual({ url: 'https://a.test' })
    expect(takeUndo(TAB)!.source).toBe('body')
  })

  it('leaves keys alone that another area changed after the step', () => {
    let req = request()
    req = edit(req, { url: 'https://a.test/?a=1', query: [{ key: 'a', value: '1', enabled: true }] })
    vi.advanceTimersByTime(2000)
    req = edit(req, { query: [{ key: 'a', value: '2', enabled: true }] })

    const urlStep = takeUndo(TAB, 'url')!
    // query now differs from what the url step wrote, so only url is restored.
    expect(restorePatch(req, urlStep, 'undo')).toEqual({ url: 'https://a.test' })
  })

  it('supports redo and clears it on a new edit', () => {
    let req = request()
    req = edit(req, { name: 'Renamed' })
    const step = takeUndo(TAB)!
    req = { ...req, ...restorePatch(req, step, 'undo') }
    expect(req.name).toBe('Req')

    const again = takeRedo(TAB)!
    expect(restorePatch(req, again, 'redo')).toEqual({ name: 'Renamed' })

    takeUndo(TAB)
    edit(req, { name: 'Other' })
    expect(takeRedo(TAB)).toBeNull()
  })

  it('ignores patches applied while recording is suppressed and no-op patches', () => {
    const req = request()
    withoutRecording(() => recordPatch(TAB, req, { url: 'https://elsewhere.test' }))
    recordPatch(TAB, req, { url: req.url })
    expect(takeUndo(TAB)).toBeNull()
  })
})

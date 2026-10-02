import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Layout prefs survive the 1.3.4 console change: the single size 1.3.3 kept for
 * every console position becomes the starting width and height, and a console
 * that was never docked at the top can now be docked there.
 */

function withPrefs(prefs: unknown): void {
  const store = new Map<string, string>([['relay.uiPrefs', JSON.stringify(prefs)]])
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v)
  }
  ;(globalThis as unknown as { window: unknown }).window = { innerWidth: 1400, innerHeight: 900, setTimeout, clearTimeout }
}

async function freshUi() {
  vi.resetModules()
  return (await import('./ui')).useUi
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  delete (globalThis as { window?: unknown }).window
})

describe('console layout prefs', () => {
  it('takes the 1.3.3 size as both the width and the height', async () => {
    withPrefs({ consoleDock: 'left', consoleSize: 520 })
    const s = (await freshUi()).getState()
    expect(s.consoleDock).toBe('left')
    expect(s.consoleWidth).toBe(520)
    expect(s.consoleHeight).toBe(520)
  })

  it('clamps each size to its own limits', async () => {
    withPrefs({ consoleSize: 200 })
    const s = (await freshUi()).getState()
    expect(s.consoleWidth).toBe(280) // a narrower console could not show its header
    expect(s.consoleHeight).toBe(200)
  })

  it('accepts the top edge and falls back to the bottom for anything unknown', async () => {
    withPrefs({ consoleDock: 'top' })
    expect((await freshUi()).getState().consoleDock).toBe('top')
    withPrefs({ consoleDock: 'sideways' })
    expect((await freshUi()).getState().consoleDock).toBe('bottom')
  })

  it('keeps width and height apart once they exist', async () => {
    withPrefs({ consoleWidth: 600, consoleHeight: 250, consoleSize: 400 })
    const ui = await freshUi()
    expect(ui.getState().consoleWidth).toBe(600)
    expect(ui.getState().consoleHeight).toBe(250)
    ui.getState().setConsoleWidth(5000)
    expect(ui.getState().consoleWidth).toBe(900)
  })
})

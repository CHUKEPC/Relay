import { describe, it, expect, afterEach } from 'vitest'
import {
  KEY_ACTIONS,
  comboFromEvent,
  findConflict,
  formatCombo,
  kbdCombo,
  matchAction,
  resolveBindings,
  setRecordingShortcut
} from './keymap'

/** A keydown as the app sees it; `target` decides whether text is being typed. */
function keydown(patch: Partial<KeyboardEvent> & { altGraph?: boolean; tagName?: string } = {}): KeyboardEvent {
  const { altGraph = false, tagName = 'DIV', ...rest } = patch
  return {
    key: 'k',
    code: 'KeyK',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: { tagName, isContentEditable: false },
    getModifierState: (name: string) => (name === 'AltGraph' ? altGraph : false),
    ...rest
  } as unknown as KeyboardEvent
}

afterEach(() => setRecordingShortcut(false))

describe('the shortcut table', () => {
  it('binds every default combo to exactly one action', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const action of KEY_ACTIONS) {
      const owner = seen.get(action.defaultCombo)
      if (owner) clashes.push(`${action.defaultCombo}: ${owner} / ${action.id}`)
      else seen.set(action.defaultCombo, action.id)
    }
    expect(clashes).toEqual([])
  })

  it('gives every action a combo the Shortcuts screen would accept', () => {
    const unbindable = KEY_ACTIONS.filter((a) => !/mod|alt/.test(a.defaultCombo) && !/(^|\+)f\d{1,2}$/.test(a.defaultCombo))
    expect(unbindable.map((a) => a.id)).toEqual([])
  })
})

describe('comboFromEvent', () => {
  it('reads the physical key, so a Cyrillic layout still matches', () => {
    expect(comboFromEvent(keydown({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe('mod+k')
  })

  it('orders modifiers mod, shift, alt', () => {
    expect(comboFromEvent(keydown({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, altKey: true }))).toBe('mod+shift+alt+e')
  })

  it('ignores a modifier pressed on its own', () => {
    expect(comboFromEvent(keydown({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
  })
})

describe('matchAction', () => {
  it('resolves a default binding', () => {
    expect(matchAction(keydown({ ctrlKey: true }), {})).toBe('palette')
  })

  it('returns null for a combo nothing is bound to', () => {
    expect(matchAction(keydown({ key: 'q', code: 'KeyQ', ctrlKey: true }), {})).toBeNull()
  })

  it('runs a Ctrl+Alt shortcut that the layout reports as AltGr', () => {
    // Regression: AltGr was rejected outright, which silently killed every
    // pane preset on keyboards that have an AltGr level.
    const event = keydown({ key: '2', code: 'Digit2', ctrlKey: true, altKey: true, altGraph: true })
    expect(matchAction(event, {})).toBe('panePreset2')
  })

  it('leaves AltGr alone while text is being typed', () => {
    const inInput = keydown({ key: '@', code: 'Digit2', ctrlKey: true, altKey: true, altGraph: true, tagName: 'INPUT' })
    expect(matchAction(inInput, {})).toBeNull()
  })

  it('stands down while the Shortcuts screen records a new combo', () => {
    setRecordingShortcut(true)
    expect(matchAction(keydown({ ctrlKey: true }), {})).toBeNull()
    setRecordingShortcut(false)
    expect(matchAction(keydown({ ctrlKey: true }), {})).toBe('palette')
  })

  it('follows a custom binding and its shadowing of another default', () => {
    const custom = { send: 'mod+k' }
    expect(matchAction(keydown({ ctrlKey: true }), custom)).toBe('send')
  })

  it('treats an empty override as "unbound"', () => {
    expect(matchAction(keydown({ ctrlKey: true }), { palette: '' })).toBeNull()
  })
})

describe('resolveBindings', () => {
  it('drops the default of an overridden action', () => {
    const map = resolveBindings({ palette: 'mod+p' })
    expect(map.get('mod+p')).toBe('palette')
    expect(map.get('mod+k')).toBeUndefined()
  })
})

describe('findConflict', () => {
  it('names the action already holding a combo, ignoring the one being edited', () => {
    expect(findConflict('mod+k', {}, 'send')).toBe('palette')
    expect(findConflict('mod+k', {}, 'palette')).toBeNull()
  })
})

describe('labels', () => {
  it('formats a combo for the current platform', () => {
    expect(formatCombo('mod+shift+enter')).toEqual(['Ctrl', 'Shift', '↵'])
  })

  it('reports the effective combo of an action', () => {
    expect(kbdCombo('palette', {})).toBe('Ctrl+K')
    expect(kbdCombo('palette', { palette: '' })).toBe('')
  })
})

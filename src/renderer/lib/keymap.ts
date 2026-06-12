/**
 * Customizable keyboard shortcut map.
 *
 * Combo string format: lowercase tokens joined by '+', modifiers in the fixed
 * order mod, shift, alt, followed by exactly one key token. 'mod' means
 * metaKey on macOS / ctrlKey elsewhere (we simply treat metaKey||ctrlKey as
 * mod). Key tokens: single characters ('k', ','), 'enter', 'escape',
 * 'arrowup'/'arrowdown'/'arrowleft'/'arrowright', 'f1'..'f12', etc.
 *
 * User overrides live in SettingsDoc.keybindings (actionId -> combo); an
 * empty-string value disables the action's shortcut.
 */
import { isMac, MOD } from './platform'

export type KeyActionId =
  | 'palette'
  | 'send'
  | 'newRequest'
  | 'toggleAi'
  | 'settings'
  | 'save'
  | 'closeTab'

export interface KeyActionDef {
  id: KeyActionId
  label: string
  defaultCombo: string
}

export const KEY_ACTIONS: KeyActionDef[] = [
  { id: 'palette', label: 'Командная палитра', defaultCombo: 'mod+k' },
  { id: 'send', label: 'Отправить запрос', defaultCombo: 'mod+enter' },
  { id: 'newRequest', label: 'Новый запрос', defaultCombo: 'mod+n' },
  { id: 'toggleAi', label: 'Открыть/скрыть AI', defaultCombo: 'mod+j' },
  { id: 'settings', label: 'Настройки', defaultCombo: 'mod+,' },
  { id: 'save', label: 'Сохранить', defaultCombo: 'mod+s' },
  { id: 'closeTab', label: 'Закрыть вкладку', defaultCombo: 'mod+w' }
]

const MODIFIER_KEYS = new Set([
  'meta',
  'control',
  'shift',
  'alt',
  'altgraph',
  'capslock',
  'numlock',
  'scrolllock',
  'fn',
  'fnlock',
  'hyper',
  'super',
  'os',
  'dead'
])

/** Punctuation physical keys that should match regardless of keyboard layout. */
const CODE_TOKENS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  Minus: '-',
  Equal: '='
}

/**
 * Key token for an event. Letters, digits and common punctuation resolve from
 * the PHYSICAL key (e.code) so shortcuts keep working on non-Latin layouts —
 * on a Cyrillic layout Cmd+K yields e.key='к', but e.code is still 'KeyK'.
 */
function keyTokenFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return null
  const code = e.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (code in CODE_TOKENS) return CODE_TOKENS[code]
  return key === ' ' ? 'space' : key
}

/** Build a combo string from a keydown event; null for pure-modifier presses. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = keyTokenFromEvent(e)
  if (key === null) return null
  const tokens: string[] = []
  if (e.metaKey || e.ctrlKey) tokens.push('mod')
  if (e.shiftKey) tokens.push('shift')
  if (e.altKey) tokens.push('alt')
  tokens.push(key)
  return tokens.join('+')
}

/** Normalize a stored combo (hand-edited settings.json may differ in case/spacing). */
function normCombo(combo: string): string {
  return combo.trim().toLowerCase()
}

/** Effective combo for an action: custom override or the default ('' = disabled). */
function effectiveCombo(action: KeyActionDef, custom: Record<string, string>): string {
  const v = custom[action.id]
  return v !== undefined ? normCombo(v) : action.defaultCombo
}

/**
 * Resolve the effective combo -> action map. Custom bindings win over default
 * combos of other actions (e.g. rebinding 'send' to 'mod+k' shadows the
 * palette default); a custom value of '' disables the action entirely.
 */
export function resolveBindings(custom: Record<string, string>): Map<string, KeyActionId> {
  const map = new Map<string, KeyActionId>()
  // Pass 1: defaults (skipping overridden/disabled actions); pass 2: customs
  // override whatever default sits on that combo.
  for (const action of KEY_ACTIONS) {
    if (custom[action.id] === undefined) map.set(action.defaultCombo, action.id)
  }
  for (const action of KEY_ACTIONS) {
    const v = custom[action.id]
    if (v !== undefined && v !== '') map.set(normCombo(v), action.id)
  }
  return map
}

// matchAction runs on every keydown app-wide; cache the resolved map until the
// keybindings object is replaced (settings updates always produce a new ref).
let bindingsFor: Record<string, string> | null = null
let bindingsCache: Map<string, KeyActionId> | null = null

/** Match a keydown event against the effective bindings. */
export function matchAction(e: KeyboardEvent, custom: Record<string, string>): KeyActionId | null {
  const combo = comboFromEvent(e)
  if (!combo) return null
  if (custom !== bindingsFor || !bindingsCache) {
    bindingsFor = custom
    bindingsCache = resolveBindings(custom)
  }
  return bindingsCache.get(combo) ?? null
}

const TOKEN_LABELS: Record<string, string> = {
  mod: MOD,
  shift: isMac ? '⇧' : 'Shift',
  alt: isMac ? '⌥' : 'Alt',
  enter: '↵',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→'
}

/** Split a combo into tokens; handles a literal '+' key ('mod++' -> ['mod','+']). */
function comboTokens(combo: string): string[] {
  if (combo.endsWith('++')) return [...combo.slice(0, -2).split('+').filter(Boolean), '+']
  if (combo === '+') return ['+']
  return combo.split('+').filter(Boolean)
}

/** Display tokens for a combo, e.g. 'mod+enter' -> ['⌘', '↵'] on mac. */
export function formatCombo(combo: string): string[] {
  return comboTokens(combo).map((t) => {
    const known = TOKEN_LABELS[t]
    if (known) return known
    if (/^f\d{1,2}$/.test(t)) return t.toUpperCase()
    if (t.length === 1) return t.toUpperCase()
    return t.charAt(0).toUpperCase() + t.slice(1)
  })
}

/** Which other action (if any) already uses this combo. */
export function findConflict(
  combo: string,
  custom: Record<string, string>,
  excludeId: KeyActionId
): KeyActionId | null {
  if (combo === '') return null
  const wanted = normCombo(combo)
  for (const action of KEY_ACTIONS) {
    if (action.id === excludeId) continue
    if (effectiveCombo(action, custom) === wanted) return action.id
  }
  return null
}

import { useEffect, useState } from 'react'
import { Kbd } from '@renderer/components/primitives'
import { MOD } from '@renderer/lib/platform'
import { KEY_ACTIONS, comboFromEvent, findConflict, formatCombo } from '@renderer/lib/keymap'
import type { KeyActionGroup, KeyActionId } from '@renderer/lib/keymap'
import { useSettings } from '@renderer/store/settings'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-keys.css'

/** Non-rebindable shortcuts shown as a static reference group. */
const FIXED_SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: 'Закрыть оверлей', keys: ['Esc'] },
  { label: 'Поиск в ответе', keys: [MOD, 'F'] },
  { label: 'Отменить изменение в запросе', keys: [MOD, 'Z'] },
  { label: 'Вернуть изменение', keys: [MOD, 'Shift', 'Z'] }
]

/** A combo is bindable when it includes the mod or alt key, or ends in an F-key. */
function isBindable(combo: string): boolean {
  return combo.includes('mod') || combo.includes('alt') || /(^|\+)f\d{1,2}$/.test(combo)
}

const GROUPS: { id: KeyActionGroup; title: string; hint?: string }[] = [
  { id: 'general', title: 'Основные' },
  {
    id: 'panes',
    title: 'Панели',
    hint: 'Действуют на активную панель. В отдельном окне «переместить» двигает само окно, а «сдвинуть границу» меняет его размер.'
  }
]

export function ShortcutsSection(): JSX.Element {
  const keybindings = useSettings((s) => s.settings.keybindings)
  const [capturingId, setCapturingId] = useState<KeyActionId | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const overriddenCount = KEY_ACTIONS.filter((a) => keybindings[a.id] !== undefined).length

  const stopCapture = () => {
    setCapturingId(null)
    setCaptureError(null)
  }

  const persist = (next: Record<string, string>) => {
    useSettings.getState().update({ keybindings: next })
  }

  const resetOne = (id: KeyActionId) => {
    const next = { ...useSettings.getState().settings.keybindings }
    delete next[id]
    persist(next)
  }

  // Capture-phase listener: swallow every keydown while recording so the
  // app's global shortcuts (and the captured combo itself) don't fire.
  useEffect(() => {
    if (!capturingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        stopCapture()
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // pure-modifier press — keep waiting
      if (!isBindable(combo)) {
        setCaptureError(trf('Сочетание должно содержать {mod}, Alt или F-клавишу', { mod: MOD }))
        return
      }
      const custom = useSettings.getState().settings.keybindings
      const conflict = findConflict(combo, custom, capturingId)
      if (conflict) {
        const label = KEY_ACTIONS.find((a) => a.id === conflict)?.label ?? conflict
        setCaptureError(trf('Уже используется: {action}', { action: tr(label) }))
        return
      }
      const action = KEY_ACTIONS.find((a) => a.id === capturingId)
      const next = { ...custom }
      // Store only true overrides; binding back to the default removes the entry.
      if (action && combo === action.defaultCombo) delete next[capturingId]
      else next[capturingId] = combo
      persist(next)
      stopCapture()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [capturingId])

  return (
    <>
      <div className="set-h">{tr('Горячие клавиши')}</div>
      <div className="set-sub">{tr('Назначайте собственные сочетания клавиш для действий Relay.')}</div>

      <div className="keys-toolbar">
        <button
          className="btn ghost"
          disabled={overriddenCount === 0}
          onClick={() => {
            persist({})
            stopCapture()
          }}
        > {tr('Сбросить все')} </button>
      </div>

      {GROUPS.map((group) => (
      <div key={group.id}>
        <div className="set-group-label">{tr(group.title)}</div>
        {group.hint && <div className="set-sub" style={{ marginTop: -6 }}>{tr(group.hint)}</div>}
        {KEY_ACTIONS.filter((a) => a.group === group.id).map((action) => {
          const overridden = keybindings[action.id] !== undefined
          const combo = overridden ? keybindings[action.id] : action.defaultCombo
          const capturing = capturingId === action.id
          return (
            <div className="set-row" key={action.id}>
              <div className="label">
                <div className="t">
                  {tr(action.label)}
                  {overridden && <span className="keys-badge">{tr('изменено')}</span>}
                </div>
                {capturing && captureError && <div className="keys-conflict">{captureError}</div>}
              </div>

              {capturing ? (
                <div className="keys-capture">{tr('Нажмите сочетание клавиш… Esc — отмена')}</div>
              ) : (
                <div className="keys-combo">
                  {combo === '' ? (
                    <span className="keys-off">{tr('не назначено')}</span>
                  ) : (
                    formatCombo(combo).map((k, i) => <Kbd key={i}>{k}</Kbd>)
                  )}
                </div>
              )}

              <div className="keys-actions">
                {capturing ? (
                  <button className="btn ghost" onClick={stopCapture}> {tr('Отмена')} </button>
                ) : (
                  <>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setCaptureError(null)
                        setCapturingId(action.id)
                      }}
                    > {tr('Изменить')} </button>
                    {overridden && (
                      <button className="btn ghost" onClick={() => resetOne(action.id)}> {tr('Сбросить')} </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      ))}

      <div className="set-group-label">{tr('Фиксированные')}</div>
      <div>
        {FIXED_SHORTCUTS.map((s) => (
          <div className="set-row" key={s.label}>
            <div className="label">
              <div className="t">{tr(s.label)}</div>
            </div>
            <div className="keys-combo">
              {s.keys.map((k, j) => (
                <Kbd key={j}>{k}</Kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

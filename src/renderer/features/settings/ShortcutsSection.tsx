import { Kbd } from '@renderer/components/primitives'
import { MOD } from '@renderer/lib/platform'

/** Static reference list of the app's keyboard shortcuts (modifier per platform). */
const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: 'Командная палитра', keys: [MOD, 'K'] },
  { label: 'Отправить запрос', keys: [MOD, '↵'] },
  { label: 'Новый запрос', keys: [MOD, 'N'] },
  { label: 'Открыть/скрыть AI', keys: [MOD, 'J'] },
  { label: 'Настройки', keys: [MOD, ','] },
  { label: 'Поиск в ответе', keys: [MOD, 'F'] },
  { label: 'Закрыть вкладку', keys: [MOD, 'W'] },
  { label: 'Сохранить', keys: [MOD, 'S'] }
]

export function ShortcutsSection(): JSX.Element {
  return (
    <>
      <div className="set-h">Горячие клавиши</div>
      <div className="set-sub">Основные сочетания клавиш Relay.</div>
      <div>
        {SHORTCUTS.map((s) => (
          <div className="set-row" key={s.label}>
            <div className="label">
              <div className="t">{s.label}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
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

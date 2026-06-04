import { Kbd } from '@renderer/components/primitives'

/** Static reference list of the app's keyboard shortcuts. */
const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: 'Командная палитра', keys: ['⌘', 'K'] },
  { label: 'Отправить запрос', keys: ['⌘', '↵'] },
  { label: 'Новый запрос', keys: ['⌘', 'N'] },
  { label: 'Открыть/скрыть AI', keys: ['⌘', 'J'] },
  { label: 'Настройки', keys: ['⌘', ','] },
  { label: 'Поиск в ответе', keys: ['⌘', 'F'] },
  { label: 'Закрыть вкладку', keys: ['⌘', 'W'] },
  { label: 'Сохранить', keys: ['⌘', 'S'] }
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

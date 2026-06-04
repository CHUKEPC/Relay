import type { ChangeEvent } from 'react'
import type { SettingsDoc } from '@shared/types'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'

interface ToggleRowDef {
  key: keyof Pick<
    SettingsDoc,
    'followRedirects' | 'rejectUnauthorized' | 'wordWrapResponse' | 'sendAiContext' | 'autoApplyAiTools'
  >
  title: string
  desc: string
}

const TOGGLE_ROWS: ToggleRowDef[] = [
  { key: 'followRedirects', title: 'Следовать редиректам', desc: 'Автоматически переходить по 3xx-ответам' },
  { key: 'rejectUnauthorized', title: 'Проверять SSL-сертификаты', desc: 'Отклонять небезопасные соединения' },
  { key: 'wordWrapResponse', title: 'Переносить длинные строки', desc: 'Word wrap в просмотрщике ответа' },
  { key: 'sendAiContext', title: 'Отправлять контекст в AI', desc: 'Прикреплять текущий запрос и ответ к диалогу' },
  { key: 'autoApplyAiTools', title: 'Авто-применение действий AI', desc: 'Сразу применять изменения, предложенные ассистентом' }
]

interface NumberRowDef {
  key: keyof Pick<SettingsDoc, 'requestTimeoutMs' | 'maxHistory' | 'maxRedirects'>
  title: string
  desc: string
  min: number
  max: number
}

const NUMBER_ROWS: NumberRowDef[] = [
  { key: 'requestTimeoutMs', title: 'Таймаут запроса (мс)', desc: 'Прерывать запрос после указанного времени', min: 0, max: 600000 },
  { key: 'maxHistory', title: 'Максимум записей в истории', desc: 'Сколько прошлых запросов хранить', min: 0, max: 100000 },
  { key: 'maxRedirects', title: 'Макс. редиректов', desc: 'Предел переходов по 3xx за один запрос', min: 0, max: 50 }
]

export function GeneralSection(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const onNumber = (key: NumberRowDef['key'], min: number, max: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value)
    if (Number.isNaN(raw)) return
    const clamped = Math.min(max, Math.max(min, Math.round(raw)))
    update({ [key]: clamped } as Partial<SettingsDoc>)
  }

  return (
    <>
      <div className="set-h">Основные</div>
      <div className="set-sub">Поведение запросов и рабочей области.</div>

      {TOGGLE_ROWS.map((row) => (
        <div className="set-row" key={row.key}>
          <div className="label">
            <div className="t">{row.title}</div>
            <div className="d">{row.desc}</div>
          </div>
          <Toggle
            checked={settings[row.key]}
            onChange={(v) => update({ [row.key]: v } as Partial<SettingsDoc>)}
          />
        </div>
      ))}

      {NUMBER_ROWS.map((row) => (
        <div className="set-row" key={row.key}>
          <div className="label">
            <div className="t">{row.title}</div>
            <div className="d">{row.desc}</div>
          </div>
          <input
            className="input mono"
            type="number"
            min={row.min}
            max={row.max}
            value={settings[row.key]}
            onChange={onNumber(row.key, row.min, row.max)}
            style={{ width: 140 }}
          />
        </div>
      ))}
    </>
  )
}

import type { ChangeEvent } from 'react'
import type { SettingsDoc } from '@shared/types'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'

import { LANGUAGE_NAMES, tr } from '@renderer/lib/i18n'
import { flushPersistAndWait } from '@renderer/store/persist'
import { useFeatures } from '@renderer/store/features'
import { useUi } from '@renderer/store/ui'
import { CORE_LOCALES } from '@shared/features'
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

/**
 * UI language. Russian and English are part of the app; anything else appears
 * only while the «Дополнительные языки» pack is enabled, and a language that
 * disappears with its pack falls back to Russian on the next start.
 */
/** Persist the choice, make sure it reached disk, then restart the renderer. */
async function switchLanguage(code: string): Promise<void> {
  useSettings.getState().update({ language: code })
  await flushPersistAndWait()
  window.location.reload()
}

function LanguageRow(): JSX.Element {
  const language = useSettings((s) => s.settings.language)
  const extra = useFeatures((s) => s.plugins.flatMap((p) => (p.enabled && !p.error ? (p.locales ?? []) : [])))
  const codes = [...CORE_LOCALES, ...extra.filter((c) => !(CORE_LOCALES as readonly string[]).includes(c))]

  return (
    <div className="set-row">
      <div className="label">
        <div className="t">{tr('Язык интерфейса')}</div>
        <div className="d">
          {extra.length
            ? tr('Русский и английский входят в приложение; остальные языки даёт плагин «Дополнительные языки».')
            : tr('Другие языки — в плагине «Дополнительные языки».')}
        </div>
      </div>
      <select
        className="input"
        style={{ width: 200 }}
        value={language}
        onChange={(e) => {
          // Reload rather than swap the catalog in place: module-level constants
          // (label tables, error maps) call tr() once when their module is first
          // evaluated, so only a fresh start makes every string follow the switch.
          void switchLanguage(e.target.value)
        }}
      >
        {codes.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
    </div>
  )
}

export function GeneralSection(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const onNumber = (key: NumberRowDef['key'], min: number, max: number) => (e: ChangeEvent<HTMLInputElement>) => {
    // Don't coerce an empty field to 0 (Number('') === 0) — let the user clear and retype.
    if (e.target.value.trim() === '') return
    const raw = Number(e.target.value)
    if (Number.isNaN(raw)) return
    const clamped = Math.min(max, Math.max(min, Math.round(raw)))
    update({ [key]: clamped } as Partial<SettingsDoc>)
  }

  return (
    <>
      <div className="set-h">{tr('Основные')}</div>
      <div className="set-sub">{tr('Поведение запросов и рабочей области.')}</div>

      <LanguageRow />

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Экономить видеопамять')}</div>
          <div className="d">
            {tr(
              'Рисовать интерфейс без графического ускорителя. Заметно снижает расход видеопамяти, прокрутка становится чуть менее плавной. Изменение вступает в силу после перезапуска.'
            )}
          </div>
        </div>
        <Toggle
          checked={settings.disableHardwareAcceleration}
          onChange={(v) => {
            update({ disableHardwareAcceleration: v })
            useUi.getState().showToast(tr('Настройка применится после перезапуска Relay'))
          }}
        />
      </div>

      {TOGGLE_ROWS.map((row) => (
        <div className="set-row" key={row.key}>
          <div className="label">
            <div className="t">{tr(row.title)}</div>
            <div className="d">{tr(row.desc)}</div>
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
            <div className="t">{tr(row.title)}</div>
            <div className="d">{tr(row.desc)}</div>
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

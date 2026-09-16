import { useState } from 'react'
import { APP_VERSION, UPDATE_REPO } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/ipc-contract'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'

import { tr } from '@renderer/lib/i18n'
const ERRORS: Record<string, string> = {
  'no-releases': 'В репозитории пока нет ни одного релиза или тега версии',
  'rate-limit': 'GitHub временно ограничил число запросов — попробуйте позже',
  timeout: 'GitHub не ответил за 10 секунд',
  network: 'Нет соединения с GitHub',
  ipc: 'Внутренняя ошибка проверки',
  'web-mode': 'Проверка доступна только в десктопном приложении'
}

/** One plain-Russian line describing the outcome of a check. */
function describe(result: UpdateCheckResult): string {
  if (!result.ok) return ERRORS[result.error] ?? `GitHub ответил ошибкой (${result.error})`
  const from = result.source === 'tag' ? ' (по тегам репозитория — релиз ещё не опубликован)' : ''
  if (result.updateAvailable) return `Доступна версия ${result.latestVersion}${from}`
  return `У вас актуальная версия ${result.currentVersion}${from}`
}

/** Settings group: opt-out toggle + manual "check now" against GitHub. */
export function UpdatesCard(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(null)

  const check = async (): Promise<void> => {
    setChecking(true)
    setResult(null)
    try {
      setResult(await window.api.checkUpdates())
    } catch {
      // checkUpdates never rejects by contract, but stay graceful anyway.
      setResult({ ok: false, error: 'ipc' })
    } finally {
      setChecking(false)
    }
  }

  let resultLine = 'Запросить последнюю версию с GitHub'
  if (checking) resultLine = 'Проверяем…'
  else if (result) resultLine = describe(result)

  return (
    <>
      <div className="set-group-label">{tr('Обновления')}</div>

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Сообщать о новых версиях')}</div>
          <div className="d">{tr('Relay проверяет страницу релизов на GitHub. Никаких своих серверов.')}</div>
        </div>
        <Toggle
          checked={settings.updateCheckEnabled}
          onChange={(v) => update({ updateCheckEnabled: v })}
        />
      </div>

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Проверка обновлений')}</div>
          <div className="d">{resultLine}</div>
        </div>
        {result?.ok && (
          <button className="btn ghost" onClick={() => void window.api.openExternal(result.url)}>
            {result.updateAvailable ? 'Открыть страницу релиза' : 'Открыть релизы'}
          </button>
        )}
        <button className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>

      {result?.ok && result.updateAvailable && (result.publishedAt || result.notes) && (
        <div className="upd-notes">
          {result.publishedAt && (
            <div className="upd-notes-date">Опубликован {new Date(result.publishedAt).toLocaleDateString('ru-RU')}</div>
          )}
          {result.notes && <div className="upd-notes-body">{result.notes}</div>}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--tx-3)', margin: '8px 0 4px' }}>
        Текущая версия {APP_VERSION} · {UPDATE_REPO}
      </div>
    </>
  )
}

import { useState } from 'react'
import { APP_VERSION, UPDATE_REPO } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/ipc-contract'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'

import { tr, trf } from '@renderer/lib/i18n'
/** Built per call: tr() must run while rendering, not when the module loads. */
function errorText(error: string): string {
  const map: Record<string, string> = {
    'no-releases': tr('В репозитории пока нет ни одного релиза или тега версии'),
    'rate-limit': tr('GitHub временно ограничил число запросов — попробуйте позже'),
    timeout: tr('GitHub не ответил за 10 секунд'),
    network: tr('Нет соединения с GitHub'),
    ipc: tr('Внутренняя ошибка проверки'),
    'web-mode': tr('Проверка доступна только в десктопном приложении')
  }
  return map[error] ?? trf('GitHub ответил ошибкой ({error})', { error })
}

/** One plain-Russian line describing the outcome of a check. */
function describe(result: UpdateCheckResult): string {
  if (!result.ok) return errorText(result.error)
  const from = result.source === 'tag' ? tr(' (по тегам репозитория — релиз ещё не опубликован)') : ''
  if (result.updateAvailable) return trf('Доступна версия {version}', { version: result.latestVersion }) + from
  return trf('У вас актуальная версия {version}', { version: result.currentVersion }) + from
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

  let resultLine = tr('Запросить последнюю версию с GitHub')
  if (checking) resultLine = tr('Проверяем…')
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
            {result.updateAvailable ? tr('Открыть страницу релиза') : tr('Открыть релизы')}
          </button>
        )}
        <button className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? tr('Проверяем…') : tr('Проверить сейчас')}
        </button>
      </div>

      {result?.ok && result.updateAvailable && (result.publishedAt || result.notes) && (
        <div className="upd-notes">
          {result.publishedAt && (
            <div className="upd-notes-date">
              {trf('Опубликован {date}', { date: new Date(result.publishedAt).toLocaleDateString() })}
            </div>
          )}
          {result.notes && <div className="upd-notes-body">{result.notes}</div>}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--tx-3)', margin: '8px 0 4px' }}>
        {trf('Текущая версия {version}', { version: APP_VERSION })} · {UPDATE_REPO}
      </div>
    </>
  )
}

import { useState } from 'react'
import { APP_VERSION, UPDATE_REPO } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/ipc-contract'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'

/** Settings group: opt-out toggle + manual "check now" against GitHub Releases. */
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

  let resultLine = 'Запросить последний релиз со страницы GitHub Releases'
  if (checking) resultLine = 'Проверяем…'
  else if (result) {
    if (!result.ok) resultLine = 'Не удалось проверить обновления (нет сети или репозиторий ещё не настроен)'
    else if (result.updateAvailable) resultLine = `Доступна версия ${result.latestVersion}`
    else resultLine = `У вас актуальная версия ${result.currentVersion}`
  }

  return (
    <>
      <div className="set-group-label">Обновления</div>

      <div className="set-row">
        <div className="label">
          <div className="t">Сообщать о новых версиях</div>
          <div className="d">Relay проверяет страницу релизов на GitHub. Никаких своих серверов.</div>
        </div>
        <Toggle
          checked={settings.updateCheckEnabled}
          onChange={(v) => update({ updateCheckEnabled: v })}
        />
      </div>

      <div className="set-row">
        <div className="label">
          <div className="t">Проверка обновлений</div>
          <div className="d">{resultLine}</div>
        </div>
        {result?.ok && result.updateAvailable && (
          <button className="btn ghost" onClick={() => void window.api.openExternal(result.url)}>
            Открыть страницу релиза
          </button>
        )}
        <button className="btn" disabled={checking} onClick={() => void check()}>
          {checking ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--tx-3)', margin: '8px 0 4px' }}>
        Текущая версия {APP_VERSION} · {UPDATE_REPO}
      </div>
    </>
  )
}

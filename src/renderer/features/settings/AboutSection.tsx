import { APP_NAME, APP_VERSION, FEEDBACK_EMAIL } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { UpdatesCard } from './UpdatesCard'

import { tr, trf } from '@renderer/lib/i18n'
const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

export function AboutSection(): JSX.Element {
  const showToast = useUi((s) => s.showToast)
  const platform = PLATFORM_LABELS[window.api.platform] ?? window.api.platform

  const copyEmail = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(FEEDBACK_EMAIL)
      showToast(tr('Email скопирован'))
    } catch {
      showToast(tr('Не удалось скопировать'), 'error')
    }
  }

  return (
    <>
      <div className="set-h">{tr('О приложении')}</div>
      <div className="set-sub">{tr('Версия, платформа и обратная связь.')}</div>

      <div className="about-hero">
        <div className="about-mark">
          <Icon name="bolt" size={26} style={{ color: '#fff' }} />
        </div>
        <div>
          <div className="about-name">{APP_NAME}</div>
          <div className="about-version">{trf('Версия {version}', { version: APP_VERSION })}</div>
        </div>
      </div>

      <div className="about-tagline">{tr('API-клиент со встроенным AI-ассистентом.')}</div>

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Платформа')}</div>
          <div className="d">{tr('Операционная система, на которой запущено приложение')}</div>
        </div>
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--tx-1)' }}>
          {platform}
        </span>
      </div>

      <UpdatesCard />

      <div className="about-card">
        <h3>{tr('Обратная связь')}</h3>
        <p>{tr('Есть вопросы, пожелания или нашли баг — напишите нам.')}</p>
        <div className="about-email">{FEEDBACK_EMAIL}</div>
        <div className="about-card-actions">
          <button
            className="btn primary"
            onClick={() =>
              void window.api.openExternal('mailto:' + FEEDBACK_EMAIL + '?subject=Relay%20Feedback')
            }
          >
            <Icon name="mail" size={14} /> {tr('Написать')} </button>
          <button className="btn" onClick={() => void copyEmail()}>
            <Icon name="copy" size={14} /> {tr('Копировать')} </button>
        </div>
      </div>
    </>
  )
}

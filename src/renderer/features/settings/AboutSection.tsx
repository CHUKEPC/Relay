import { APP_NAME, APP_VERSION, FEEDBACK_EMAIL } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { startTour } from '@renderer/features/onboarding/Tour'
import { UpdatesCard } from './UpdatesCard'

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
      showToast('Email скопирован')
    } catch {
      showToast('Не удалось скопировать', 'error')
    }
  }

  return (
    <>
      <div className="set-h">О приложении</div>
      <div className="set-sub">Версия, платформа и обратная связь.</div>

      <div className="about-hero">
        <div className="about-mark">
          <Icon name="bolt" size={26} style={{ color: '#fff' }} />
        </div>
        <div>
          <div className="about-name">{APP_NAME}</div>
          <div className="about-version">Версия {APP_VERSION}</div>
        </div>
      </div>

      <div className="about-tagline">API-клиент со встроенным AI-ассистентом.</div>

      <div className="set-row">
        <div className="label">
          <div className="t">Платформа</div>
          <div className="d">Операционная система, на которой запущено приложение</div>
        </div>
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--tx-1)' }}>
          {platform}
        </span>
      </div>

      <UpdatesCard />

      <div className="about-card">
        <h3>Обратная связь</h3>
        <p>Есть вопросы, пожелания или нашли баг — напишите нам.</p>
        <div className="about-email">{FEEDBACK_EMAIL}</div>
        <div className="about-card-actions">
          <button
            className="btn primary"
            onClick={() =>
              void window.api.openExternal('mailto:' + FEEDBACK_EMAIL + '?subject=Relay%20Feedback')
            }
          >
            <Icon name="mail" size={14} /> Написать
          </button>
          <button className="btn" onClick={() => void copyEmail()}>
            <Icon name="copy" size={14} /> Копировать
          </button>
        </div>
        <button
          className="btn ghost tour-restart"
          onClick={() => {
            // The tour spotlights the main window — close settings first.
            useUi.getState().closeSettings()
            setTimeout(startTour, 250)
          }}
        >
          <Icon name="refresh" size={14} /> Показать тур по интерфейсу
        </button>
      </div>
    </>
  )
}

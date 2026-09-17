import { APP_NAME, APP_VERSION, FEEDBACK_EMAIL, FEEDBACK_GITHUB, FEEDBACK_TELEGRAM } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { UpdatesCard } from './UpdatesCard'

import { tr, trf } from '@renderer/lib/i18n'
const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

/** Email, GitHub and Telegram — one row each, same shape. */
interface Contact {
  id: string
  icon: string
  /** what the user sees and what «Копировать» puts on the clipboard */
  value: string
  /** what opening it actually launches */
  href: string
  openLabel: string
  /** the mail client may simply not exist; a link always opens */
  fallbackHint?: string
}

export function AboutSection(): JSX.Element {
  const showToast = useUi((s) => s.showToast)
  const platform = PLATFORM_LABELS[window.api.platform] ?? window.api.platform

  const contacts: Contact[] = [
    {
      id: 'mail',
      icon: 'mail',
      value: FEEDBACK_EMAIL,
      href: `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Relay feedback')}`,
      openLabel: 'Написать',
      fallbackHint: 'Почтовый клиент не открылся — адрес скопирован'
    },
    {
      id: 'github',
      icon: 'link',
      value: FEEDBACK_GITHUB.replace(/^https?:\/\//, ''),
      href: FEEDBACK_GITHUB,
      openLabel: 'Открыть'
    },
    {
      id: 'telegram',
      icon: 'send',
      value: '@' + FEEDBACK_TELEGRAM.split('/').pop(),
      href: FEEDBACK_TELEGRAM,
      openLabel: 'Написать'
    }
  ]

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  const open = async (contact: Contact): Promise<void> => {
    try {
      await window.api.openExternal(contact.href)
    } catch {
      // No mail client / no handler for the protocol: leave the user with the
      // address instead of a button that looks broken.
      const copied = await copy(contact.value)
      showToast(tr(copied ? (contact.fallbackHint ?? 'Не удалось открыть ссылку — адрес скопирован') : 'Не удалось открыть ссылку'), 'error')
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
        {contacts.map((contact) => (
          <div className="about-contact" key={contact.id}>
            <Icon name={contact.icon} size={14} className="about-contact-ico" />
            <span className="about-contact-value mono">{contact.value}</span>
            <button className="btn primary" onClick={() => void open(contact)}>
              {tr(contact.openLabel)}
            </button>
            <button
              className="btn"
              title={tr('Копировать')}
              onClick={() => void copy(contact.value).then((ok) => showToast(tr(ok ? 'Скопировано' : 'Не удалось скопировать'), ok ? 'ok' : 'error'))}
            >
              <Icon name="copy" size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

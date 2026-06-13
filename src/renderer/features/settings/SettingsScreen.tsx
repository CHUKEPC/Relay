import { useEffect, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Kbd } from '@renderer/components/primitives'
import { ProvidersSection } from './ProvidersSection'
import { AppearanceSection } from './AppearanceSection'
import { PluginsSection } from './PluginsSection'
import { GeneralSection } from './GeneralSection'
import { NetworkSection } from './NetworkSection'
import { DataSection } from './DataSection'
import { ShortcutsSection } from './ShortcutsSection'
import { HelpSection } from './HelpSection'
import { AboutSection } from './AboutSection'
import type { SettingsSection } from '@renderer/store/ui'
import '@renderer/styles/feat-help.css'

// Re-export so existing importers of this module keep working.
export type { SettingsSection }

const NAV: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'providers', label: 'AI-провайдеры', icon: 'sparkle' },
  { id: 'appearance', label: 'Внешний вид', icon: 'sun' },
  { id: 'plugins', label: 'Плагины', icon: 'grid' },
  { id: 'general', label: 'Основные', icon: 'settings' },
  { id: 'network', label: 'Сеть', icon: 'link' },
  { id: 'data', label: 'Данные', icon: 'download' },
  { id: 'shortcuts', label: 'Горячие клавиши', icon: 'bolt' },
  { id: 'help', label: 'Справка', icon: 'book' },
  { id: 'about', label: 'О приложении', icon: 'info' }
]

export function SettingsScreen({
  onClose,
  initialSection
}: {
  onClose: () => void
  initialSection?: SettingsSection
}): JSX.Element {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'providers')

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Настройки">
      <div className="settings-top">
        <button className="icon-btn" onClick={onClose} title="Назад" aria-label="Назад">
          <Icon name="arrowR" size={17} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <h2>Настройки</h2>
        <div style={{ flex: 1 }} />
        <Kbd>Esc</Kbd>
      </div>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {NAV.map((s) => (
            <div
              key={s.id}
              className={`snav-item${section === s.id ? ' on' : ''}`}
              onClick={() => setSection(s.id)}
              role="button"
              tabIndex={0}
              aria-current={section === s.id}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSection(s.id)
                }
              }}
            >
              <Icon name={s.icon} size={16} />
              {s.label}
            </div>
          ))}
        </nav>

        <div className="settings-content">
          <div className="inner">
            {section === 'providers' && <ProvidersSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'plugins' && <PluginsSection />}
            {section === 'general' && <GeneralSection />}
            {section === 'network' && <NetworkSection />}
            {section === 'data' && <DataSection />}
            {section === 'shortcuts' && <ShortcutsSection />}
            {section === 'help' && <HelpSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  )
}

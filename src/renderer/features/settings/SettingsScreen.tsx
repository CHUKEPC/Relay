import { useEffect } from 'react'
import { useUi } from '@renderer/store/ui'
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
import { useCap, useFeatures } from '@renderer/store/features'
import type { Capability } from '@shared/features'
import { tr } from '@renderer/lib/i18n'
import '@renderer/styles/feat-help.css'

// Re-export so existing importers of this module keep working.
export type { SettingsSection }

const NAV: { id: SettingsSection; label: string; icon: string; cap?: Capability }[] = [
  { id: 'providers', label: 'AI-провайдеры', icon: 'sparkle', cap: 'ai' },
  { id: 'appearance', label: 'Внешний вид', icon: 'sun' },
  { id: 'plugins', label: 'Плагины', icon: 'grid' },
  { id: 'general', label: 'Основные', icon: 'settings' },
  { id: 'network', label: 'Сеть', icon: 'link' },
  { id: 'data', label: 'Данные', icon: 'download' },
  { id: 'shortcuts', label: 'Горячие клавиши', icon: 'bolt' },
  { id: 'help', label: 'Справка', icon: 'book' },
  { id: 'about', label: 'О приложении', icon: 'info' }
]

export function SettingsScreen({ onClose }: { onClose: () => void }): JSX.Element {
  // Driven by the ui store so in-app links (e.g. "see Help") can switch sections.
  const section = useUi((s) => s.settingsSection)
  const setSection = (id: SettingsSection): void => useUi.setState({ settingsSection: id })
  const caps = useFeatures((s) => s.caps)
  const hasAi = useCap('ai')
  // Sections whose feature pack is off disappear entirely.
  const nav = NAV.filter((s) => !s.cap || caps.has(s.cap))

  // Turning off the pack backing the open section would leave a blank pane.
  useEffect(() => {
    if (!nav.some((s) => s.id === section)) setSection(nav[0].id)
  }, [nav, section])

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
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={tr('Настройки')}>
      <div className="settings-top">
        <button className="icon-btn" onClick={onClose} title={tr('Назад')} aria-label={tr('Назад')}>
          <Icon name="arrowR" size={17} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <h2>{tr('Настройки')}</h2>
        <div style={{ flex: 1 }} />
        <Kbd>Esc</Kbd>
      </div>

      <div className="settings-body">
        <nav className="settings-nav" aria-label={tr('Разделы настроек')}>
          {nav.map((s) => (
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
              {tr(s.label)}
            </div>
          ))}
        </nav>

        <div className="settings-content">
          <div className="inner">
            {section === 'providers' && hasAi && <ProvidersSection />}
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

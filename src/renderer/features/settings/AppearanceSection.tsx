import type { SettingsDoc } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useSettings } from '@renderer/store/settings'

type ThemeChoice = SettingsDoc['theme']

interface ThemeSwatchDef {
  id: ThemeChoice
  label: string
  /** [sidebar, surface] preview colors */
  bg: [string, string]
}

const THEME_SWATCHES: ThemeSwatchDef[] = [
  { id: 'dark', label: 'Тёмная', bg: ['#1a1b1f', '#26272d'] },
  { id: 'light', label: 'Светлая', bg: ['#f7f7f8', '#ffffff'] },
  { id: 'system', label: 'Системная', bg: ['#1a1b1f', '#f7f7f8'] }
]

const ACCENT_HUES = [264, 158, 25, 305, 200]

export function AppearanceSection(): JSX.Element {
  const theme = useSettings((s) => s.settings.theme)
  const accentHue = useSettings((s) => s.settings.accentHue)
  const setTheme = useSettings((s) => s.setTheme)
  const setAccentHue = useSettings((s) => s.setAccentHue)

  return (
    <>
      <div className="set-h">Внешний вид</div>
      <div className="set-sub">Тема и акцентный цвет интерфейса.</div>

      <div className="set-group-label">Тема</div>
      <div className="theme-swatch-row">
        {THEME_SWATCHES.map((t) => (
          <div
            key={t.id}
            className={`theme-swatch${theme === t.id ? ' on' : ''}`}
            onClick={() => setTheme(t.id)}
            role="button"
            tabIndex={0}
            aria-pressed={theme === t.id}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setTheme(t.id)
              }
            }}
          >
            <div className="prev">
              <div style={{ width: '38%', background: t.bg[0] }} />
              <div style={{ flex: 1, background: t.bg[1], display: 'grid', placeItems: 'center' }}>
                <div style={{ width: 28, height: 6, borderRadius: 3, background: 'oklch(0.62 0.19 264)' }} />
              </div>
            </div>
            <div className="lab">
              {t.label}
              {theme === t.id && <Icon name="check" size={13} style={{ color: 'var(--accent)', float: 'right' }} />}
            </div>
          </div>
        ))}
      </div>

      <div className="set-group-label">Акцентный цвет</div>
      <div style={{ display: 'flex', gap: 10 }}>
        {ACCENT_HUES.map((h) => {
          const selected = accentHue === h
          return (
            <button
              key={h}
              title={`oklch hue ${h}`}
              aria-label={`Акцент ${h}`}
              aria-pressed={selected}
              onClick={() => setAccentHue(h)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                cursor: 'pointer',
                background: `oklch(0.62 0.19 ${h})`,
                boxShadow: selected
                  ? `0 0 0 2px var(--bg-0), 0 0 0 4px oklch(0.62 0.19 ${h})`
                  : 'inset 0 1px 0 oklch(1 0 0 / 0.2)'
              }}
            />
          )
        })}
      </div>
    </>
  )
}

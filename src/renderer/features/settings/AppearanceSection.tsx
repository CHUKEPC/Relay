import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { CustomTheme, SettingsDoc, ThemePreset } from '@shared/types'
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

// A fuller spectrum of accent presets (blue → teal → green → amber → red → pink → purple).
const ACCENT_HUES = [264, 230, 200, 170, 145, 110, 70, 40, 20, 330, 300]

interface BrandPresetDef {
  id: ThemePreset
  label: string
  /** [sidebar, surface] preview colors */
  bg: [string, string]
  accent: string
  /** show a tiny accent dot next to the label */
  dot?: boolean
}

const BRAND_PRESETS: BrandPresetDef[] = [
  { id: 'relay', label: 'Relay', bg: ['#1a1b1f', '#26272d'], accent: 'oklch(0.62 0.19 264)' },
  { id: 'postman', label: 'Postman', bg: ['#1c1c1c', '#262626'], accent: '#ff6c37', dot: true },
  { id: 'insomnia', label: 'Insomnia', bg: ['#13111c', '#201c2e'], accent: '#9b6dff', dot: true }
]

const CUSTOM_VAR_ROWS: { key: string; label: string }[] = [
  { key: '--bg-0', label: 'Фон' },
  { key: '--bg-1', label: 'Панели' },
  { key: '--bg-2', label: 'Элементы' },
  { key: '--tx-0', label: 'Текст' },
  { key: '--tx-2', label: 'Вторичный текст' },
  { key: '--line', label: 'Линии' }
]

/** Sensible defaults when a computed token can't be parsed to hex. */
const FALLBACK_VARS: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--bg-0': '#131419',
    '--bg-1': '#1a1b20',
    '--bg-2': '#222329',
    '--tx-0': '#f2f2f5',
    '--tx-2': '#8a8c97',
    '--line': '#34353d'
  },
  light: {
    '--bg-0': '#fafafc',
    '--bg-1': '#f2f2f5',
    '--bg-2': '#ffffff',
    '--tx-0': '#27282e',
    '--tx-2': '#84868f',
    '--line': '#dddee3'
  }
}

/**
 * Convert any CSS color (incl. oklch) to #rrggbb via a 1px canvas.
 * `behind` flattens translucent colors against a backdrop (e.g. --line over --bg-0).
 */
function cssColorToHex(css: string, behind?: string): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    if (behind) {
      ctx.fillStyle = behind
      ctx.fillRect(0, 0, 1, 1)
    }
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    if (d[3] === 0) return null
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function readTokenHex(name: string, fallback: string, behind?: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  return cssColorToHex(raw, behind) ?? fallback
}

function normalizeHex(value: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim())
  return m ? '#' + m[1].toLowerCase() : null
}

/** Pre-fill the editor from the saved custom theme or the currently rendered look. */
function buildDraft(existing: CustomTheme | null, base: 'light' | 'dark'): CustomTheme {
  if (existing) {
    return { base: existing.base, vars: { ...FALLBACK_VARS[existing.base], ...existing.vars } }
  }
  const fb = FALLBACK_VARS[base]
  const bg0 = readTokenHex('--bg-0', fb['--bg-0'])
  const vars: Record<string, string> = {}
  for (const row of CUSTOM_VAR_ROWS) {
    vars[row.key] = row.key === '--bg-0' ? bg0 : readTokenHex(row.key, fb[row.key], bg0)
  }
  return { base, vars }
}

function ColorRow(props: {
  label: string
  value: string
  onChange: (hex: string) => void
}): JSX.Element {
  const { label, value, onChange } = props
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="cte-row">
      <span className="cte-label">{label}</span>
      <input
        type="color"
        className="cte-color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      <input
        className="cte-hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const hex = normalizeHex(e.target.value)
          if (hex) onChange(hex)
        }}
        onBlur={() => setText(value)}
      />
    </div>
  )
}

export function AppearanceSection(): JSX.Element {
  const theme = useSettings((s) => s.settings.theme)
  const accentHue = useSettings((s) => s.settings.accentHue)
  const accentColor = useSettings((s) => s.settings.accentColor)
  const themePreset = useSettings((s) => s.settings.themePreset)
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  const setTheme = useSettings((s) => s.setTheme)
  const setAccentHue = useSettings((s) => s.setAccentHue)
  const setAccentColor = useSettings((s) => s.setAccentColor)
  const setThemePreset = useSettings((s) => s.setThemePreset)
  const setCustomTheme = useSettings((s) => s.setCustomTheme)

  const [draft, setDraft] = useState<CustomTheme | null>(null)

  // Open/close the inline editor with the 'custom' preset; pre-fill once on open.
  useEffect(() => {
    if (themePreset === 'custom') {
      setDraft((d) => d ?? buildDraft(useSettings.getState().settings.customTheme, resolvedTheme))
    } else {
      setDraft(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePreset])

  // Current accent as hex for the RGB controls (hue-derived accents are oklch).
  const accentHex = useMemo(
    () => accentColor ?? cssColorToHex(`oklch(0.62 0.19 ${accentHue})`) ?? '#6c5ce7',
    [accentColor, accentHue]
  )

  const selectCard = (apply: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: apply,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        apply()
      }
    }
  })

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
            aria-pressed={theme === t.id}
            {...selectCard(() => setTheme(t.id))}
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

      <div className="set-group-label">Фирменные темы</div>
      <div className="theme-swatch-row brand-theme-row">
        {BRAND_PRESETS.map((p) => (
          <div
            key={p.id}
            className={`theme-swatch${themePreset === p.id ? ' on' : ''}`}
            title={p.id === 'relay' ? 'Стандартная тема Relay' : `В стиле ${p.label}`}
            aria-pressed={themePreset === p.id}
            {...selectCard(() => setThemePreset(p.id))}
          >
            <div className="prev">
              <div style={{ width: '38%', background: p.bg[0] }} />
              <div style={{ flex: 1, background: p.bg[1], display: 'grid', placeItems: 'center' }}>
                <div style={{ width: 28, height: 6, borderRadius: 3, background: p.accent }} />
              </div>
            </div>
            <div className="lab">
              {p.label}
              {p.dot && <span className="accent-dot" style={{ background: p.accent }} />}
              {themePreset === p.id && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
            </div>
          </div>
        ))}
        <div
          className={`theme-swatch${themePreset === 'custom' ? ' on' : ''}`}
          title="Создать собственную тему"
          aria-pressed={themePreset === 'custom'}
          {...selectCard(() => setThemePreset('custom'))}
        >
          <div className="prev custom-prev">
            <Icon name="plus" size={18} />
          </div>
          <div className="lab">
            Создать свою
            {themePreset === 'custom' && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
          </div>
        </div>
      </div>

      {themePreset === 'custom' && draft && (
        <div className="custom-theme-editor">
          <div className="cte-base-row">
            <button
              className={`cte-base-btn${draft.base === 'light' ? ' on' : ''}`}
              onClick={() => setDraft({ ...draft, base: 'light' })}
            >
              Светлая
            </button>
            <button
              className={`cte-base-btn${draft.base === 'dark' ? ' on' : ''}`}
              onClick={() => setDraft({ ...draft, base: 'dark' })}
            >
              Тёмная
            </button>
          </div>
          {CUSTOM_VAR_ROWS.map((row) => (
            <ColorRow
              key={row.key}
              label={row.label}
              value={draft.vars[row.key] ?? FALLBACK_VARS[draft.base][row.key]}
              onChange={(hex) => setDraft({ ...draft, vars: { ...draft.vars, [row.key]: hex } })}
            />
          ))}
          <ColorRow label="Акцент" value={accentHex} onChange={(hex) => setAccentColor(hex)} />
          <div className="cte-actions">
            <button className="btn primary" onClick={() => setCustomTheme({ base: draft.base, vars: { ...draft.vars } })}>
              Применить
            </button>
            <button className="btn" onClick={() => setThemePreset('relay')}>
              Сбросить
            </button>
          </div>
        </div>
      )}

      <div className="set-group-label">Акцентный цвет</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 460 }}>
        {ACCENT_HUES.map((h) => {
          const selected = accentColor === null && accentHue === h
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
      <div className="accent-custom-row">
        <ColorRow label="Свой цвет (RGB)" value={accentHex} onChange={(hex) => setAccentColor(hex)} />
      </div>
    </>
  )
}

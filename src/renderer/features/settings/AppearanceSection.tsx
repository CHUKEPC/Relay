import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { CustomTheme, SettingsDoc, ThemePreset } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useSettings } from '@renderer/store/settings'
import { useCap, useFeatures } from '@renderer/store/features'
import { useUi } from '@renderer/store/ui'
import { themeVariant, type PackTheme } from '@shared/pack-data'
import { THEME_GUIDE_URL } from '@shared/constants'
import { useUserThemes } from '@renderer/store/user-themes'

import { tr, trf, useI18n } from '@renderer/lib/i18n'
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

// Postman, Insomnia and the rest live in the theme pack since 1.2.
const BRAND_PRESETS: BrandPresetDef[] = [{ id: 'relay', label: 'Relay', bg: ['#1a1b1f', '#26272d'], accent: 'oklch(0.62 0.19 264)' }]

/** UI mode a theme card previews: the chosen mode, or the OS mode for 'system'. */
function previewMode(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function PackThemeCard({ theme, mode, on, card }: { theme: PackTheme; mode: 'light' | 'dark'; on: boolean; card: Record<string, unknown> }) {
  const { vars } = themeVariant(theme, mode)
  const accent = theme.accent ?? vars['--accent'] ?? 'oklch(0.62 0.19 264)'
  const only = theme.variants.dark && theme.variants.light ? null : theme.variants.dark ? 'dark' : 'light'
  return (
    <div className={`theme-swatch${on ? ' on' : ''}`} title={theme.description ? tr(theme.description) : theme.name} aria-pressed={on} {...card}>
      <div className="prev">
        <div style={{ width: '38%', background: vars['--bg-1'] ?? vars['--bg-0'] }} />
        <div style={{ flex: 1, background: vars['--bg-2'] ?? vars['--bg-0'], display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 28, height: 6, borderRadius: 3, background: accent }} />
        </div>
      </div>
      <div className="lab">
        <span className="accent-dot" style={{ background: accent }} />
        <span className="pack-theme-name">{tr(theme.name)}</span>
        {only && (
          <span className="pack-theme-mode" title={only === 'dark' ? tr('Только тёмный вариант') : tr('Только светлый вариант')}>
            <Icon name={only === 'dark' ? 'moon' : 'sun'} size={11} />
          </span>
        )}
        {on && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
      </div>
    </div>
  )
}

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
  const setPackTheme = useSettings((s) => s.setPackTheme)
  const packTheme = useSettings((s) => s.settings.packTheme)
  const hasThemePack = useCap('themes.extra')
  const packThemes = useFeatures((s) => s.themes)
  const userThemes = useUserThemes((s) => s.themes)

  /** Pick a JSON theme file, validate it, and add what it holds. */
  const loadThemeFile = async (): Promise<void> => {
    const picked = await window.api.openFile({ filters: [{ name: 'JSON', extensions: ['json'] }] })
    const file = picked?.[0]
    if (!file) return
    const toast = useUi.getState().showToast
    try {
      const text = await window.api.readTextFile(file.filePath)
      const fallbackName = file.fileName.replace(/.json$/i, '')
      const res = useUserThemes.getState().addFromText(text, fallbackName)
      if (res.error) {
        const why: Record<string, string> = {
          'too-large': tr('Файл слишком большой для темы'),
          'not-json': tr('Это не JSON-файл'),
          'no-themes': tr('В файле нет ни одной темы в понятном формате — смотрите руководство по темам')
        }
        toast(why[res.error] ?? tr('Не удалось прочитать тему'), 'error')
        return
      }
      toast(
        res.replaced
          ? trf('Добавлено тем: {added}, обновлено: {replaced}', { added: res.added, replaced: res.replaced })
          : trf('Добавлено тем: {added}', { added: res.added })
      )
    } catch (err) {
      toast(trf('Не удалось прочитать файл: {message}', { message: err instanceof Error ? err.message : String(err) }), 'error')
    }
  }

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
      <div className="set-h">{tr('Внешний вид')}</div>
      <div className="set-sub">{tr('Тема и акцентный цвет интерфейса.')}</div>

      <div className="set-group-label">{tr('Тема')}</div>
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
              {tr(t.label)}
              {theme === t.id && <Icon name="check" size={13} style={{ color: 'var(--accent)', float: 'right' }} />}
            </div>
          </div>
        ))}
      </div>

      <div className="set-group-label">{tr('Оформление')}</div>
      <div className="theme-swatch-row brand-theme-row">
        {BRAND_PRESETS.map((p) => (
          <div
            key={p.id}
            className={`theme-swatch${themePreset === p.id ? ' on' : ''}`}
            title={p.id === 'relay' ? tr('Стандартная тема Relay') : trf('В стиле {name}', { name: p.label })}
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
              {tr(p.label)}
              {p.dot && <span className="accent-dot" style={{ background: p.accent }} />}
              {themePreset === p.id && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
            </div>
          </div>
        ))}
        <div
          className={`theme-swatch${themePreset === 'custom' ? ' on' : ''}`}
          title={tr('Создать собственную тему')}
          aria-pressed={themePreset === 'custom'}
          {...selectCard(() => setThemePreset('custom'))}
        >
          <div className="prev custom-prev">
            <Icon name="plus" size={18} />
          </div>
          <div className="lab">
            {tr('Создать свою')}
            {themePreset === 'custom' && <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />}
          </div>
        </div>
      </div>

      {hasThemePack ? (
        packThemes.length > 0 && (
          <>
            <div className="set-group-label">{tr('Темы из плагинов')}</div>
            <div className="theme-swatch-row brand-theme-row pack-theme-row">
              {packThemes.map((t) => (
                <PackThemeCard
                  key={t.id}
                  theme={t}
                  mode={previewMode(theme)}
                  on={themePreset === 'pack' && packTheme === t.id}
                  card={selectCard(() => setPackTheme(t))}
                />
              ))}
            </div>
          </>
        )
      ) : (
        <div className="pack-theme-hint">
          <Icon name="info" size={13} />
          <span>
            {tr('Postman, Insomnia, Dracula, Nord и другие темы — в плагине «Пак тем оформления».')}{' '}
            <button className="link-btn" onClick={() => useUi.getState().openSettings('plugins')}>
              {tr('Открыть «Плагины»')}
            </button>
          </span>
        </div>
      )}

      <div className="set-group-label">{tr('Мои темы')}</div>
      <div className="user-theme-head">
        <span className="d">
          {tr('Темы из файла: один JSON с цветами. Формат и пример — в руководстве по темам.')}{' '}
          <button className="link-btn" onClick={() => void window.api.openExternal(useI18n.getState().lang === 'ru' ? THEME_GUIDE_URL.ru : THEME_GUIDE_URL.en)}>
            {tr('Открыть руководство')}
          </button>
        </span>
        <button className="btn" onClick={() => void loadThemeFile()}>
          <Icon name="download" size={14} /> {tr('Загрузить тему…')}
        </button>
      </div>
      {userThemes.length > 0 && (
        <div className="theme-swatch-row brand-theme-row pack-theme-row">
          {userThemes.map((t) => (
            <div key={t.id} className="user-theme-cell">
              <PackThemeCard
                theme={t}
                mode={previewMode(theme)}
                on={themePreset === 'pack' && packTheme === t.id}
                card={selectCard(() => setPackTheme(t))}
              />
              <button
                className="icon-btn user-theme-del"
                title={tr('Удалить тему')}
                onClick={() => {
                  useUserThemes.getState().remove(t.id)
                  // The active theme must not vanish from under the user.
                  if (themePreset === 'pack' && packTheme === t.id) setThemePreset('relay')
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {themePreset === 'custom' && draft && (
        <div className="custom-theme-editor">
          <div className="cte-base-row">
            <button
              className={`cte-base-btn${draft.base === 'light' ? ' on' : ''}`}
              onClick={() => setDraft({ ...draft, base: 'light' })}
            > {tr('Светлая')} </button>
            <button
              className={`cte-base-btn${draft.base === 'dark' ? ' on' : ''}`}
              onClick={() => setDraft({ ...draft, base: 'dark' })}
            > {tr('Тёмная')} </button>
          </div>
          {CUSTOM_VAR_ROWS.map((row) => (
            <ColorRow
              key={row.key}
              label={tr(row.label)}
              value={draft.vars[row.key] ?? FALLBACK_VARS[draft.base][row.key]}
              onChange={(hex) => setDraft({ ...draft, vars: { ...draft.vars, [row.key]: hex } })}
            />
          ))}
          <ColorRow label={tr('Акцент')} value={accentHex} onChange={(hex) => setAccentColor(hex)} />
          <div className="cte-actions">
            <button className="btn primary" onClick={() => setCustomTheme({ base: draft.base, vars: { ...draft.vars } })}> {tr('Применить')} </button>
            <button className="btn" onClick={() => setThemePreset('relay')}> {tr('Сбросить')} </button>
          </div>
        </div>
      )}

      <div className="set-group-label">{tr('Акцентный цвет')}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 460 }}>
        {ACCENT_HUES.map((h) => {
          const selected = accentColor === null && accentHue === h
          return (
            <button
              key={h}
              title={`oklch hue ${h}`}
              aria-label={trf('Акцент {hue}', { hue: h })}
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
        <ColorRow label={tr('Свой цвет (RGB)')} value={accentHex} onChange={(hex) => setAccentColor(hex)} />
      </div>
    </>
  )
}

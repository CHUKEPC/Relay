import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { CUSTOM_APP_ICON, DEFAULT_APP_ICON, ICON_GLYPHS, ICON_PRESETS, ICON_SHAPES, type AppIconDef, type IconShape } from '@shared/app-icon'
import type { AppIconResult } from '@shared/ipc-contract'
import { ICON_GUIDE_URL } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { AppIconImage } from '@renderer/components/AppIconImage'
import { Toggle } from '@renderer/components/primitives'
import { useSettings } from '@renderer/store/settings'
import { useCap, useFeatures } from '@renderer/store/features'
import { useUserIcons } from '@renderer/store/user-icons'
import { useUi } from '@renderer/store/ui'
import { pictureToIconPng } from '@renderer/lib/app-icon-render'
import { chooseAppIcon, chooseCustomIcon, pushAppIcon, RELAY_ICON, resolveAppIcon } from '@renderer/lib/app-icon'
import { ColorRow, cssColorToHex } from './color-input'
import { tr, trf, useI18n } from '@renderer/lib/i18n'
import '@renderer/styles/feat-app-icon.css'

const SHAPE_LABEL: Record<IconShape, string> = {
  squircle: 'Скруглённый квадрат',
  circle: 'Круг',
  square: 'Квадрат',
  hexagon: 'Шестиугольник'
}

/** Glyphs offered in the editor, in this order; 'letter' gets its own button. */
const GLYPHS = Object.keys(ICON_GLYPHS).filter((g) => g !== 'letter')

const LETTER_RE = /^[\p{L}\p{N}]{1,2}$/u

const PICTURE_EXT = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'bmp', 'ico']
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon'
}

const hex = (c: string | undefined, fallback: string): string => (c && cssColorToHex(c)) || fallback

/** A design to edit: the current one (a picture cannot be edited, so the Relay one then). */
function draftFrom(def: AppIconDef): AppIconDef {
  const base = def.image ? RELAY_ICON : def
  const top = hex(base.background[0], '#5a8dff')
  return {
    id: CUSTOM_APP_ICON,
    name: tr('Своя'),
    shape: base.shape,
    background: [top, hex(base.background[base.background.length - 1], top)],
    glyph: base.glyph,
    glyphColor: hex(base.glyphColor, '#ffffff'),
    letter: base.letter ?? 'R'
  }
}

function IconCard({ def, on, title, onSelect, children }: { def: AppIconDef | null; on: boolean; title?: string; onSelect: () => void; children?: ReactNode }) {
  return (
    <div
      className={`icon-card${on ? ' on' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      title={title ?? (def ? tr(def.description ?? def.name) : undefined)}
      onClick={onSelect}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="icon-card-img">{children ?? <AppIconImage def={def} size={44} />}</div>
      <div className="icon-card-lab">
        <span className="icon-card-name">{def ? tr(def.name) : ''}</span>
        {on && <Icon name="check" size={12} style={{ color: 'var(--accent)', flex: 'none' }} />}
      </div>
    </div>
  )
}

/** Settings → Appearance → «Иконка приложения». */
export function AppIconSection(): JSX.Element {
  const appIcon = useSettings((s) => s.settings.appIcon) || DEFAULT_APP_ICON
  const customIcon = useSettings((s) => s.settings.customAppIcon ?? null)
  const shortcuts = useSettings((s) => !!s.settings.appIconShortcuts)
  const hasPack = useCap('icons.extra')
  const packIcons = useFeatures((s) => s.icons)
  const userIcons = useUserIcons((s) => s.icons)
  const isWin = window.api.platform === 'win32'
  const [draft, setDraft] = useState<AppIconDef | null>(null)
  const toast = useUi((s) => s.showToast)

  const report = (res: AppIconResult): void => {
    if (!res.ok) {
      toast(trf('Не удалось поменять иконку: {message}', { message: res.error === 'not-png' ? tr('картинка не читается') : res.error }), 'error')
      return
    }
    toast(res.shortcuts ? trf('Иконка применена; ярлыков обновлено: {n}', { n: res.shortcuts }) : tr('Иконка применена'))
  }

  const pick = (def: AppIconDef): void => {
    setDraft(null)
    void chooseAppIcon(def).then(report)
  }

  const openEditor = (): void => {
    const settings = useSettings.getState().settings
    setDraft(draftFrom(customIcon ?? resolveAppIcon(settings)))
    // A saved design of one's own is put back right away, like picking a card.
    if (customIcon && appIcon !== CUSTOM_APP_ICON) void chooseCustomIcon(customIcon).then(report)
  }

  /** Pick a picture or an icon description file and add it to «Мои иконки». */
  const loadIconFile = async (): Promise<void> => {
    const picked = await window.api.openFile({
      filters: [
        { name: tr('Картинка или описание иконки'), extensions: [...PICTURE_EXT, 'json'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    const file = picked?.[0]
    if (!file) return
    const ext = (/\.([a-z0-9]+)$/i.exec(file.fileName)?.[1] ?? '').toLowerCase()
    try {
      if (ext === 'json') {
        const res = useUserIcons.getState().addFromText(await window.api.readTextFile(file.filePath), file.fileName.replace(/\.json$/i, ''))
        if (res.error) {
          const why: Record<string, string> = {
            'too-large': tr('Файл слишком большой для описания иконки'),
            'not-json': tr('Это не JSON-файл'),
            'no-icons': tr('В файле нет ни одной иконки в понятном формате — смотрите руководство по иконкам')
          }
          toast(why[res.error] ?? tr('Не удалось прочитать иконку'), 'error')
          return
        }
        toast(
          res.replaced
            ? trf('Добавлено иконок: {added}, обновлено: {replaced}', { added: res.added, replaced: res.replaced })
            : trf('Добавлено иконок: {added}', { added: res.added })
        )
        return
      }
      if (!MIME[ext]) {
        toast(tr('Этот формат не подходит: нужна картинка PNG, JPEG, SVG, WebP, GIF, BMP или ICO'), 'error')
        return
      }
      const b64 = await window.api.readBinaryFile(file.filePath)
      const png = await pictureToIconPng(`data:${MIME[ext]};base64,${b64}`)
      const icon = useUserIcons.getState().addImage(png, file.fileName)
      if (!icon) {
        toast(tr('Картинка слишком большая для иконки'), 'error')
        return
      }
      toast(trf('Иконка «{name}» добавлена — выберите её в «Мои иконки»', { name: icon.name }))
    } catch (err) {
      toast(trf('Не удалось прочитать файл: {message}', { message: err instanceof Error ? err.message : String(err) }), 'error')
    }
  }

  const letterOk = draft?.glyph !== 'letter' || LETTER_RE.test(draft.letter ?? '')

  return (
    <>
      <div className="set-group-label">{tr('Иконка приложения')}</div>
      <div className="app-icon-sub">{tr('Иконка окон, панели задач и Dock. Ярлык и файл приложения в системе меняются отдельно — переключатель ниже (Windows).')}</div>
      <div className="icon-card-row">
        {ICON_PRESETS.map((def) => (
          <IconCard key={def.id} def={def} on={appIcon === def.id} title={def.id === DEFAULT_APP_ICON ? tr('Стандартная иконка Relay') : undefined} onSelect={() => pick(def)} />
        ))}
        <IconCard
          def={customIcon ? { ...customIcon, name: tr('Своя') } : { ...RELAY_ICON, name: tr('Создать свою') }}
          on={appIcon === CUSTOM_APP_ICON}
          title={tr('Собрать свою иконку: форма, цвета, значок или буква')}
          onSelect={openEditor}
        >
          {customIcon ? undefined : (
            <span className="icon-card-plus">
              <Icon name="plus" size={18} />
            </span>
          )}
        </IconCard>
      </div>

      {draft && (
        <div className="icon-editor">
          <div className="ie-preview">
            <AppIconImage def={draft} size={96} />
            <div className="ie-preview-small">
              <AppIconImage def={draft} size={32} />
              <AppIconImage def={draft} size={16} />
            </div>
          </div>
          <div className="ie-controls">
            <div className="ie-label">{tr('Форма')}</div>
            <div className="ie-options">
              {ICON_SHAPES.map((sh) => (
                <button
                  key={sh}
                  type="button"
                  className={`ie-opt${draft.shape === sh ? ' on' : ''}`}
                  title={tr(SHAPE_LABEL[sh])}
                  aria-label={tr(SHAPE_LABEL[sh])}
                  aria-pressed={draft.shape === sh}
                  onClick={() => setDraft({ ...draft, shape: sh })}
                >
                  <AppIconImage def={{ ...draft, shape: sh }} size={24} />
                </button>
              ))}
            </div>
            <div className="ie-label">{tr('Значок')}</div>
            <div className="ie-options">
              {GLYPHS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`ie-opt glyph${draft.glyph === g ? ' on' : ''}`}
                  aria-label={g}
                  aria-pressed={draft.glyph === g}
                  onClick={() => setDraft({ ...draft, glyph: g })}
                >
                  <svg width={18} height={18} viewBox="0 0 20 20" fill={ICON_GLYPHS[g].fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={ICON_GLYPHS[g].fill ? 1 : 1.7} strokeLinecap="round" strokeLinejoin="round">
                    <path d={ICON_GLYPHS[g].d} />
                  </svg>
                </button>
              ))}
              <button
                type="button"
                className={`ie-opt glyph letter${draft.glyph === 'letter' ? ' on' : ''}`}
                title={tr('Буква или две')}
                aria-pressed={draft.glyph === 'letter'}
                onClick={() => setDraft({ ...draft, glyph: 'letter', letter: draft.letter || 'R' })}
              >
                Aa
              </button>
            </div>
            {draft.glyph === 'letter' && (
              <div className="ie-letter-row">
                <input
                  className="input ie-letter"
                  value={draft.letter ?? ''}
                  maxLength={2}
                  aria-label={tr('Буквы на иконке')}
                  onChange={(e) => setDraft({ ...draft, letter: e.target.value.trim() })}
                />
                <span className="d">{letterOk ? tr('Одна-две буквы или цифры') : tr('Только буквы и цифры, одна или две')}</span>
              </div>
            )}
            <ColorRow label={tr('Фон сверху')} value={draft.background[0]} onChange={(c) => setDraft({ ...draft, background: [c, draft.background[1] ?? c] })} />
            <ColorRow label={tr('Фон снизу')} value={draft.background[1] ?? draft.background[0]} onChange={(c) => setDraft({ ...draft, background: [draft.background[0], c] })} />
            <ColorRow label={tr('Цвет значка')} value={draft.glyphColor} onChange={(c) => setDraft({ ...draft, glyphColor: c })} />
            <div className="cte-actions">
              <button
                className="btn primary"
                disabled={!letterOk}
                onClick={() => {
                  void chooseCustomIcon(draft).then(report)
                  setDraft(null)
                }}
              >
                {tr('Применить')}
              </button>
              <button className="btn" onClick={() => setDraft(null)}>
                {tr('Закрыть')}
              </button>
            </div>
          </div>
        </div>
      )}

      {hasPack ? (
        packIcons.length > 0 && (
          <>
            <div className="set-group-label">{tr('Иконки из плагинов')}</div>
            <div className="icon-card-row">
              {packIcons.map((def) => (
                <IconCard key={def.id} def={def} on={appIcon === def.id} onSelect={() => pick(def)} />
              ))}
            </div>
          </>
        )
      ) : (
        <div className="pack-theme-hint">
          <Icon name="info" size={13} />
          <span>
            {tr('Ещё иконки — в плагине «Пак иконок приложения».')}{' '}
            <button className="link-btn" onClick={() => useUi.getState().openSettings('plugins')}>
              {tr('Открыть «Плагины»')}
            </button>
          </span>
        </div>
      )}

      <div className="set-group-label">{tr('Мои иконки')}</div>
      <div className="user-theme-head">
        <span className="d">
          {tr('Своя картинка (PNG, JPEG, SVG, WebP, ICO) или JSON с описанием иконки — формат в руководстве.')}{' '}
          <button className="link-btn" onClick={() => void window.api.openExternal(useI18n.getState().lang === 'ru' ? ICON_GUIDE_URL.ru : ICON_GUIDE_URL.en)}>
            {tr('Открыть руководство')}
          </button>
        </span>
        <button className="btn" onClick={() => void loadIconFile()}>
          <Icon name="image" size={14} /> {tr('Загрузить иконку…')}
        </button>
      </div>
      {userIcons.length > 0 && (
        <div className="icon-card-row">
          {userIcons.map((def) => (
            <div key={def.id} className="user-theme-cell">
              <IconCard def={def} on={appIcon === def.id} onSelect={() => pick(def)} />
              <button
                className="icon-btn user-theme-del"
                title={tr('Удалить иконку')}
                onClick={() => {
                  useUserIcons.getState().remove(def.id)
                  // The icon in use must not vanish from under the user.
                  if (appIcon === def.id) void chooseAppIcon(RELAY_ICON).then(report)
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {isWin && (
        <div className="set-row app-icon-shortcuts">
          <div className="label">
            <div className="t">{tr('Иконка на ярлыках Windows')}</div>
            <div className="d">
              {tr('Ставить выбранную иконку и на ярлыки Relay: рабочий стол, меню «Пуск», значок, закреплённый на панели задач. Работает в установленном приложении; Проводник может обновить картинку не сразу.')}
            </div>
          </div>
          <Toggle
            checked={shortcuts}
            title={tr('Иконка на ярлыках Windows')}
            onChange={(v) => {
              useSettings.getState().update({ appIconShortcuts: v })
              void pushAppIcon().then(report)
            }}
          />
        </div>
      )}
    </>
  )
}

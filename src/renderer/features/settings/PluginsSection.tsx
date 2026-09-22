import { useEffect, useState } from 'react'
import type { PluginInfo, PluginPermission, PluginRunKind, PluginThemeContribution, SettingsDoc } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Popover, Toggle } from '@renderer/components/primitives'
import { usePlugins } from '@renderer/store/plugins'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { useFeatures } from '@renderer/store/features'
import { PackRow } from './FeaturePacks'

import { tr, trf, useI18n } from '@renderer/lib/i18n'
import { PLUGIN_GUIDE_URL } from '@shared/constants'
/** Human consequence line per permission token (consent must be readable). */
function permissionLabel(p: PluginPermission): string {
  if (p === 'net') return tr('Доступ в интернет — любой хост')
  if (p.startsWith('net:')) return trf('Доступ в интернет — только {host}', { host: p.slice('net:'.length) })
  if (p === 'request:read') return tr('Чтение запроса: метод, URL и заголовки (значения известных секретных заголовков скрыты)')
  if (p === 'response:read') return tr('Чтение ответа, включая тело (до 200 КБ) — может содержать токены')
  if (p === 'request:write') return tr('Изменение запроса перед отправкой')
  if (p === 'storage') return tr('Своё хранилище данных')
  if (p === 'clipboard') return tr('Запись в буфер обмена')
  if (p === 'history:read') return tr('Чтение истории запросов')
  return p
}

const RUN_KIND_LABEL: Record<PluginRunKind, string> = {
  button: 'кнопка',
  response: 'хук ответа',
  request: 'хук запроса',
  panel: 'панель',
  command: 'команда',
  workspace: 'хук пространства',
  collection: 'хук коллекции'
}

function lastRunLabel(event: PluginRunKind): string {
  return tr(RUN_KIND_LABEL[event] ?? event)
}

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 100,
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
  color: 'var(--tx-1)',
  whiteSpace: 'nowrap'
}

const warnChipStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: 'color-mix(in oklch, var(--s-4xx, #d97706) 50%, transparent)',
  color: 'var(--s-4xx, #d97706)'
}

function PluginCard({ info }: { info: PluginInfo }): JSX.Element {
  const setEnabled = usePlugins((s) => s.setEnabled)
  const setConfig = usePlugins((s) => s.setConfig)
  const setSecret = usePlugins((s) => s.setSecret)
  const setNetAllowlist = usePlugins((s) => s.setNetAllowlist)
  const deletePlugin = usePlugins((s) => s.deletePlugin)
  const customTheme = useSettings((s) => s.settings.customTheme)
  const themePreset = useSettings((s) => s.settings.themePreset)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Per-secret-field local draft (kept out of info.config — secrets never round-trip). */
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const [newHost, setNewHost] = useState('')

  // Reset the delete confirmation after a beat so a stray click can't linger.
  useEffect(() => {
    if (!confirmDelete) return
    const t = window.setTimeout(() => setConfirmDelete(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirmDelete])

  const m = info.manifest
  const buttons = m.contributes.buttons ?? []
  const panels = m.contributes.panels ?? []
  const commands = m.contributes.commands ?? []
  const themes = m.contributes.themes ?? []
  const events = m.contributes.events ?? []
  const broken = !!info.error
  const missingPerms = m.permissions.filter((p) => !info.granted.includes(p))
  const hasBroadNet = m.permissions.includes('net')

  const saveSecret = (key: string): void => {
    const value = secretDraft[key]
    if (value === undefined) return
    void setSecret(m.id, key, value)
    setSecretDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  }

  const buttonLocationLabel = (loc: string): string =>
    loc === 'response-toolbar' ? tr('панель ответа') : loc === 'titlebar' ? tr('верхняя панель') : tr('боковая панель')

  const applyTheme = (t: PluginThemeContribution): void => {
    const s = useSettings.getState().settings
    const patch: Partial<SettingsDoc> = {
      themePreset: 'custom',
      customTheme: { base: t.base, vars: t.vars, source: { pluginId: m.id, themeId: t.id } }
    }
    // Stash the user's own appearance once, so chained plugin themes don't
    // clobber the backup; revert restores it.
    if (!s.customTheme?.source) {
      patch.appearanceSnapshot = { themePreset: s.themePreset, customTheme: s.customTheme }
    }
    useSettings.getState().update(patch)
    useUi.getState().showToast(trf('Тема «{name}» применена', { name: t.label }))
  }

  const revertTheme = (): void => {
    const s = useSettings.getState().settings
    const snap = s.appearanceSnapshot
    useSettings.getState().update({
      themePreset: snap?.themePreset ?? 'relay',
      customTheme: snap?.customTheme ?? null,
      appearanceSnapshot: null
    })
    useUi.getState().showToast(tr('Прежняя тема восстановлена'))
  }

  // Applied = provenance matches AND the custom preset is still active — after
  // the user switches appearance manually the revert affordance must disappear.
  const isApplied = (t: PluginThemeContribution): boolean =>
    themePreset === 'custom' && customTheme?.source?.pluginId === m.id && customTheme.source.themeId === t.id

  return (
    <div className="set-row plugin-row">
      <div className="label">
        <div className="t">
          {m.name}
          <span className="pack-ver">{m.version}</span>
          {m.author && <span className="pack-ver">· {m.author}</span>}
        </div>

        {broken && (
          <div className="d err" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="warn" size={14} />
            {info.error}
          </div>
        )}

        {confirmDelete && <div className="d err">{tr('Папка плагина будет удалена с диска. Нажмите корзину ещё раз для подтверждения.')}</div>}

        {info.needsRegrant && !broken && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--s-4xx, #d97706)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="warn" size={14} /> {tr('Обновление плагина запрашивает новые разрешения — включите его заново, чтобы выдать их:')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {missingPerms.map((p) => (
                <span key={p} style={warnChipStyle}>
                  + {permissionLabel(p)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Per-host grant editor — narrow a broad `net` grant to specific hosts. */}
        {hasBroadNet && info.enabled && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12.5, marginBottom: 4 }}>
              {tr('Сеть: разрешённые хосты')}{' '}
              <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                {info.netAllowlist.length ? tr('(плагин ограничен этим списком)') : tr('(пусто = любой хост)')}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {info.netAllowlist.map((h) => (
                <span key={h} style={{ ...chipStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {h}
                  <button
                    className="icon-btn"
                    style={{ width: 16, height: 16 }}
                    title={tr('Убрать')}
                    onClick={() => void setNetAllowlist(m.id, info.netAllowlist.filter((x) => x !== h))}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
              <input
                className="input mono"
                placeholder={tr('example.com или *.example.com')}
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const host = newHost.trim().toLowerCase()
                  if (!host) return
                  if (!/^(\*\.)?[a-z0-9]([a-z0-9.-]{0,253})(:\d{1,5})?$/.test(host)) {
                    useUi.getState().showToast(tr('Некорректный хост (пример: example.com или *.example.com)'), 'error')
                    return
                  }
                  if (info.netAllowlist.includes(host)) {
                    useUi.getState().showToast(tr('Этот хост уже в списке'), 'error')
                    return
                  }
                  void setNetAllowlist(m.id, [...info.netAllowlist, host])
                  setNewHost('')
                }}
                style={{ width: 220, height: 26 }}
              />
            </div>
          </div>
        )}

        {m.config.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {m.config.map((f) => {
              if (f.type === 'secret') {
                const isSet = info.secretKeysSet.includes(f.key)
                const draft = secretDraft[f.key]
                const editing = draft !== undefined
                return (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>
                        {f.label}
                        <Icon name="key" size={12} style={{ marginLeft: 6, color: 'var(--tx-3)', verticalAlign: 'middle' }} />
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                        {f.description ? f.description + ' · ' : ''}
                        {isSet ? tr('сохранено в безопасном хранилище') : tr('не задано')}
                      </div>
                    </div>
                    <input
                      className="input mono"
                      type="password"
                      placeholder={isSet ? tr('•••••••• (сохранено)') : f.placeholder}
                      value={draft ?? ''}
                      onChange={(e) => setSecretDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveSecret(f.key)
                      }}
                      style={{ width: 200 }}
                    />
                    <button className="btn ghost" style={{ height: 30 }} disabled={!editing} onClick={() => saveSecret(f.key)} title={tr('Сохранить секрет')}>
                      {tr('Сохранить')}
                    </button>
                    {isSet && (
                      <button
                        className="icon-btn"
                        title={tr('Очистить секрет')}
                        onClick={() => {
                          // Drop any in-progress draft so the field doesn't keep
                          // showing (and re-saving) text that no longer applies.
                          setSecretDraft((d) => {
                            const next = { ...d }
                            delete next[f.key]
                            return next
                          })
                          void setSecret(m.id, f.key, '')
                        }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                )
              }
              return (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5 }}>{f.label}</div>
                    {f.description && <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>{f.description}</div>}
                  </div>
                  <input
                    className="input mono"
                    type="text"
                    placeholder={f.placeholder}
                    value={info.config[f.key] ?? ''}
                    onChange={(e) => setConfig(m.id, { ...info.config, [f.key]: e.target.value })}
                    style={{ width: 280 }}
                  />
                </div>
              )
            })}
          </div>
        )}

        {themes.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {themes.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <Icon name={t.base === 'dark' ? 'moon' : 'sun'} size={14} style={{ color: 'var(--tx-3)' }} />
                <div style={{ flex: 1, fontSize: 12.5 }}>
                  {trf('Тема «{name}»', { name: t.label })}{' '}
                  <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>({t.base === 'dark' ? tr('тёмная') : tr('светлая')})</span>
                </div>
                {isApplied(t) ? (
                  <button className="btn ghost" style={{ height: 28 }} onClick={revertTheme}>
                    {tr('Вернуть прежнюю')}
                  </button>
                ) : (
                  <button className="btn ghost" style={{ height: 28 }} onClick={() => applyTheme(t)}>
                    {tr('Применить')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Popover
        trigger={
          <button className="icon-btn" title={tr('О плагине')}>
            <Icon name="info" size={15} />
          </button>
        }
      >
        <div className="plugin-info">
          <div className="plugin-info-h">{m.name}</div>
          {m.description && <p>{m.description}</p>}

          <div className="plugin-info-sub">{tr('Разрешения')}</div>
          {m.permissions.length === 0 ? (
            <p>{tr('не требуются')}</p>
          ) : (
            <ul>
              {m.permissions.map((p) => (
                <li key={p}>{permissionLabel(p)}</li>
              ))}
            </ul>
          )}

          {(buttons.length > 0 || panels.length > 0 || commands.length > 0 || events.length > 0) && (
            <>
              <div className="plugin-info-sub">{tr('Что добавляет')}</div>
              <ul>
                {buttons.map((b) => (
                  <li key={b.id}>{trf('Кнопка «{label}» — {where}', { label: b.label, where: buttonLocationLabel(b.location) })}</li>
                ))}
                {panels.map((p) => (
                  <li key={p.id}>
                    {trf('Панель «{label}»{interactive} — вкладка ответа', { label: p.label, interactive: p.interactive ? tr(' (интерактивная)') : '' })}
                  </li>
                ))}
                {commands.map((c) => (
                  <li key={c.id}>{trf('Команда «{title}» — палитра ({key})', { title: c.title, key: '⌘K' })}</li>
                ))}
                {events.includes('response') && <li>{tr('Хук: после каждого ответа')}</li>}
                {events.includes('request') && <li>{tr('Хук: перед каждым запросом')}</li>}
                {events.includes('workspace') && <li>{tr('Хук: смена пространства')}</li>}
                {events.includes('collection') && <li>{tr('Хук: изменение коллекций')}</li>}
              </ul>
            </>
          )}

          {info.lastRun && (
            <>
              <div className="plugin-info-sub">{tr('Последний запуск')}</div>
              <p style={{ color: info.lastRun.error ? 'var(--s-5xx)' : undefined }}>
                {trf('{kind}, {ms} мс: {result}', {
                  kind: lastRunLabel(info.lastRun.event),
                  ms: info.lastRun.durationMs,
                  result: info.lastRun.error ? info.lastRun.error : tr('ок')
                })}
              </p>
              {info.lastRun.logs.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--tx-3)' }}>{trf('Логи ({count})', { count: info.lastRun.logs.length })}</summary>
                  <pre className="plugin-info-logs">{info.lastRun.logs.map((l) => `[${l.level}] ${l.message}`).join('\n')}</pre>
                </details>
              )}
            </>
          )}

          <div className="plugin-info-sub">{tr('Папка')}</div>
          <p>{tr('Плагины с кодом лежат в каталоге данных приложения.')}</p>
          <button className="btn ghost" style={{ height: 28 }} onClick={() => void window.api.pluginsOpenFolder()}>
            <Icon name="folder" size={13} /> {tr('Открыть папку')}
          </button>
        </div>
      </Popover>

      <button
        className="icon-btn"
        title={confirmDelete ? tr('Нажмите ещё раз — удалить папку плагина') : tr('Удалить плагин')}
        onClick={() => {
          if (confirmDelete) void deletePlugin(m.id)
          else setConfirmDelete(true)
        }}
      >
        <Icon name="trash" size={14} style={confirmDelete ? { color: 'var(--danger, #d14343)' } : undefined} />
      </button>

      <Toggle
        checked={info.enabled}
        disabled={broken}
        title={info.enabled ? tr('Выключить') : m.permissions.length ? tr('Включить и выдать разрешения') : tr('Включить')}
        onChange={(v) => void setEnabled(m.id, v)}
      />
    </div>
  )
}

export function PluginsSection(): JSX.Element {
  const plugins = usePlugins((s) => s.plugins)
  const refresh = usePlugins((s) => s.refresh)
  const packs = useFeatures((s) => s.plugins)
  const loaded = useFeatures((s) => s.loaded)
  const [installing, setInstalling] = useState(false)
  const showToast = useUi((s) => s.showToast)

  useEffect(() => {
    void usePlugins.getState().init()
  }, [])

  /**
   * One entry point for adding a plugin from anywhere on disk. The main process
   * decides what was picked: a capability pack (a folder with a manifest, or a
   * .zip holding one) or a code plugin archive.
   */
  const addPlugin = async (): Promise<void> => {
    setInstalling(true)
    try {
      const result = await window.api.featuresInstall()
      if (!result) return
      if (!result.ok) {
        showToast(`${tr('Не удалось подключить плагин')}: ${result.error}`, 'error')
        return
      }
      if (result.kind === 'pack') useFeatures.getState().setPlugins(result.list)
      else await refresh()
      showToast(trf('Плагин «{id}» подключён', { id: result.id }))
    } catch (err) {
      showToast(`${tr('Не удалось подключить плагин')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setInstalling(false)
    }
  }

  const empty = loaded && !packs.length && !plugins.length

  return (
    <>
      <div className="set-h">{tr('Плагины')}</div>
      <div className="set-sub">
        {tr(
          'Плагин — это папка с файлом plugin.json. Комплекты возможностей включают то, что уже есть в приложении (протоколы, AI-ассистент, языки), а плагины с кодом выполняются в изолированной песочнице и получают только выданные им разрешения. Кнопка ниже открывает папку plugins рядом с приложением — там ждут комплекты, которые не были выбраны при установке, — но выбрать плагин можно в любой папке компьютера.'
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0 18px', flexWrap: 'wrap' }}>
        <button className="btn" disabled={installing} onClick={() => void addPlugin()}>
          <Icon name="plus" size={14} /> {installing ? tr('Подключаем…') : tr('Выбрать плагин на компьютере…')}
        </button>
      </div>

      {!loaded && <div className="set-sub">{tr('Загрузка…')}</div>}
      {empty && <div className="set-sub">{tr('Ни одного плагина не подключено. Нажмите «Выбрать плагин на компьютере…» — откроется папка plugins с комплектами, которые идут в составе приложения.')}</div>}

      {packs.map((p) => (
        <PackRow key={p.id} pack={p} />
      ))}
      {plugins.map((p) => (
        <PluginCard key={p.manifest.id} info={p} />
      ))}

      <div className="plugin-guide-note">
        <Icon name="book" size={16} />
        <div>
          <div className="plugin-guide-title">{tr('Хотите написать свой плагин?')}</div>
          <div>
            {tr(
              'Подробное руководство с примерами — темы, сниппеты, кнопки, вкладки ответа, изменение запросов, разрешения и упаковка — лежит в репозитории Relay на GitHub, в папке docs/plugin-guide.'
            )}{' '}
            <button className="link-btn" onClick={() => void window.api.openExternal(useI18n.getState().lang === 'ru' ? PLUGIN_GUIDE_URL.ru : PLUGIN_GUIDE_URL.en)}>
              {tr('Открыть руководство')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

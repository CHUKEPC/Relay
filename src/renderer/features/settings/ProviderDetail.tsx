import { useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { IconButton } from '@renderer/components/primitives'
import { useAi } from '@renderer/store/ai'

import { tr, trf } from '@renderer/lib/i18n'
const MASKED_PLACEHOLDER = '••••••••••••••••'

type KeyHint = { kind: 'ok' | 'neutral' | 'error'; text: string } | null

const KEY_URLS: Partial<Record<ProviderConfig['kind'], string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys'
}

/** Whether this provider exposes an editable Base URL field. */
function hasBaseUrl(kind: ProviderConfig['kind']): boolean {
  return kind === 'openrouter' || kind === 'openai-compatible'
}

/** Local/self-hosted OpenAI-compatible servers usually work without a key. */
function keyOptional(kind: ProviderConfig['kind']): boolean {
  return kind === 'openai-compatible'
}

export function ProviderDetail({
  provider,
  isActive,
  onRemoved
}: {
  provider: ProviderConfig
  isActive: boolean
  onRemoved: () => void
}): JSX.Element {
  const setProviderKey = useAi((s) => s.setProviderKey)
  const clearProviderKey = useAi((s) => s.clearProviderKey)
  const setActiveProvider = useAi((s) => s.setActiveProvider)
  const setProviderModel = useAi((s) => s.setProviderModel)
  const updateProvider = useAi((s) => s.updateProvider)
  const removeProvider = useAi((s) => s.removeProvider)
  const refreshModels = useAi((s) => s.refreshModels)

  const [reveal, setReveal] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [keyHint, setKeyHint] = useState<KeyHint>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [secretsOk, setSecretsOk] = useState<boolean | null>(null)

  // Probe OS-keychain availability so the UI is honest about how the key is stored.
  useEffect(() => {
    let cancelled = false
    window.api
      .secretsAvailable()
      .then((ok) => {
        if (!cancelled) setSecretsOk(ok)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const editingKey = draftKey.length > 0
  const showMasked = provider.hasKey && !editingKey
  const canConnectWithoutKey = keyOptional(provider.kind) && !provider.hasKey && !editingKey

  const handleSaveKey = async (): Promise<void> => {
    const key = draftKey.trim()
    if ((!key && !canConnectWithoutKey) || saving) return
    if (hasBaseUrl(provider.kind) && provider.kind !== 'openrouter' && !provider.baseUrl?.trim()) {
      setKeyHint({ kind: 'error', text: tr('Сначала укажите Base URL сервера.') })
      return
    }
    setSaving(true)
    setKeyHint(null)
    try {
      await setProviderKey(provider.id, key)
      setDraftKey('')
      setReveal(false)
      const found = await refreshModels(provider.id)
      setKeyHint(
        found > 0
          ? { kind: 'ok', text: trf('Подключено · доступно моделей: {n}', { n: found }) }
          : {
              kind: 'neutral',
              text: tr('Сохранено, но список моделей получить не удалось — проверьте ключ и адрес или впишите модель вручную.')
            }
      )
    } catch (err) {
      setKeyHint({ kind: 'error', text: trf('Не удалось сохранить ключ: {message}', { message: (err as Error).message }) })
    } finally {
      setSaving(false)
    }
  }

  const handleClearKey = async (): Promise<void> => {
    await clearProviderKey(provider.id)
    setDraftKey('')
    setReveal(false)
    setKeyHint(null)
  }

  const handleRemove = (): void => {
    removeProvider(provider.id)
    onRemoved()
  }

  const keyUrl = KEY_URLS[provider.kind]

  return (
    <div className="prov-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div
          className="prov-logo"
          style={{
            background: `oklch(0.6 0.17 ${provider.hue})`,
            width: 34,
            height: 34,
            borderRadius: 9,
            fontSize: 14
          }}
        >
          {provider.glyph}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="input"
            value={provider.label}
            aria-label={tr('Название провайдера')}
            onChange={(e) => updateProvider(provider.id, { label: e.target.value })}
            style={{ height: 30, fontWeight: 600, maxWidth: 280 }}
          />
          {provider.sub && <div className="prov-sub">{tr(provider.sub)}</div>}
        </div>
        {provider.hasKey && !isActive && (
          <button className="btn primary" onClick={() => setActiveProvider(provider.id)}> {tr('Сделать активным')} </button>
        )}
        {isActive && (
          <span className="prov-status ok">
            <span className="d" /> {tr('Активный провайдер')} </span>
        )}
      </div>

      {hasBaseUrl(provider.kind) && (
        <div className="field">
          <label>Base URL{provider.kind === 'openrouter' ? ` ${tr('(необязательно)')}` : ''}</label>
          <input
            className="input mono"
            value={provider.baseUrl ?? ''}
            placeholder={provider.kind === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://localhost:11434/v1'}
            onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
            aria-label="Base URL"
          />
        </div>
      )}

      <div className="field">
        <label>
          {tr('API-ключ')}
          {keyOptional(provider.kind) ? ` ${tr('(если сервер его требует)')}` : ''}
        </label>
        <div className="input-row">
          <div className="input-key">
            <input
              className="input mono"
              type={reveal ? 'text' : 'password'}
              value={draftKey}
              placeholder={showMasked ? (provider.keyless ? tr('подключено без ключа') : MASKED_PLACEHOLDER) : 'sk-…'}
              onChange={(e) => setDraftKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveKey()
              }}
              aria-label={tr('API-ключ')}
            />
            <IconButton
              icon="eye"
              className="reveal"
              size={15}
              active={reveal}
              title={reveal ? tr('Скрыть') : tr('Показать')}
              onClick={() => setReveal((r) => !r)}
            />
          </div>
          <button
            className="btn primary"
            disabled={(!editingKey && !canConnectWithoutKey) || saving}
            onClick={() => void handleSaveKey()}
          >
            {saving
              ? tr('Подключение…')
              : provider.hasKey
                ? tr('Обновить')
                : canConnectWithoutKey
                  ? tr('Подключить без ключа')
                  : tr('Подключить')}
          </button>
          {provider.hasKey && (
            <button className="btn" onClick={() => void handleClearKey()}> {tr('Отключить')} </button>
          )}
        </div>
        {keyHint && (
          <div
            className="hint"
            style={{
              color: keyHint.kind === 'ok' ? 'var(--m-get)' : keyHint.kind === 'error' ? 'var(--s-5xx)' : 'var(--tx-3)'
            }}
          >
            {keyHint.text}
          </div>
        )}
        <div className="hint">
          {secretsOk === false
            ? tr('⚠ OS-хранилище ключей недоступно — ключ сохраняется локально в открытом виде (base64). Настройте системный keychain, чтобы он шифровался.')
            : tr('Ключ хранится локально в зашифрованном виде (Electron safeStorage) и не покидает устройство, кроме запросов к провайдеру.')}
          {keyUrl && (
            <>
              {' '}
              <button className="link-btn" onClick={() => void window.api.openExternal(keyUrl)}> {tr('Где взять ключ?')} </button>
            </>
          )}
        </div>
      </div>

      <div className="field">
        <label>{tr('Модель по умолчанию')}</label>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <ModelPicker
            provider={provider}
            open={modelOpen}
            onOpenChange={setModelOpen}
            onPick={(m) => {
              setProviderModel(provider.id, m)
              setModelOpen(false)
            }}
          />
        </div>
        <div className="hint"> {tr('Список запрашивается у провайдера по вашему ключу — видны все доступные вам модели.')} </div>
      </div>

      <div className="field">
        <button className="btn" style={{ color: 'var(--s-5xx)' }} onClick={handleRemove}>
          <Icon name="trash" size={15} /> {tr('Удалить провайдера')} </button>
      </div>
    </div>
  )
}

/** Select-box with a searchable popover of the provider's live model list. */
function ModelPicker({
  provider,
  open,
  onOpenChange,
  onPick
}: {
  provider: ProviderConfig
  open: boolean
  onOpenChange: (o: boolean) => void
  onPick: (model: string) => void
}): JSX.Element {
  const refreshModels = useAi((s) => s.refreshModels)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const fetchedRef = useRef(false)
  const current = provider.defaultModel || tr('Выберите модель')

  const canFetch = !!provider.hasKey || provider.kind === 'openai-compatible' || provider.kind === 'openrouter'

  const refresh = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    setFailed(false)
    try {
      const n = await refreshModels(provider.id)
      setFailed(n === 0)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  // First open fetches the live list; afterwards it is refreshed on demand.
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    if (!fetchedRef.current && canFetch) {
      fetchedRef.current = true
      void refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onOpenChange])

  const q = query.trim()
  const visible = q ? provider.models.filter((m) => m.toLowerCase().includes(q.toLowerCase())) : provider.models
  const exact = provider.models.includes(q)

  return (
    <>
      <div
        ref={boxRef}
        className="select-box mono"
        onClick={() => onOpenChange(!open)}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenChange(!open)
          }
        }}
      >
        {current}
        <Icon name="chevDsm" size={14} style={{ marginLeft: 'auto', color: 'var(--tx-3)' }} />
      </div>
      {open && (
        <div ref={popRef} className="popover model-pop" style={{ top: 42, left: 0 }}>
          <div className="model-pop-head">
            <input
              className="input mono"
              autoFocus
              value={query}
              placeholder={tr('Поиск или название модели…')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q) {
                  e.preventDefault()
                  onPick(visible.length === 1 ? visible[0] : q)
                }
              }}
            />
            <button className="icon-btn" title={tr('Обновить список моделей')} disabled={loading} onClick={() => void refresh()}>
              <Icon name="refresh" size={14} className={loading ? 'spin' : undefined} />
            </button>
          </div>
          <div className="model-pop-list">
            {loading && provider.models.length === 0 && <div className="model-pop-note">{tr('Загрузка списка моделей…')}</div>}
            {!loading && failed && provider.models.length === 0 && (
              <div className="model-pop-note">
                {canFetch
                  ? tr('Провайдер не вернул список. Проверьте ключ и адрес или впишите модель вручную.')
                  : tr('Подключите ключ, чтобы загрузить список моделей.')}
              </div>
            )}
            {!loading && !failed && provider.models.length === 0 && !canFetch && (
              <div className="model-pop-note">{tr('Подключите ключ, чтобы загрузить список моделей.')}</div>
            )}
            {visible.map((m) => (
              <div key={m} className={`pop-item${m === provider.defaultModel ? ' on' : ''}`} onClick={() => onPick(m)}>
                <span className="mono" style={{ fontSize: 12 }}>
                  {m}
                </span>
                {m === provider.defaultModel && <Icon name="check" size={14} className="tick" />}
              </div>
            ))}
            {q && !exact && (
              <div className="pop-item" onClick={() => onPick(q)}>
                <Icon name="plus" size={14} />
                <span> {tr('Использовать')} <span className="mono">«{q}»</span>
                </span>
              </div>
            )}
          </div>
          {provider.models.length > 0 && <div className="model-pop-foot">{trf('Моделей: {n}', { n: provider.models.length })}</div>}
        </div>
      )}
    </>
  )
}

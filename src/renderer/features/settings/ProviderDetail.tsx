import { useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { IconButton } from '@renderer/components/primitives'
import { useAi } from '@renderer/store/ai'

const MASKED_PLACEHOLDER = '••••••••••••••••'

type KeyHint = { kind: 'ok' | 'neutral' | 'error'; text: string } | null

/** Whether this provider exposes an editable Base URL field. */
function hasBaseUrl(kind: ProviderConfig['kind']): boolean {
  return kind === 'openrouter' || kind === 'openai-compatible'
}

/** A provider is "custom" (user-added, editable label + removable) when it is openai-compatible. */
function isCustom(kind: ProviderConfig['kind']): boolean {
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

  // Reset transient field state when switching between providers.
  useEffect(() => {
    setReveal(false)
    setDraftKey('')
    setSaving(false)
    setKeyHint(null)
    setModelOpen(false)
  }, [provider.id])

  const editingKey = draftKey.length > 0
  const showMasked = provider.hasKey && !editingKey

  const handleSaveKey = async (): Promise<void> => {
    const key = draftKey.trim()
    if (!key || saving) return
    setSaving(true)
    setKeyHint(null)
    try {
      await setProviderKey(provider.id, key)
      setDraftKey('')
      setReveal(false)
      // Optional, non-blocking verification: fetch models and merge them in.
      try {
        const models = await window.api.aiListModels(provider.id)
        if (models.length > 0) {
          updateProvider(provider.id, { models: models.map((m) => m.id) })
          setKeyHint({ kind: 'ok', text: `Проверено · найдено моделей: ${models.length}` })
        } else {
          setKeyHint({ kind: 'neutral', text: 'Ключ сохранён. Список моделей получить не удалось.' })
        }
      } catch {
        setKeyHint({ kind: 'neutral', text: 'Ключ сохранён. Проверка моделей недоступна.' })
      }
    } catch (err) {
      setKeyHint({ kind: 'error', text: `Не удалось сохранить ключ: ${(err as Error).message}` })
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

  return (
    <div className="prov-detail">
      {/* header: logo + (editable) name + active controls */}
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
          {isCustom(provider.kind) ? (
            <input
              className="input"
              value={provider.label}
              aria-label="Название провайдера"
              onChange={(e) => updateProvider(provider.id, { label: e.target.value })}
              style={{ height: 30, fontWeight: 600, maxWidth: 280 }}
            />
          ) : (
            <div style={{ fontWeight: 600, fontSize: 14 }}>{provider.label}</div>
          )}
          {provider.sub && <div className="prov-sub">{provider.sub}</div>}
        </div>
        {provider.hasKey && !isActive && (
          <button className="btn primary" onClick={() => setActiveProvider(provider.id)}>
            Сделать активным
          </button>
        )}
        {isActive && (
          <span className="prov-status ok">
            <span className="d" />
            Активный провайдер
          </span>
        )}
      </div>

      {/* API key */}
      <div className="field">
        <label>API-ключ</label>
        <div className="input-row">
          <div className="input-key">
            <input
              className="input mono"
              type={reveal ? 'text' : 'password'}
              value={draftKey}
              placeholder={showMasked ? MASKED_PLACEHOLDER : 'sk-…'}
              onChange={(e) => setDraftKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveKey()
              }}
              aria-label="API-ключ"
            />
            <IconButton
              icon="eye"
              className="reveal"
              size={15}
              active={reveal}
              title={reveal ? 'Скрыть' : 'Показать'}
              onClick={() => setReveal((r) => !r)}
            />
          </div>
          <button className="btn primary" disabled={!editingKey || saving} onClick={() => void handleSaveKey()}>
            {saving ? 'Сохранение…' : provider.hasKey ? 'Обновить' : 'Подключить'}
          </button>
          {provider.hasKey && (
            <button className="btn" onClick={() => void handleClearKey()}>
              Удалить ключ
            </button>
          )}
        </div>
        {keyHint && (
          <div
            className="hint"
            style={{
              color:
                keyHint.kind === 'ok'
                  ? 'var(--m-get)'
                  : keyHint.kind === 'error'
                    ? 'var(--s-5xx)'
                    : 'var(--tx-3)'
            }}
          >
            {keyHint.text}
          </div>
        )}
        <div className="hint">
          {secretsOk === false
            ? '⚠ OS-хранилище ключей недоступно — ключ сохраняется локально в открытом виде (base64). Настройте системный keychain, чтобы он шифровался.'
            : 'Ключ хранится локально в зашифрованном виде (Electron safeStorage) и не покидает устройство, кроме запросов к провайдеру.'}
        </div>
      </div>

      {/* Default model */}
      <div className="field">
        <label>Модель по умолчанию</label>
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
      </div>

      {/* Base URL for openrouter / openai-compatible */}
      {hasBaseUrl(provider.kind) && (
        <div className="field">
          <label>Base URL{provider.kind === 'openrouter' ? ' (необязательно)' : ''}</label>
          <input
            className="input mono"
            value={provider.baseUrl ?? ''}
            placeholder={provider.kind === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://localhost:11434/v1'}
            onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
            aria-label="Base URL"
          />
        </div>
      )}

      {/* Delete custom provider */}
      {isCustom(provider.kind) && (
        <div className="field">
          <button className="btn" style={{ color: 'var(--s-5xx)' }} onClick={handleRemove}>
            <Icon name="trash" size={15} />
            Удалить провайдера
          </button>
        </div>
      )}
    </div>
  )
}

/** Select-box that opens a popover listing the provider's models. */
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
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const current = provider.defaultModel || 'Выберите модель'

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

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
        <div ref={popRef} className="popover" style={{ top: 42, left: 0, minWidth: 240, maxHeight: 320, overflowY: 'auto' }}>
          {provider.models.length === 0 && (
            <div className="pop-item" style={{ color: 'var(--tx-3)', cursor: 'default' }}>
              Нет доступных моделей
            </div>
          )}
          {provider.models.map((m) => (
            <div
              key={m}
              className={`pop-item${m === provider.defaultModel ? ' on' : ''}`}
              onClick={() => onPick(m)}
            >
              <span className="mono" style={{ fontSize: 12 }}>
                {m}
              </span>
              {m === provider.defaultModel && <Icon name="check" size={14} className="tick" />}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

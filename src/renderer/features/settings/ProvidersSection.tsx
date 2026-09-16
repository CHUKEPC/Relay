import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ProviderConfig } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useAi } from '@renderer/store/ai'
import { useUi } from '@renderer/store/ui'
import { PROVIDER_TEMPLATES, providerFromTemplate, type ProviderTemplateId } from '@renderer/lib/provider-templates'
import { ProviderDetail } from './ProviderDetail'

import { tr } from '@renderer/lib/i18n'
function ProviderCard({
  provider,
  active,
  selected,
  onClick
}: {
  provider: ProviderConfig
  active: boolean
  selected: boolean
  onClick: () => void
}): JSX.Element {
  const connected = !!provider.hasKey
  return (
    <div
      className={`prov-card${selected ? ' active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="prov-logo" style={{ background: `oklch(0.6 0.17 ${provider.hue})` }}>
        {provider.glyph}
      </div>
      <div className="prov-info">
        <div className="prov-name">
          {provider.label}
          {active && connected && <span className="badge-active">{tr('Активен')}</span>}
        </div>
        <div className="prov-sub">
          {provider.sub}
          {connected && provider.defaultModel ? ` · ${provider.defaultModel}` : ''}
        </div>
      </div>
      <span className={`prov-status ${connected ? 'ok' : 'no'}`}>
        <span className="d" />
        {connected ? 'Подключён' : 'Не подключён'}
      </span>
      <Icon name="chevR" size={16} style={{ color: 'var(--tx-3)' }} />
    </div>
  )
}

function AddProviderMenu({ onAdd, primary }: { onAdd: (id: ProviderTemplateId) => void; primary?: boolean }): JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={`btn${primary ? ' primary' : ''}`} style={{ marginTop: 12 }}>
          <Icon name="plus" size={15} /> {tr('Добавить провайдера')} <Icon name="chevDsm" size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="popover" align="start" sideOffset={6} style={{ position: 'relative', minWidth: 280 }}>
          {PROVIDER_TEMPLATES.map((t) => (
            <DropdownMenu.Item key={t.id} className="pop-item" onSelect={() => onAdd(t.id)}>
              <span style={{ fontWeight: 500 }}>{t.title}</span>
              <span style={{ marginLeft: 'auto', paddingLeft: 12, color: 'var(--tx-3)', fontSize: 11.5 }}>{t.hint}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ProvidersSection(): JSX.Element {
  const providers = useAi((s) => s.providers.providers)
  const activeProviderId = useAi((s) => s.providers.activeProviderId)
  const addProvider = useAi((s) => s.addProvider)

  const [selectedId, setSelectedId] = useState<string | null>(activeProviderId ?? providers[0]?.id ?? null)
  const [secretsOk, setSecretsOk] = useState<boolean | null>(null)

  // Probe encryption availability once.
  useEffect(() => {
    let cancelled = false
    window.api
      .secretsAvailable()
      .then((ok) => {
        if (!cancelled) setSecretsOk(ok)
      })
      .catch(() => {
        if (!cancelled) setSecretsOk(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep a valid selection if the list changes (e.g. after removing a provider).
  useEffect(() => {
    if (selectedId && providers.some((p) => p.id === selectedId)) return
    setSelectedId(activeProviderId ?? providers[0]?.id ?? null)
  }, [providers, activeProviderId, selectedId])

  const selected = providers.find((p) => p.id === selectedId) ?? null

  const handleAdd = (templateId: ProviderTemplateId): void => {
    const p = providerFromTemplate(templateId)
    addProvider(p)
    setSelectedId(p.id)
  }

  return (
    <>
      <div className="set-h">{tr('AI-провайдеры')}</div>
      <div className="set-sub"> {tr('Подключите один или несколько LLM-провайдеров. Ассистент работает через активного — переключайтесь в любой момент.')} </div>

      {secretsOk === false && (
        <div
          className="hint"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--s-4xx, var(--tx-2))',
            background: 'var(--bg-3)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '10px 12px',
            marginBottom: 18
          }}
        >
          <Icon name="warn" size={16} />
          <span> {tr('Шифрование недоступно в этой системе — ключи хранятся в обфусцированном виде, а не в зашифрованном.')} </span>
        </div>
      )}

      {providers.length === 0 ? (
        <div className="prov-empty">
          <div className="prov-empty-title">{tr('Провайдеры ещё не добавлены')}</div>
          <div className="prov-empty-sub">
            Выберите сервис: облачный (Anthropic, OpenAI, OpenRouter) — нужен API-ключ; локальный (Ollama, LM Studio) —
            работает без ключа. Подробнее — в разделе{' '}
            <button className="link-btn" onClick={() => useUi.getState().openHelp('ai')}> {tr('Справка → AI-ассистент')} </button>
            .
          </div>
          <AddProviderMenu onAdd={handleAdd} primary />
        </div>
      ) : (
        <>
          <div className="prov-grid">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                active={p.id === activeProviderId}
                selected={p.id === selectedId}
                onClick={() => setSelectedId(p.id)}
              />
            ))}
          </div>
          <AddProviderMenu onAdd={handleAdd} />
        </>
      )}

      {selected && (
        <ProviderDetail
          key={selected.id}
          provider={selected}
          isActive={selected.id === activeProviderId && !!selected.hasKey}
          onRemoved={() => setSelectedId(null)}
        />
      )}
    </>
  )
}

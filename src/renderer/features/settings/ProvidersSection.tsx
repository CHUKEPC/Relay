import { useEffect, useState } from 'react'
import type { ProviderConfig } from '@shared/types'
import { makeId } from '@shared/id'
import { Icon } from '@renderer/components/Icon'
import { useAi } from '@renderer/store/ai'
import { ProviderDetail } from './ProviderDetail'

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
          {active && <span className="badge-active">Активен</span>}
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

function makeCustomProvider(): ProviderConfig {
  return {
    id: makeId('provider'),
    kind: 'openai-compatible',
    label: 'Custom',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    models: [],
    hue: 200,
    glyph: 'C'
  }
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

  const handleAdd = (): void => {
    const p = makeCustomProvider()
    addProvider(p)
    setSelectedId(p.id)
  }

  return (
    <>
      <div className="set-h">AI-провайдеры</div>
      <div className="set-sub">
        Подключите один или несколько LLM-провайдеров. Ассистент работает через активного — переключайтесь в любой
        момент.
      </div>

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
          <span>
            Шифрование недоступно в этой системе — ключи хранятся в обфусцированном виде, а не в зашифрованном.
          </span>
        </div>
      )}

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

      <button className="btn" style={{ marginTop: 12 }} onClick={handleAdd}>
        <Icon name="plus" size={15} />
        Добавить провайдера
      </button>

      {selected && (
        <ProviderDetail
          key={selected.id}
          provider={selected}
          isActive={selected.id === activeProviderId}
          onRemoved={() => setSelectedId(null)}
        />
      )}
    </>
  )
}

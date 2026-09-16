import type { ProviderConfig } from '@shared/types'
import { makeId } from '@shared/id'

export type ProviderTemplateId = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'lmstudio' | 'custom'

export interface ProviderTemplate {
  id: ProviderTemplateId
  title: string
  hint: string
  /** where the user gets a key (shown in settings + help) */
  keyUrl?: string
  keyRequired: boolean
  build: () => Omit<ProviderConfig, 'id'>
}

/**
 * Starting points for "Add provider". `models` is only an offline fallback —
 * the real list is fetched from the provider as soon as it is reachable.
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'anthropic',
    title: 'Anthropic',
    hint: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyRequired: true,
    build: () => ({
      kind: 'anthropic',
      label: 'Anthropic',
      sub: 'Claude',
      defaultModel: 'claude-sonnet-5',
      models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
      hue: 18,
      glyph: 'A'
    })
  },
  {
    id: 'openai',
    title: 'OpenAI',
    hint: 'ChatGPT / GPT',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyRequired: true,
    build: () => ({
      kind: 'openai',
      label: 'OpenAI',
      sub: 'GPT',
      defaultModel: '',
      models: [],
      hue: 158,
      glyph: 'O'
    })
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    hint: 'сотни моделей через один ключ',
    keyUrl: 'https://openrouter.ai/keys',
    keyRequired: true,
    build: () => ({
      kind: 'openrouter',
      label: 'OpenRouter',
      sub: 'Много моделей',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'openrouter/auto',
      models: ['openrouter/auto'],
      hue: 264,
      glyph: 'R'
    })
  },
  {
    id: 'ollama',
    title: 'Ollama',
    hint: 'локальные модели',
    keyRequired: false,
    build: () => ({
      kind: 'openai-compatible',
      label: 'Ollama',
      sub: 'Локально',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: '',
      models: [],
      hue: 305,
      glyph: 'L'
    })
  },
  {
    id: 'lmstudio',
    title: 'LM Studio',
    hint: 'локальные модели',
    keyRequired: false,
    build: () => ({
      kind: 'openai-compatible',
      label: 'LM Studio',
      sub: 'Локально',
      baseUrl: 'http://localhost:1234/v1',
      defaultModel: '',
      models: [],
      hue: 330,
      glyph: 'S'
    })
  },
  {
    id: 'custom',
    title: 'Другой (OpenAI-совместимый)',
    hint: 'любой сервер с /v1/chat/completions',
    keyRequired: false,
    build: () => ({
      kind: 'openai-compatible',
      label: 'Custom',
      sub: 'OpenAI-совместимый',
      baseUrl: '',
      defaultModel: '',
      models: [],
      hue: 200,
      glyph: 'C'
    })
  }
]

export function providerFromTemplate(id: ProviderTemplateId): ProviderConfig {
  const tpl = PROVIDER_TEMPLATES.find((t) => t.id === id) ?? PROVIDER_TEMPLATES[PROVIDER_TEMPLATES.length - 1]
  return { id: makeId('provider'), ...tpl.build() }
}

/** Ids of the presets older versions seeded on first run. */
export const LEGACY_PRESET_IDS = new Set(['anthropic', 'openai', 'openrouter', 'local'])

import { STORAGE_VERSION } from '@shared/constants'
import type {
  CollectionsDoc,
  CookiesDoc,
  EnvironmentsDoc,
  GlobalsDoc,
  HistoryDoc,
  ProvidersDoc,
  SettingsDoc,
  TabsDoc
} from '@shared/types'

/**
 * First-run seed data. The app starts CLEAN — no demo collections, environments,
 * variables, history or tabs (the renderer opens a single blank tab on boot).
 * Only app-level config is seeded: the AI provider presets (without keys) and the
 * default settings.
 */

export function defaultCollections(): CollectionsDoc {
  return { version: STORAGE_VERSION, collections: [] }
}

export function defaultEnvironments(): EnvironmentsDoc {
  return { version: STORAGE_VERSION, activeEnvironmentId: null, environments: [] }
}

export function defaultGlobals(): GlobalsDoc {
  return { version: STORAGE_VERSION, variables: [] }
}

export function defaultHistory(): HistoryDoc {
  return { version: STORAGE_VERSION, entries: [] }
}

export function defaultTabs(): TabsDoc {
  // No seeded tabs — bootstrap() opens one blank "Untitled" tab when empty.
  return { version: STORAGE_VERSION, activeTabId: null, tabs: [] }
}

export function defaultProviders(): ProvidersDoc {
  return {
    version: STORAGE_VERSION,
    activeProviderId: 'anthropic',
    providers: [
      {
        id: 'anthropic',
        kind: 'anthropic',
        label: 'Anthropic',
        sub: 'Claude',
        defaultModel: 'claude-sonnet-4-6',
        models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
        hue: 18,
        glyph: 'A'
      },
      {
        id: 'openai',
        kind: 'openai',
        label: 'OpenAI',
        sub: 'ChatGPT',
        defaultModel: 'gpt-4o',
        models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
        hue: 158,
        glyph: 'O'
      },
      {
        id: 'openrouter',
        kind: 'openrouter',
        label: 'OpenRouter',
        sub: '300+ models',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'openrouter/auto',
        models: ['openrouter/auto', 'anthropic/claude-sonnet-4-6', 'openai/gpt-4o'],
        hue: 264,
        glyph: 'R'
      },
      {
        id: 'local',
        kind: 'openai-compatible',
        label: 'Local',
        sub: 'Ollama / LM Studio',
        baseUrl: 'http://localhost:11434/v1',
        defaultModel: 'llama3.1',
        models: ['llama3.1', 'qwen2.5', 'mistral'],
        hue: 305,
        glyph: 'L'
      }
    ]
  }
}

export function defaultSettings(): SettingsDoc {
  return {
    version: STORAGE_VERSION,
    theme: 'system',
    accentHue: 264,
    requestTimeoutMs: 30000,
    followRedirects: true,
    maxRedirects: 10,
    rejectUnauthorized: true,
    maxHistory: 200,
    wordWrapResponse: false,
    sendAiContext: true,
    autoApplyAiTools: false,
    defaultProviderId: 'anthropic',
    proxy: { enabled: false, url: '', bypass: [] },
    clientCerts: [],
    http2: false
  }
}

export function defaultCookies(): CookiesDoc {
  return { version: STORAGE_VERSION, cookies: [] }
}

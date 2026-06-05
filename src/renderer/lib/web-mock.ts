/**
 * DEV-only fallback: when the app runs in a plain browser (no Electron preload),
 * install a mock `window.api` so the renderer is previewable/screenshottable and
 * usable for pure-UI development. In the real Electron app `window.api` exists
 * and this code is a no-op.
 */
import type { RelayApi } from '@shared/ipc-contract'
import type { AiStreamEvent, ResponseResult } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'

if (!window.api) {
  const mem: Record<string, unknown> = {
    collections: {
      version: STORAGE_VERSION,
      collections: [
        {
          id: 'col_demo',
          type: 'collection',
          name: 'Acme Commerce API',
          auth: { type: 'bearer', token: '{{token}}' },
          variables: [{ key: 'api_version', value: 'v1', enabled: true }],
          children: [
            {
              id: 'fld_p',
              type: 'folder',
              name: 'Products',
              children: [
                {
                  id: 'r1',
                  type: 'request',
                  request: {
                    id: 'r1',
                    name: 'List products',
                    method: 'GET',
                    url: '{{base_url}}/{{api_version}}/products',
                    query: [{ key: 'limit', value: '20', enabled: true, description: 'Items per page' }],
                    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
                    pathVariables: [],
                    body: { type: 'none' },
                    auth: { type: 'inherit' }
                  }
                },
                {
                  id: 'r2',
                  type: 'request',
                  request: {
                    id: 'r2',
                    name: 'Create product',
                    method: 'POST',
                    url: '{{base_url}}/{{api_version}}/products',
                    query: [],
                    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
                    pathVariables: [],
                    body: { type: 'raw', language: 'json', text: '{\n  "name": "Studio Monitor",\n  "price": 299\n}' },
                    auth: { type: 'inherit' }
                  }
                }
              ]
            }
          ]
        }
      ]
    },
    environments: {
      version: STORAGE_VERSION,
      activeEnvironmentId: 'env_prod',
      environments: [
        { id: 'env_prod', name: 'Production', variables: [{ key: 'base_url', value: 'https://api.acme.com', enabled: true }, { key: 'token', value: 'secret-token', enabled: true, secret: true }] },
        { id: 'env_local', name: 'Local', variables: [{ key: 'base_url', value: 'http://localhost:8080', enabled: true }] }
      ]
    },
    globals: { version: STORAGE_VERSION, variables: [] },
    history: { version: STORAGE_VERSION, entries: [] },
    tabs: { version: STORAGE_VERSION, tabs: [], activeTabId: null },
    settings: {
      version: STORAGE_VERSION,
      theme: 'dark',
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
      clientCerts: []
    },
    providers: {
      version: STORAGE_VERSION,
      activeProviderId: 'anthropic',
      providers: [
        { id: 'anthropic', kind: 'anthropic', label: 'Anthropic', sub: 'Claude', defaultModel: 'claude-sonnet-4-6', models: ['claude-opus-4-6', 'claude-sonnet-4-6'], hue: 18, glyph: 'A', hasKey: true, apiKeyRef: 'provider:anthropic' },
        { id: 'openai', kind: 'openai', label: 'OpenAI', sub: 'ChatGPT', defaultModel: 'gpt-4o', models: ['gpt-4o', 'gpt-4o-mini'], hue: 158, glyph: 'O' }
      ]
    },
    cookies: { version: STORAGE_VERSION, cookies: [] }
  }

  const listeners = new Map<string, (e: AiStreamEvent) => void>()
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const fakeResponse = (): ResponseResult => {
    const text = JSON.stringify({ object: 'list', total: 248, has_more: true, data: [{ id: 'prod_8842', name: 'Studio Monitor Headphones', price: 299 }] }, null, 0)
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json; charset=utf-8'], ['x-ratelimit-remaining', '4998']],
      cookies: [],
      body: { text, contentType: 'application/json', isBinary: false, sizeBytes: text.length },
      timings: { startedAt: Date.now(), totalMs: 142 },
      redirects: [],
      finalUrl: 'https://api.acme.com/v1/products'
    }
  }

  const api: RelayApi = {
    platform: 'web',
    sendRequest: async () => {
      await delay(500)
      return fakeResponse()
    },
    cancelRequest: async () => {},
    aiChat: async (payload) => {
      const cb = listeners.get(payload.streamId)
      if (!cb) return
      const reply = 'Это **демо-ответ** ассистента (браузерный режим без Electron).\n\nОтвет — постраничный список товаров: `total: 248`, `has_more: true`.\n\n```bash\ncurl -X GET "https://api.acme.com/v1/products?limit=20" \\\n  -H "Authorization: Bearer $TOKEN"\n```'
      for (const word of reply.split(/(\s+)/)) {
        cb({ type: 'text', text: word })
        await delay(18)
      }
      cb({ type: 'done' })
    },
    aiCancel: async () => {},
    aiListModels: async () => [],
    onAiStream: (streamId, cb) => {
      listeners.set(streamId, cb)
      return () => listeners.delete(streamId)
    },
    secretsSet: async (ref) => ({ ref }),
    secretsHas: async () => true,
    secretsDelete: async () => {},
    secretsAvailable: async () => true,
    storageLoad: async (key) => (mem[key] ?? null) as never,
    storageSave: async (key, value) => {
      mem[key] = value
    },
    importData: async () => [],
    exportCollection: async () => '{}',
    runScript: async () => ({ logs: [], tests: [], environmentUpdates: {}, globalUpdates: {} }),
    oauthToken: async () => ({ ok: false, error: 'mock' }),
    cookiesGet: async () => [],
    cookiesSet: async () => {},
    cookiesDelete: async () => {},
    cookiesClear: async () => {},
    wsConnect: async () => {},
    wsSend: async () => {},
    wsClose: async () => {},
    sseConnect: async () => {},
    sseClose: async () => {},
    onRealtime: () => () => {},
    workspaceList: async () => ({ workspaces: [{ id: 'default', name: 'Default' }], activeId: 'default' }),
    workspaceCreate: async (name) => ({ id: `ws_${Date.now()}`, name }),
    workspaceRename: async () => {},
    workspaceDelete: async () => {},
    workspaceSwitch: async () => {},
    openFile: async () => null,
    saveFile: async () => null,
    readTextFile: async () => '',
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    openExternal: async () => {},
    onNativeThemeChange: () => () => {}
  }

  ;(window as unknown as { api: RelayApi }).api = api

  console.info('[relay] running in browser preview mode with a mock window.api')
}

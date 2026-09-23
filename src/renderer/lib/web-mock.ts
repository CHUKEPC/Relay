/**
 * DEV-only fallback: when the app runs in a plain browser (no Electron preload),
 * install a mock `window.api` so the renderer is previewable/screenshottable and
 * usable for pure-UI development. In the real Electron app `window.api` exists
 * and this code is a no-op.
 */
import type { RelayApi } from '@shared/ipc-contract'
import type { AiStreamEvent, ResponseResult } from '@shared/types'
import { CAPABILITIES, type FeaturePluginInfo } from '@shared/features'
import { APP_VERSION, STORAGE_VERSION } from '@shared/constants'
import { tr } from './i18n'

/** One synthetic pack holding every capability — preview shows the full UI. */
const MOCK_FEATURES: FeaturePluginInfo[] = [
  {
    id: 'preview-all',
    name: 'Все возможности (превью)',
    description: 'Заглушка веб-превью: включены все возможности.',
    version: APP_VERSION,
    capabilities: [...CAPABILITIES],
    locales: ['de', 'fr', 'es', 'zh'],
    enabled: true,
    dir: ''
  }
]

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
      defaultProviderId: null,
      proxy: { mode: 'off', enabled: false, url: '', bypass: [] },
      clientCerts: [],
      http2: false
    },
    providers: { version: STORAGE_VERSION, activeProviderId: null, providers: [] },
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
    aiListModels: async () => {
      await delay(300)
      return [{ id: 'mock-model-large' }, { id: 'mock-model-small' }]
    },
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
    socketioConnect: async () => {},
    socketioEmit: async () => {},
    socketioClose: async () => {},
    mqttConnect: async () => {},
    mqttPublish: async () => {},
    mqttSubscribe: async () => {},
    mqttClose: async () => {},
    onRealtime: () => () => {},
    onStorageChanged: () => () => {},
    // Separate OS windows exist only in the desktop app; the browser preview can't open them.
    paneDetach: async () => {},
    paneAttach: async () => {},
    paneFocus: async () => {},
    paneList: async () => [],
    panePutSnapshot: () => {},
    paneTakeSnapshot: async () => null,
    onPaneClosed: () => () => {},
    windowNudge: async () => {},
    grpcParse: async () => ({ services: [], error: tr('gRPC недоступен в web-режиме') }),
    grpcInvoke: async () => {},
    grpcSend: async () => {},
    grpcEnd: async () => {},
    grpcCancel: async () => {},
    grpcReflect: async () => ({ services: [], error: tr('gRPC недоступен в web-режиме') }),
    onGrpc: () => () => {},
    oauthDevice: async () => ({ ok: false, error: tr('Недоступно в web-режиме') }),
    oauthAuthorize: async () => ({ ok: false, error: tr('Недоступно в web-режиме') }),
    graphqlIntrospect: async () => ({ ok: false, error: tr('Недоступно в web-режиме') }),
    sqliteExport: async () => '',
    sqliteImport: async () => ({
      snapshot: { collections: [], environments: [], activeEnvironmentId: null, globals: [], history: [] },
      summary: { collections: 0, requests: 0, environments: 0, globals: 0, history: 0 }
    }),
    // Browser preview: pretend every bundled feature pack is present and on, so
    // the whole UI is reachable without the main process.
    readBinaryFile: async () => '',
    featuresList: async () => MOCK_FEATURES,
    featuresSetEnabled: async () => MOCK_FEATURES,
    featuresLocale: async () => null,
    featuresSnippets: async () => [],
    terminalTools: async () => ({ os: 'win32' as const, tools: [] }),
    terminalRun: async () => ({ ok: false as const, error: 'not available in the browser preview' }),
    terminalPreview: async () => '',
    featuresThemes: async () => [],
    featuresOpenFolder: async () => false,
    featuresInstall: async () => null,
    featuresRemove: async () => MOCK_FEATURES,
    onFeaturesChanged: () => () => {},

    pluginsList: async () => [],
    pluginsSetEnabled: async () => [],
    pluginsSetConfig: async () => {},
    pluginsSetSecret: async () => [],
    pluginsSetNetAllowlist: async () => [],
    pluginsInvokeButton: async () => ({ logs: [], error: tr('Плагины недоступны в web-режиме') }),
    pluginsInvokePanel: async () => ({ logs: [], error: tr('Плагины недоступны в web-режиме') }),
    pluginsPanelMessage: async () => ({ logs: [], error: tr('Плагины недоступны в web-режиме') }),
    pluginsInvokeCommand: async () => ({ logs: [], error: tr('Плагины недоступны в web-режиме') }),
    pluginsOpenFolder: async () => {},
    pluginsInstallSample: async () => ({ plugins: [], existed: false }),
    pluginsInstallZip: async () => null,
    pluginsDelete: async () => [],
    onPluginsEvent: () => () => {},
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
    getAppVersion: async () => APP_VERSION,
    checkUpdates: async () => ({ ok: false, error: 'web-mode' }),
    openExternal: async () => {},
    onNativeThemeChange: () => () => {},
    onWindowMaximized: () => () => {}
  }

  ;(window as unknown as { api: RelayApi }).api = api

  console.info('[relay] running in browser preview mode with a mock window.api')
}

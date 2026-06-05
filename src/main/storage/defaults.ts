import { STORAGE_VERSION } from '@shared/constants'
import type {
  CollectionsDoc,
  CollectionFolderNode,
  EnvironmentsDoc,
  GlobalsDoc,
  HistoryDoc,
  ProvidersDoc,
  RequestModel,
  SettingsDoc,
  TabsDoc,
  CookiesDoc
} from '@shared/types'

/**
 * First-run seed data. Mirrors the design mockup ("Acme Commerce API") so the
 * app opens populated and immediately demoable. Users can delete/replace it.
 */

function req(
  id: string,
  name: string,
  method: RequestModel['method'],
  path: string,
  extra: Partial<RequestModel> = {}
): { id: string; type: 'request'; request: RequestModel } {
  return {
    id,
    type: 'request',
    request: {
      id,
      name,
      method,
      url: `{{base_url}}/{{api_version}}${path}`,
      query: [],
      headers: [
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'Authorization', value: 'Bearer {{token}}', enabled: true }
      ],
      pathVariables: [],
      body: { type: 'none' },
      auth: { type: 'inherit' },
      ...extra
    }
  }
}

const productJson = `{
  "name": "Studio Monitor Headphones",
  "category": "audio",
  "price": 299.00,
  "currency": "USD",
  "in_stock": true,
  "tags": ["wired", "over-ear", "pro"]
}`

export function defaultCollections(): CollectionsDoc {
  const acme: CollectionFolderNode = {
    id: 'col_acme',
    type: 'collection',
    name: 'Acme Commerce API',
    auth: { type: 'bearer', token: '{{token}}' },
    variables: [{ key: 'api_version', value: 'v1', enabled: true }],
    children: [
      {
        id: 'fld_auth',
        type: 'folder',
        name: 'Authentication',
        children: [
          req('req_login', 'Login', 'POST', '/auth/login', {
            auth: { type: 'none' },
            body: {
              type: 'raw',
              language: 'json',
              text: '{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}'
            }
          }),
          req('req_refresh', 'Refresh token', 'POST', '/auth/refresh'),
          req('req_logout', 'Logout', 'POST', '/auth/logout')
        ]
      },
      {
        id: 'fld_products',
        type: 'folder',
        name: 'Products',
        children: [
          req('req_list_products', 'List products', 'GET', '/products', {
            query: [
              { key: 'limit', value: '20', enabled: true, description: 'Items per page' },
              { key: 'category', value: 'audio', enabled: true, description: 'Filter by category' },
              { key: 'sort', value: '-created_at', enabled: false, description: 'Sort order' }
            ],
            headers: [
              { key: 'Accept', value: 'application/json', enabled: true },
              { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
              { key: 'X-Client', value: 'relay/1.0', enabled: true }
            ]
          }),
          req('req_get_product', 'Get product', 'GET', '/products/:id', {
            pathVariables: [{ key: 'id', value: 'prod_8842', enabled: true }]
          }),
          req('req_create_product', 'Create product', 'POST', '/products', {
            body: { type: 'raw', language: 'json', text: productJson }
          }),
          req('req_update_product', 'Update product', 'PATCH', '/products/:id', {
            pathVariables: [{ key: 'id', value: 'prod_8842', enabled: true }],
            body: { type: 'raw', language: 'json', text: '{\n  "price": 279.00\n}' }
          }),
          req('req_delete_product', 'Delete product', 'DELETE', '/products/:id', {
            pathVariables: [{ key: 'id', value: 'prod_8819', enabled: true }]
          })
        ]
      },
      {
        id: 'fld_orders',
        type: 'folder',
        name: 'Orders',
        children: [
          req('req_list_orders', 'List orders', 'GET', '/orders', {
            query: [{ key: 'status', value: 'open', enabled: true }]
          }),
          req('req_create_order', 'Create order', 'POST', '/orders', {
            body: {
              type: 'raw',
              language: 'json',
              text: '{\n  "product_id": "prod_8842",\n  "quantity": 1,\n  "amount": 299.00\n}'
            }
          }),
          req('req_cancel_order', 'Cancel order', 'PUT', '/orders/:id/cancel', {
            pathVariables: [{ key: 'id', value: 'ord_1021', enabled: true }]
          })
        ]
      }
    ]
  }

  const webhooks: CollectionFolderNode = {
    id: 'col_webhooks',
    type: 'collection',
    name: 'Internal Webhooks',
    children: [
      req('req_register_hook', 'Register hook', 'POST', '/hooks'),
      {
        id: 'req_health',
        type: 'request',
        request: {
          id: 'req_health',
          name: 'Health check',
          method: 'GET',
          url: 'https://httpbin.org/get',
          query: [],
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          pathVariables: [],
          body: { type: 'none' },
          auth: { type: 'none' }
        }
      }
    ]
  }

  return { version: STORAGE_VERSION, collections: [acme, webhooks] }
}

export function defaultEnvironments(): EnvironmentsDoc {
  return {
    version: STORAGE_VERSION,
    activeEnvironmentId: 'env_prod',
    environments: [
      {
        id: 'env_prod',
        name: 'Production',
        variables: [
          { key: 'base_url', value: 'https://api.acme.com', enabled: true },
          { key: 'api_version', value: 'v1', enabled: true },
          { key: 'token', value: 'eyJhbGciOi-demo-token', enabled: true, secret: true },
          { key: 'email', value: 'demo@acme.com', enabled: true },
          { key: 'password', value: 'hunter2', enabled: true, secret: true }
        ]
      },
      {
        id: 'env_staging',
        name: 'Staging',
        variables: [
          { key: 'base_url', value: 'https://staging.acme.com', enabled: true },
          { key: 'api_version', value: 'v1', enabled: true }
        ]
      },
      {
        id: 'env_local',
        name: 'Local',
        variables: [{ key: 'base_url', value: 'http://localhost:8080', enabled: true }]
      }
    ]
  }
}

export function defaultGlobals(): GlobalsDoc {
  return { version: STORAGE_VERSION, variables: [] }
}

export function defaultHistory(): HistoryDoc {
  return { version: STORAGE_VERSION, entries: [] }
}

export function defaultTabs(): TabsDoc {
  const seed = defaultCollections()
  const products = seed.collections[0]?.children.find((c) => c.id === 'fld_products') as CollectionFolderNode | undefined
  const listProducts = products?.children.find((c) => c.id === 'req_list_products')
  const request = listProducts && listProducts.type === 'request' ? listProducts.request : undefined
  // If the seed structure ever changes, fall back to an empty tab set rather than
  // crashing app boot (bootstrap opens a fresh tab when there are none).
  if (!request) {
    return { version: STORAGE_VERSION, activeTabId: null, tabs: [] }
  }
  return {
    version: STORAGE_VERSION,
    activeTabId: 'tab_seed',
    tabs: [{ id: 'tab_seed', request: { ...request }, savedRequestId: request.id, dirty: false }]
  }
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
    clientCerts: []
  }
}

export function defaultCookies(): CookiesDoc {
  return { version: STORAGE_VERSION, cookies: [] }
}

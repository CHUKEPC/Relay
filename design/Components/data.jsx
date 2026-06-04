/* Mock data + helpers for Relay */
(function () {
  // ---------- Collections tree ----------
  window.COLLECTIONS = [
    {
      id: 'c1', name: 'Acme Commerce API', type: 'folder', open: true, children: [
        { id: 'f1', name: 'Authentication', type: 'folder', open: true, children: [
          { id: 'r1', name: 'Login', method: 'POST', type: 'req' },
          { id: 'r2', name: 'Refresh token', method: 'POST', type: 'req' },
          { id: 'r3', name: 'Logout', method: 'POST', type: 'req' },
        ]},
        { id: 'f2', name: 'Products', type: 'folder', open: true, children: [
          { id: 'r4', name: 'List products', method: 'GET', type: 'req', active: true },
          { id: 'r5', name: 'Get product', method: 'GET', type: 'req' },
          { id: 'r6', name: 'Create product', method: 'POST', type: 'req' },
          { id: 'r7', name: 'Update product', method: 'PATCH', type: 'req' },
          { id: 'r8', name: 'Delete product', method: 'DELETE', type: 'req' },
        ]},
        { id: 'f3', name: 'Orders', type: 'folder', open: false, children: [
          { id: 'r9', name: 'List orders', method: 'GET', type: 'req' },
          { id: 'r10', name: 'Create order', method: 'POST', type: 'req' },
          { id: 'r11', name: 'Cancel order', method: 'PUT', type: 'req' },
        ]},
      ]
    },
    {
      id: 'c2', name: 'Internal Webhooks', type: 'folder', open: false, children: [
        { id: 'r12', name: 'Register hook', method: 'POST', type: 'req' },
        { id: 'r13', name: 'Health check', method: 'GET', type: 'req' },
      ]
    },
  ];

  window.HISTORY = [
    { id: 'h1', method: 'GET', name: '/v1/products?limit=20', time: '2 мин назад', status: 200 },
    { id: 'h2', method: 'POST', name: '/v1/auth/login', time: '14 мин назад', status: 200 },
    { id: 'h3', method: 'GET', name: '/v1/products/8842', time: '32 мин назад', status: 200 },
    { id: 'h4', method: 'DELETE', name: '/v1/products/8819', time: '1 ч назад', status: 204 },
    { id: 'h5', method: 'PATCH', name: '/v1/products/8842', time: '1 ч назад', status: 422 },
    { id: 'h6', method: 'GET', name: '/v1/orders?status=open', time: '3 ч назад', status: 500 },
    { id: 'h7', method: 'POST', name: '/v1/auth/refresh', time: 'вчера', status: 401 },
  ];

  window.ENVIRONMENTS = [
    { id: 'e0', name: 'No Environment' },
    { id: 'e1', name: 'Production', active: true, vars: [
      { k: 'base_url', v: 'https://api.acme.com', enabled: true },
      { k: 'api_version', v: 'v1', enabled: true },
      { k: 'token', v: 'eyJhbG•••••••••', enabled: true, secret: true },
    ]},
    { id: 'e2', name: 'Staging', vars: [
      { k: 'base_url', v: 'https://staging.acme.com', enabled: true },
      { k: 'api_version', v: 'v1', enabled: true },
    ]},
    { id: 'e3', name: 'Local', vars: [
      { k: 'base_url', v: 'http://localhost:8080', enabled: true },
    ]},
  ];

  // ---------- The open request ----------
  window.OPEN_REQUEST = {
    method: 'GET',
    url: '{{base_url}}/{{api_version}}/products',
    params: [
      { k: 'limit', v: '20', enabled: true, desc: 'Items per page' },
      { k: 'category', v: 'audio', enabled: true, desc: 'Filter by category' },
      { k: 'sort', v: '-created_at', enabled: false, desc: 'Sort order' },
    ],
    headers: [
      { k: 'Authorization', v: 'Bearer {{token}}', enabled: true },
      { k: 'Accept', v: 'application/json', enabled: true },
      { k: 'X-Client', v: 'relay/1.0', enabled: true },
    ],
  };

  // ---------- Sample response ----------
  window.RESPONSE_JSON = {
    object: "list",
    has_more: true,
    total: 248,
    data: [
      {
        id: "prod_8842",
        name: "Studio Monitor Headphones",
        category: "audio",
        price: 299.0,
        currency: "USD",
        in_stock: true,
        tags: ["wired", "over-ear", "pro"],
        created_at: "2026-05-21T09:14:03Z"
      },
      {
        id: "prod_8843",
        name: "Field Recorder X2",
        category: "audio",
        price: 549.5,
        currency: "USD",
        in_stock: false,
        tags: ["portable", "48khz"],
        created_at: "2026-05-19T16:40:22Z"
      }
    ],
    next_cursor: "cD0yMDI2LTA1LTE5"
  };

  window.RESPONSE_HEADERS = [
    ['content-type', 'application/json; charset=utf-8'],
    ['content-length', '1284'],
    ['x-request-id', 'req_3kf9Xa72bQ'],
    ['x-ratelimit-remaining', '4998'],
    ['x-ratelimit-limit', '5000'],
    ['cache-control', 'no-store'],
    ['date', 'Thu, 04 Jun 2026 11:42:09 GMT'],
    ['server', 'acme-edge/2.3'],
  ];
  window.RESPONSE_COOKIES = [
    ['session', 'a3f9...e21', 'api.acme.com', '/', 'Strict', '2026-06-11'],
    ['__cf_bm', 'k29x...8fa', '.acme.com', '/', 'Lax', 'Session'],
  ];

  // ---------- AI providers ----------
  window.PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic', sub: 'Claude', connected: true, active: true,
      models: ['claude-opus-4.6', 'claude-sonnet-4.6', 'claude-haiku-4.5'], model: 'claude-sonnet-4.6',
      hue: 18, glyph: 'A' },
    { id: 'openai', name: 'OpenAI', sub: 'ChatGPT', connected: true, active: false,
      models: ['gpt-5.2', 'gpt-5.2-mini', 'o4'], model: 'gpt-5.2', hue: 158, glyph: 'O' },
    { id: 'openrouter', name: 'OpenRouter', sub: '300+ моделей', connected: false, active: false,
      models: ['auto', 'llama-4-405b', 'mixtral-next'], model: 'auto', hue: 264, glyph: 'R' },
    { id: 'google', name: 'Google', sub: 'Gemini', connected: false, active: false,
      models: ['gemini-3-pro', 'gemini-3-flash'], model: 'gemini-3-pro', hue: 240, glyph: 'G' },
    { id: 'mistral', name: 'Mistral', sub: 'Le Plateforme', connected: false, active: false,
      models: ['mistral-large-3', 'codestral-2'], model: 'mistral-large-3', hue: 55, glyph: 'M' },
    { id: 'local', name: 'Локальный', sub: 'Ollama / LM Studio', connected: false, active: false,
      models: ['llama4:70b', 'qwen3:32b'], model: 'llama4:70b', hue: 305, glyph: 'L' },
  ];

  // ---------- JSON syntax highlighter (returns array of React nodes) ----------
  // Renders a collapsible-aware token stream. We pre-format with 2-space indent.
  window.formatJSON = function (obj) { return JSON.stringify(obj, null, 2); };

  window.Hl = function ({ text }) {
    // tokenizes a JSON string into colored spans
    const tokens = [];
    const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|([{}\[\],])|(\s+)|(.)/g;
    let m, i = 0;
    while ((m = re.exec(text)) !== null) {
      let cls = null, val = m[0];
      if (m[1]) cls = 'c-key';
      else if (m[2]) cls = 'c-str';
      else if (m[3]) cls = 'c-bool';
      else if (m[4]) cls = 'c-null';
      else if (m[5]) cls = 'c-num';
      else if (m[6]) cls = 'c-punct';
      tokens.push(cls
        ? React.createElement('span', { key: i++, className: cls }, val)
        : val);
    }
    return tokens;
  };
})();

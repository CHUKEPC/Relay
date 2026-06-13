/**
 * The bundled sample plugin, written into the plugins folder by «Установить
 * пример» in Settings → Плагины. Embedded as source strings (not packaged
 * files) so it works identically in dev and packaged builds.
 *
 * It exercises EVERY v1 + P1 extension point: a response-toolbar button, a
 * declarative theme, a `response` lifecycle hook, a `request` (pre-send) hook,
 * a panel rendered in a sandboxed iframe, plugin-scoped storage, a safeStorage
 * secret config field, and capability-gated `relay.fetch`.
 */

export const SAMPLE_PLUGIN_ID = 'webhook-forwarder'

const manifest = {
  id: SAMPLE_PLUGIN_ID,
  name: 'Webhook Forwarder',
  version: '1.2.0',
  apiVersion: 1,
  description:
    'Forwards responses to a webhook (button/auto), tags requests, copies a summary to the clipboard, and shows an interactive stats panel.',
  author: 'Relay',
  main: 'main.js',
  permissions: ['net', 'request:read', 'response:read', 'request:write', 'storage', 'clipboard', 'history:read'],
  contributes: {
    buttons: [
      {
        id: 'post-webhook',
        label: 'В webhook',
        icon: 'upload',
        location: 'response-toolbar',
        tooltip: 'Отправить этот ответ в настроенный webhook'
      }
    ],
    commands: [{ id: 'copy-summary', title: 'Webhook: скопировать сводку ответа', icon: 'copy' }],
    panels: [{ id: 'stats', label: 'Webhook', icon: 'send', location: 'response-tab', interactive: true }],
    themes: [
      {
        id: 'forge-green',
        label: 'Forge Green',
        base: 'dark',
        vars: {
          '--accent': '#22c55e',
          '--accent-hover': '#34d877',
          '--accent-press': '#1ca34f',
          '--accent-soft': 'rgba(34, 197, 94, 0.12)',
          '--accent-soft-2': 'rgba(34, 197, 94, 0.18)'
        }
      }
    ],
    events: ['response', 'request']
  },
  config: [
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'string',
      placeholder: 'https://hooks.example.com/…',
      description: 'Куда отправлять JSON с ответом'
    },
    {
      key: 'authToken',
      label: 'Bearer-токен',
      type: 'secret',
      description: 'Необязательно. Хранится в безопасном хранилище ОС, добавляется как Authorization: Bearer …'
    },
    {
      key: 'autoForward',
      label: 'Auto-forward ("on" / "off")',
      type: 'string',
      placeholder: 'off',
      description: 'on — пересылать каждый завершённый ответ автоматически'
    },
    {
      key: 'tagRequests',
      label: 'Tag requests ("on" / "off")',
      type: 'string',
      placeholder: 'off',
      description: 'on — добавлять заголовок X-Relay-Plugin к исходящим запросам'
    }
  ]
}

const mainJs = `// Webhook Forwarder — Relay sample plugin (see docs/PLUGINS.md).
// Runs in the plugin sandbox: only the frozen \`relay\` API and \`console\` exist here.

async function forward(ctx, auto) {
  const url = relay.config.webhookUrl
  if (!url) {
    if (!auto) relay.toast('Укажите Webhook URL в настройках плагина', 'error')
    return
  }
  if (!ctx.response) {
    if (!auto) relay.toast('Сначала отправьте запрос', 'error')
    return
  }

  const headers = { 'Content-Type': 'application/json' }
  if (relay.config.authToken) headers.Authorization = 'Bearer ' + relay.config.authToken

  const payload = {
    source: 'relay',
    forwardedAt: new Date().toISOString(),
    trigger: auto ? 'response-hook' : 'button',
    request: ctx.request ? { method: ctx.request.method, url: ctx.request.url } : null,
    response: {
      status: ctx.response.status,
      statusText: ctx.response.statusText,
      timeMs: ctx.response.timeMs,
      sizeBytes: ctx.response.sizeBytes,
      contentType: ctx.response.contentType,
      body: ctx.response.bodyText ?? null,
      truncated: !!ctx.response.truncated
    }
  }

  const res = await relay.fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })

  // Plugin-scoped storage: keep a running counter + remember the last result.
  const count = Number(relay.storage.get('forwarded') || '0') + 1
  relay.storage.set('forwarded', String(count))
  relay.storage.set('lastStatus', String(ctx.response.status))
  relay.storage.set('lastAt', new Date().toISOString())

  if (res.ok) relay.toast('Ответ отправлен в webhook (' + res.status + '), всего: ' + count)
  else relay.toast('Webhook ответил ' + res.status, 'error')
}

relay.on('button:post-webhook', (ctx) => forward(ctx, false))

relay.on('response', (ctx) => {
  if ((relay.config.autoForward || '').trim().toLowerCase() !== 'on') return
  return forward(ctx, true)
})

// Pre-send hook (request:write): tag outgoing requests when enabled.
relay.on('request', () => {
  if ((relay.config.tagRequests || '').trim().toLowerCase() === 'on') {
    relay.request.setHeader('X-Relay-Plugin', 'webhook-forwarder')
  }
})

// Command (Cmd/Ctrl+K): copy a one-line summary of the current response.
relay.on('command:copy-summary', (ctx) => {
  if (!ctx.response) return relay.toast('Нет ответа для копирования', 'error')
  const line =
    (ctx.request ? ctx.request.method + ' ' + ctx.request.url + ' → ' : '') +
    ctx.response.status + ' ' + ctx.response.statusText + ' (' + ctx.response.timeMs + ' ms)'
  relay.clipboard.writeText(line)
  relay.toast('Сводка скопирована в буфер обмена')
})

// Interactive panel: a button inside the iframe posts a message back, and the
// handler re-renders with fresh numbers. (iframe runs scripts but is a null
// origin — it can only postMessage to the app.)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  )
}
function renderStats(ctx) {
  const count = relay.storage.get('forwarded') || '0'
  const lastStatus = relay.storage.get('lastStatus') || '—'
  const lastAt = relay.storage.get('lastAt') || '—'
  const cur = ctx.response ? ctx.response.status + ' ' + ctx.response.statusText : 'нет ответа'
  const histN = ctx.history ? ctx.history.length : 0
  relay.panel.set(
    '<style>body{font:13px -apple-system,system-ui,sans-serif;color:#ddd;padding:14px}' +
      'h3{margin:0 0 10px;font-size:14px}.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #333}' +
      'b{color:#22c55e}button{margin-top:12px;background:#22c55e;border:0;color:#06210f;padding:6px 12px;border-radius:6px;cursor:pointer}</style>' +
      '<h3>Webhook Forwarder</h3>' +
      '<div class="row"><span>Отправлено всего</span><b>' + esc(count) + '</b></div>' +
      '<div class="row"><span>Последний статус</span><b>' + esc(lastStatus) + '</b></div>' +
      '<div class="row"><span>Последняя отправка</span><span>' + esc(lastAt) + '</span></div>' +
      '<div class="row"><span>Текущий ответ</span><span>' + esc(cur) + '</span></div>' +
      '<div class="row"><span>Записей в истории</span><span>' + esc(histN) + '</span></div>' +
      '<button onclick="parent.postMessage({action:\\'refresh\\'},\\'*\\')">Обновить из плагина</button>'
  )
}
relay.on('panel:stats', renderStats)
`

export const SAMPLE_PLUGIN_FILES: Record<string, string> = {
  'plugin.json': JSON.stringify(manifest, null, 2) + '\n',
  'main.js': mainJs
}

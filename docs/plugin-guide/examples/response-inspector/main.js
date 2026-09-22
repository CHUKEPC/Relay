// Renders a small HTML report into the "Сводка" response tab.
// The HTML is shown in a sandboxed iframe: no scripts, no network.
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

relay.on('panel:summary', (ctx) => {
  const res = ctx.response
  if (!res) {
    relay.panel.set('<p style="font:13px sans-serif;color:#888">Отправьте запрос — здесь появится сводка.</p>')
    return
  }
  // headers arrive as [name, value] pairs; credential values are already masked
  const headers = (res.headers || [])
    .slice()
    .sort((a, b) => String(b[1]).length - String(a[1]).length)
    .slice(0, 5)
    .map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`)
    .join('')
  relay.panel.set(`
    <style>
      body { font: 13px/1.5 system-ui, sans-serif; color: #ddd; background: transparent; margin: 12px; }
      .big { font-size: 22px; font-weight: 600; }
      td { padding: 2px 10px 2px 0; vertical-align: top; word-break: break-all; }
    </style>
    <div class="big">${escape(res.status)} ${escape(res.statusText || '')}</div>
    <p>${escape(res.timeMs)} мс · ${escape(res.sizeBytes)} байт · ${escape(res.contentType || 'без Content-Type')}</p>
    <table>${headers}</table>
  `)
})

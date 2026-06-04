/* Request builder + Response panel */
(function () {
  const { useState } = React;
  const Icon = window.Icon;

  function UrlText({ url }) {
    // render {{var}} tokens highlighted
    const parts = url.split(/(\{\{[^}]+\}\})/g);
    return React.createElement('span', { className: 'url-text mono' },
      parts.map((p, i) => /^\{\{.*\}\}$/.test(p)
        ? React.createElement('span', { key: i, className: 'var-token' }, p)
        : React.createElement('span', { key: i }, p)));
  }

  function Checkbox({ on, onClick }) {
    return React.createElement('div', { className: 'ck' + (on ? ' on' : ''), onClick },
      on && React.createElement(Icon, { name: 'check', size: 11, strokeWidth: 2.4 }));
  }

  function KVTable({ rows, setRows, kPlaceholder, vPlaceholder, showDesc }) {
    const update = (i, field, val) => setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
    return React.createElement('div', { className: 'kv-area' },
      React.createElement('div', { className: 'kv-table' },
        React.createElement('div', { className: 'kv-head' },
          React.createElement('span', null, ''),
          React.createElement('span', null, 'Ключ'),
          React.createElement('span', null, 'Значение'),
          React.createElement('span', null, showDesc ? 'Описание' : ''),
          React.createElement('span', null, '')),
        rows.map((r, i) => React.createElement('div', { key: i, className: 'kv-row' + (r.enabled ? '' : ' off') },
          React.createElement(Checkbox, { on: r.enabled, onClick: () => update(i, 'enabled', !r.enabled) }),
          React.createElement('div', { className: 'kv-cell k' },
            React.createElement('input', { value: r.k, placeholder: kPlaceholder || 'key', onChange: e => update(i, 'k', e.target.value) })),
          React.createElement('div', { className: 'kv-cell' },
            React.createElement(VarInput, { value: r.v, placeholder: vPlaceholder || 'value', onChange: v => update(i, 'v', v) })),
          React.createElement('div', { className: 'kv-cell' },
            React.createElement('input', { value: r.desc || '', placeholder: showDesc ? 'описание' : '', onChange: e => update(i, 'desc', e.target.value) })),
          React.createElement('button', { className: 'icon-btn', style: { width: 26, height: 26 }, onClick: () => setRows(rows.filter((_, idx) => idx !== i)) },
            React.createElement(Icon, { name: 'close', size: 13 })))),
        React.createElement('div', { className: 'kv-row', style: { opacity: 0.6, cursor: 'pointer' },
          onClick: () => setRows([...rows, { k: '', v: '', enabled: true, desc: '' }]) },
          React.createElement('span', null),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--tx-2)', fontSize: 12, height: 30, paddingLeft: 9 } },
            React.createElement(Icon, { name: 'plus', size: 13 }), 'Добавить'))
      ));
  }

  // input that highlights {{vars}} via overlay
  function VarInput({ value, placeholder, onChange }) {
    return React.createElement('input', { value, placeholder, onChange: e => onChange(e.target.value), spellCheck: false });
  }

  const AUTH_TYPES = ['Bearer', 'Basic', 'API Key', 'OAuth 2.0', 'No Auth'];

  function AuthPanel() {
    const [type, setType] = useState('Bearer');
    return React.createElement('div', { style: { padding: '16px 14px', maxWidth: 560 } },
      React.createElement('div', { className: 'field' },
        React.createElement('label', null, 'Тип авторизации'),
        React.createElement('div', { className: 'seg', style: { flexWrap: 'wrap' } },
          AUTH_TYPES.map(t => React.createElement('button', { key: t, className: type === t ? 'on' : '', onClick: () => setType(t) }, t)))),
      type === 'Bearer' && React.createElement('div', { className: 'field' },
        React.createElement('label', null, 'Token'),
        React.createElement('div', { className: 'input mono', style: { display: 'flex', alignItems: 'center' } },
          React.createElement('span', null, 'Bearer '),
          React.createElement('span', { className: 'var-token' }, '{{token}}'))),
      type === 'Basic' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'field' }, React.createElement('label', null, 'Username'), React.createElement('input', { className: 'input', defaultValue: 'admin' })),
        React.createElement('div', { className: 'field' }, React.createElement('label', null, 'Password'), React.createElement('input', { className: 'input', type: 'password', defaultValue: 'secret' }))),
      type === 'API Key' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'field' }, React.createElement('label', null, 'Key'), React.createElement('input', { className: 'input mono', defaultValue: 'X-API-Key' })),
        React.createElement('div', { className: 'field' }, React.createElement('label', null, 'Value'), React.createElement('div', { className: 'input mono', style: { display: 'flex', alignItems: 'center' } }, React.createElement('span', { className: 'var-token' }, '{{api_key}}'))),
        React.createElement('div', { className: 'field' }, React.createElement('label', null, 'Добавить в'), React.createElement('div', { className: 'seg' }, React.createElement('button', { className: 'on' }, 'Header'), React.createElement('button', null, 'Query Params')))),
      type === 'OAuth 2.0' && React.createElement('div', { style: { color: 'var(--tx-2)', fontSize: 12.5, padding: '8px 0' } }, 'Настройте Grant Type, Auth URL, Token URL и Scope для получения токена.'),
      type === 'No Auth' && React.createElement('div', { style: { color: 'var(--tx-2)', fontSize: 12.5, padding: '8px 0' } }, 'Этот запрос не использует авторизацию.')
    );
  }

  const BODY_TYPES = ['none', 'JSON', 'form-data', 'x-www-form-urlencoded', 'raw'];
  const BODY_JSON = `{
  "name": "Studio Monitor Headphones",
  "category": "audio",
  "price": 299.00,
  "currency": "USD",
  "in_stock": true,
  "tags": ["wired", "over-ear", "pro"]
}`;

  function BodyPanel() {
    const [bt, setBt] = useState('JSON');
    return React.createElement('div', null,
      React.createElement('div', { className: 'subbar' },
        React.createElement('div', { className: 'seg' },
          BODY_TYPES.map(t => React.createElement('button', { key: t, className: bt === t ? 'on' : '', onClick: () => setBt(t) }, t))),
        bt === 'JSON' && React.createElement('button', { className: 'btn ghost', style: { marginLeft: 'auto', height: 26 } },
          React.createElement(Icon, { name: 'code2', size: 14 }), 'Beautify')),
      bt === 'JSON' && React.createElement('div', { className: 'code-editor' },
        React.createElement('div', { className: 'gutter-pre' },
          React.createElement('div', { className: 'lines' }, BODY_JSON.split('\n').map((_, i) => React.createElement('div', { key: i }, i + 1))),
          React.createElement('div', { className: 'code-pre' }, React.createElement(window.Hl, { text: BODY_JSON })))),
      bt === 'none' && React.createElement('div', { style: { padding: '30px 14px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12.5 } }, 'Тело запроса отсутствует'),
      (bt === 'form-data' || bt === 'x-www-form-urlencoded') && React.createElement(FormDataInner, null),
      bt === 'raw' && React.createElement('div', { className: 'code-editor' }, React.createElement('div', { className: 'code-pre', style: { color: 'var(--tx-1)' } }, 'plain text body…'))
    );
  }

  function FormDataInner() {
    const [rows, setRows] = useState([
      { k: 'name', v: 'Studio Monitor', enabled: true }, { k: 'category', v: 'audio', enabled: true },
    ]);
    return React.createElement(KVTable, { rows, setRows });
  }

  const REQ_TABS = [
    { id: 'params', label: 'Params' }, { id: 'auth', label: 'Authorization' },
    { id: 'headers', label: 'Headers' }, { id: 'body', label: 'Body' },
  ];

  function RequestBuilder({ req, onSend, sending, onPickMethod }) {
    const [tab, setTab] = useState('params');
    const [params, setParams] = useState(req.params);
    const [headers, setHeaders] = useState(req.headers);

    const counts = { params: params.filter(p => p.enabled).length, headers: headers.filter(h => h.enabled).length };

    return React.createElement('div', { style: { flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 } },
      React.createElement('div', { className: 'req-bar' },
        React.createElement('button', { className: 'method-select', onClick: onPickMethod },
          React.createElement('span', { className: `m-${req.method}` }, req.method),
          React.createElement(Icon, { name: 'chevDsm', size: 13, style: { color: 'var(--tx-3)', marginLeft: 'auto' } })),
        React.createElement('div', { className: 'url-bar' }, React.createElement(UrlText, { url: req.url })),
        React.createElement('button', { className: 'btn primary send-btn', onClick: onSend, disabled: sending },
          sending
            ? React.createElement(React.Fragment, null, React.createElement(Icon, { name: 'refresh', size: 15, className: 'spin' }), 'Отправка')
            : React.createElement(React.Fragment, null, 'Отправить', React.createElement(Icon, { name: 'send', size: 14 })))),
      React.createElement('div', { className: 'req-tabs' },
        REQ_TABS.map(t => React.createElement('button', { key: t.id, className: 'tab' + (tab === t.id ? ' on' : ''), onClick: () => setTab(t.id) },
          t.label, counts[t.id] != null && counts[t.id] > 0 && React.createElement('span', { className: 'count' }, counts[t.id])))),
      React.createElement('div', { style: { overflowY: 'auto', minHeight: 0 } },
        tab === 'params' && React.createElement(KVTable, { rows: params, setRows: setParams, kPlaceholder: 'param', showDesc: true }),
        tab === 'headers' && React.createElement(KVTable, { rows: headers, setRows: setHeaders, kPlaceholder: 'Header-Name' }),
        tab === 'auth' && React.createElement(AuthPanel, null),
        tab === 'body' && React.createElement(BodyPanel, null))
    );
  }

  window.RequestBuilder = RequestBuilder;
  window.UrlText = UrlText;
})();

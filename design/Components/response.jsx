/* Response panel: status bar, JSON viewer (collapsible), headers, cookies, loading + error states */
(function () {
  const { useState } = React;
  const Icon = window.Icon;

  // ---- Collapsible JSON renderer ----
  // Produces flat list of lines with indent; folds collapse ranges.
  function buildLines(obj) {
    const lines = [];
    function walk(val, indent, keyPrefix, trailingComma) {
      const pad = '  '.repeat(indent);
      if (Array.isArray(val)) {
        const openLine = { indent, type: 'open', bracket: '[', keyPrefix, foldable: val.length > 0, count: val.length, kind: 'array' };
        lines.push(openLine);
        const startIdx = lines.length;
        val.forEach((item, i) => walk(item, indent + 1, null, i < val.length - 1));
        openLine.endIdx = lines.length;
        openLine.startIdx = startIdx;
        lines.push({ indent, type: 'close', bracket: ']', trailingComma });
      } else if (val && typeof val === 'object') {
        const keys = Object.keys(val);
        const openLine = { indent, type: 'open', bracket: '{', keyPrefix, foldable: keys.length > 0, count: keys.length, kind: 'object' };
        lines.push(openLine);
        const startIdx = lines.length;
        keys.forEach((k, i) => walk(val[k], indent + 1, k, i < keys.length - 1));
        openLine.endIdx = lines.length;
        openLine.startIdx = startIdx;
        lines.push({ indent, type: 'close', bracket: '}', trailingComma });
      } else {
        lines.push({ indent, type: 'leaf', keyPrefix, value: val, trailingComma });
      }
    }
    walk(obj, 0, null, false);
    return lines;
  }

  function valueSpan(v) {
    if (typeof v === 'string') return React.createElement('span', { className: 'c-str' }, `"${v}"`);
    if (typeof v === 'number') return React.createElement('span', { className: 'c-num' }, String(v));
    if (typeof v === 'boolean') return React.createElement('span', { className: 'c-bool' }, String(v));
    if (v === null) return React.createElement('span', { className: 'c-null' }, 'null');
    return String(v);
  }

  function JsonViewer({ data }) {
    const allLines = React.useMemo(() => buildLines(data), [data]);
    const [folded, setFolded] = useState(() => new Set());

    const toggle = (i) => setFolded(prev => {
      const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n;
    });

    // determine hidden lines (between a folded open and its close)
    const hidden = new Array(allLines.length).fill(false);
    folded.forEach(i => {
      const ln = allLines[i];
      if (ln && ln.type === 'open') {
        for (let j = i + 1; j <= ln.endIdx; j++) hidden[j] = true;
      }
    });

    let lineNo = 0;
    return React.createElement('div', { className: 'json-view' },
      allLines.map((ln, i) => {
        if (hidden[i]) return null;
        lineNo++;
        const num = lineNo;
        const pad = '  '.repeat(ln.indent);
        const keyEl = ln.keyPrefix != null
          ? React.createElement(React.Fragment, null, React.createElement('span', { className: 'c-key' }, `"${ln.keyPrefix}"`), React.createElement('span', { className: 'c-punct' }, ': '))
          : null;

        let content;
        if (ln.type === 'leaf') {
          content = React.createElement('span', null, pad, keyEl, valueSpan(ln.value), ln.trailingComma && React.createElement('span', { className: 'c-punct' }, ','));
        } else if (ln.type === 'open') {
          const isFolded = folded.has(i);
          content = React.createElement('span', null, pad,
            ln.foldable && React.createElement('span', { className: 'fold', onClick: () => toggle(i) },
              React.createElement(Icon, { name: isFolded ? 'chevR' : 'chevD', size: 11 })),
            keyEl,
            React.createElement('span', { className: 'c-punct' }, ln.bracket),
            isFolded && React.createElement('span', { className: 'fold-stub', onClick: () => toggle(i) },
              ` ${ln.count} ${ln.kind === 'array' ? 'items' : 'keys'} `, React.createElement('span', { className: 'c-punct' }, ln.bracket === '[' ? ']' : '}'),
              allLines[ln.endIdx] && allLines[ln.endIdx].trailingComma ? React.createElement('span', { className: 'c-punct' }, ',') : null)
          );
        } else {
          content = React.createElement('span', null, pad, React.createElement('span', { className: 'c-punct' }, ln.bracket), ln.trailingComma && React.createElement('span', { className: 'c-punct' }, ','));
        }
        return React.createElement('div', { className: 'json-line', key: i },
          React.createElement('span', { className: 'json-gutter' }, num),
          React.createElement('span', { className: 'json-content' }, content));
      })
    );
  }

  // ---- Loading skeleton ----
  function RespLoading() {
    return React.createElement('div', { style: { padding: '16px 14px' } },
      [70, 92, 55, 80, 45, 88, 60, 75, 40].map((w, i) =>
        React.createElement('div', { key: i, className: 'skel', style: { height: 11, width: w + '%', marginBottom: 11, marginLeft: (i % 3) * 18 } })));
  }

  // ---- Error state ----
  function RespError({ onAskAI }) {
    return React.createElement('div', { className: 'empty', style: { alignItems: 'flex-start', paddingTop: 30 } },
      React.createElement('div', { className: 'empty-card' },
        React.createElement('div', { className: 'empty-ico', style: { color: 'var(--s-5xx)', background: 'color-mix(in oklch, var(--s-5xx) 12%, var(--bg-2))', borderColor: 'color-mix(in oklch, var(--s-5xx) 30%, transparent)' } },
          React.createElement(Icon, { name: 'warn', size: 24 })),
        React.createElement('h3', null, '500 — Internal Server Error'),
        React.createElement('p', null, 'Сервер вернул ошибку при обработке запроса. Проверьте тело запроса и заголовки — или попросите AI разобраться.'),
        React.createElement('div', { className: 'empty-actions' },
          React.createElement('button', { className: 'btn' }, React.createElement(Icon, { name: 'refresh', size: 14 }), 'Повторить'),
          React.createElement('button', { className: 'btn primary', onClick: onAskAI }, React.createElement(Icon, { name: 'sparkle', size: 14 }), 'Спросить AI о причине'))));
  }

  const RESP_TABS = [{ id: 'body', label: 'Body' }, { id: 'headers', label: 'Headers' }, { id: 'cookies', label: 'Cookies' }];

  function ResponsePanel({ state, onAskAI }) {
    const [tab, setTab] = useState('body');
    const [bodyView, setBodyView] = useState('pretty');
    const [copied, setCopied] = useState(false);
    const status = 200;
    const sc = window.statusColor(status);

    if (state === 'empty') {
      return React.createElement('div', { className: 'response', style: { flex: 1 } },
        React.createElement('div', { className: 'empty' },
          React.createElement('div', { className: 'empty-card' },
            React.createElement('div', { className: 'empty-ico' }, React.createElement(Icon, { name: 'send', size: 22 })),
            React.createElement('h3', null, 'Готов отправить запрос'),
            React.createElement('p', null, 'Нажмите ', React.createElement('b', { style: { color: 'var(--tx-0)' } }, 'Отправить'), ' или ', React.createElement('span', { className: 'kbd' }, '⌘↵'), ' — ответ появится здесь.'))));
    }

    return React.createElement('div', { className: 'response', style: { flex: 1 } },
      React.createElement('div', { className: 'resp-statusbar' },
        state === 'loading'
          ? React.createElement('div', { className: 'resp-meta' }, React.createElement(Icon, { name: 'refresh', size: 14, className: 'spin' }), 'Отправка запроса…')
          : React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'status-pill', style: { color: sc, background: 'color-mix(in oklch, ' + sc + ' 14%, transparent)' } },
              React.createElement('span', { className: 'pulse', style: { background: sc } }), '200 OK'),
            React.createElement('div', { className: 'resp-meta' },
              React.createElement(Icon, { name: 'history', size: 13, style: { color: 'var(--tx-3)' } }), React.createElement('b', null, '142 ms'),
              React.createElement('span', { className: 'sep' }, '•'),
              React.createElement('b', null, '1.28 KB'),
              React.createElement('span', { className: 'sep' }, '•'),
              React.createElement('span', null, '8 headers')),
            React.createElement('div', { className: 'resp-actions' },
              React.createElement('button', { className: 'ask-ai-btn', onClick: onAskAI }, React.createElement(Icon, { name: 'sparkle', size: 14 }), 'Спросить AI'),
              React.createElement('button', { className: 'icon-btn', title: 'Копировать', onClick: () => { setCopied(true); setTimeout(() => setCopied(false), 1200); } },
                React.createElement(Icon, { name: copied ? 'check' : 'copy', size: 15 })),
              React.createElement('button', { className: 'icon-btn', title: 'Сохранить' }, React.createElement(Icon, { name: 'save', size: 15 }))))),

      state !== 'loading' && React.createElement('div', { className: 'resp-tabs' },
        RESP_TABS.map(t => React.createElement('button', { key: t.id, className: 'tab' + (tab === t.id ? ' on' : ''), onClick: () => setTab(t.id) }, t.label,
          t.id === 'headers' && React.createElement('span', { className: 'count' }, '8'),
          t.id === 'cookies' && React.createElement('span', { className: 'count' }, '2'))),
        tab === 'body' && React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('div', { className: 'side-search', style: { margin: 0, height: 26, minWidth: 150 } },
            React.createElement(Icon, { name: 'search', size: 12 }),
            React.createElement('input', { placeholder: 'Поиск в ответе…', style: { fontSize: 12 } })),
          React.createElement('div', { className: 'seg', style: { height: 28 } },
            React.createElement('button', { className: bodyView === 'pretty' ? 'on' : '', onClick: () => setBodyView('pretty'), style: { height: 22 } }, 'Pretty'),
            React.createElement('button', { className: bodyView === 'raw' ? 'on' : '', onClick: () => setBodyView('raw'), style: { height: 22 } }, 'Raw')))),

      React.createElement('div', { className: 'resp-body' },
        state === 'loading' && React.createElement(RespLoading, null),
        state === 'error' && React.createElement(RespError, { onAskAI }),
        state === 'done' && tab === 'body' && (bodyView === 'pretty'
          ? React.createElement(JsonViewer, { data: window.RESPONSE_JSON })
          : React.createElement('div', { className: 'json-view', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, JSON.stringify(window.RESPONSE_JSON))),
        state === 'done' && tab === 'headers' && React.createElement('table', { className: 'resp-table' },
          React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, 'Header'), React.createElement('th', null, 'Value'))),
          React.createElement('tbody', null, window.RESPONSE_HEADERS.map(([k, v], i) =>
            React.createElement('tr', { key: i }, React.createElement('td', { className: 'hk' }, k), React.createElement('td', { className: 'hv' }, v))))),
        state === 'done' && tab === 'cookies' && React.createElement('table', { className: 'resp-table' },
          React.createElement('thead', null, React.createElement('tr', null, ['Name', 'Value', 'Domain', 'Path', 'SameSite', 'Expires'].map(h => React.createElement('th', { key: h }, h)))),
          React.createElement('tbody', null, window.RESPONSE_COOKIES.map((c, i) =>
            React.createElement('tr', { key: i }, c.map((cell, j) => React.createElement('td', { key: j, className: j === 0 ? 'hk' : 'hv' }, cell)))))))
    );
  }

  window.ResponsePanel = ResponsePanel;
})();

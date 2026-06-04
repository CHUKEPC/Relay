/* Sidebar: Collections / History / Environments */
(function () {
  const { useState } = React;
  const Icon = window.Icon;

  function MethodTag({ m }) {
    return React.createElement('span', { className: `method-tag mtag m-${m}` }, m === 'DELETE' ? 'DEL' : m);
  }

  function TreeNode({ node, depth, onOpenReq, activeId }) {
    const [open, setOpen] = useState(node.open !== false);
    const isFolder = node.type === 'folder';
    if (isFolder) {
      return React.createElement('div', null,
        React.createElement('div', {
          className: 'tree-row', style: { paddingLeft: 8 + depth * 14 },
          onClick: () => setOpen(o => !o)
        },
          React.createElement('span', { className: 'chev' },
            React.createElement(Icon, { name: open ? 'chevD' : 'chevR', size: 12 })),
          React.createElement('span', { className: 'twirl' },
            React.createElement(Icon, { name: 'folder', size: 15 })),
          React.createElement('span', { className: 'name', style: { fontWeight: depth === 0 ? 600 : 500 } }, node.name),
        ),
        open && React.createElement('div', { className: 'tree-children' },
          node.children.map(c => React.createElement(TreeNode, { key: c.id, node: c, depth: depth + 1, onOpenReq, activeId })))
      );
    }
    return React.createElement('div', {
      className: 'tree-row' + (activeId === node.id ? ' active' : ''),
      style: { paddingLeft: 8 + depth * 14 },
      onClick: () => onOpenReq(node)
    },
      React.createElement('span', { className: 'twirl', style: { marginLeft: 14 } },
        React.createElement(Icon, { name: 'doc', size: 14, style: { opacity: 0.55 } })),
      React.createElement('span', { className: 'name' }, node.name),
      React.createElement(MethodTag, { m: node.method }),
    );
  }

  function statusColor(s) {
    if (s >= 500) return 'var(--s-5xx)';
    if (s >= 400) return 'var(--s-4xx)';
    if (s >= 300) return 'var(--s-3xx)';
    return 'var(--s-2xx)';
  }

  function Sidebar({ tab, setTab, onOpenReq, activeId, query, setQuery, onNewRequest, envId, setEnvId, onOpenSettings }) {
    const tabs = [
      { id: 'collections', label: 'Коллекции', icon: 'collections' },
      { id: 'history', label: 'История', icon: 'history' },
      { id: 'env', label: 'Среды', icon: 'env' },
    ];

    return React.createElement('aside', { className: 'sidebar' },
      React.createElement('div', { className: 'side-nav' },
        React.createElement('div', { className: 'seg' },
          tabs.map(t => React.createElement('button', {
            key: t.id, className: tab === t.id ? 'on' : '', onClick: () => setTab(t.id),
            title: t.label
          },
            React.createElement(Icon, { name: t.icon, size: 14 }),
          )))
      ),

      tab !== 'env' && React.createElement('div', { className: 'side-search' },
        React.createElement(Icon, { name: 'search', size: 14 }),
        React.createElement('input', {
          placeholder: tab === 'collections' ? 'Поиск запросов…' : 'Поиск в истории…',
          value: query, onChange: e => setQuery(e.target.value)
        })
      ),

      tab === 'collections' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'side-section-head' },
          React.createElement('span', null, 'Коллекции'),
          React.createElement('button', { className: 'icon-btn', style: { width: 22, height: 22 }, onClick: onNewRequest, title: 'Новый запрос' },
            React.createElement(Icon, { name: 'plus', size: 14 }))
        ),
        React.createElement('div', { className: 'tree' },
          window.COLLECTIONS.map(n => React.createElement(TreeNode, { key: n.id, node: n, depth: 0, onOpenReq, activeId })))
      ),

      tab === 'history' && React.createElement('div', { className: 'tree' },
        window.HISTORY.filter(h => h.name.toLowerCase().includes(query.toLowerCase())).map(h =>
          React.createElement('div', { key: h.id, className: 'hist-row', onClick: () => onOpenReq({ name: h.name, method: h.method }) },
            React.createElement(MethodTag, { m: h.method }),
            React.createElement('div', { className: 'meta' },
              React.createElement('div', { className: 'url' }, h.name),
              React.createElement('div', { className: 'time' }, h.time)),
            React.createElement('span', { className: 'status-dot', style: { color: statusColor(h.status), background: 'color-mix(in oklch, ' + statusColor(h.status) + ' 14%, transparent)' } }, h.status)
          ))
      ),

      tab === 'env' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'side-section-head' },
          React.createElement('span', null, 'Среды'),
          React.createElement('button', { className: 'icon-btn', style: { width: 22, height: 22 }, title: 'Новая среда' },
            React.createElement(Icon, { name: 'plus', size: 14 }))
        ),
        React.createElement('div', { className: 'tree' },
          window.ENVIRONMENTS.map(e => React.createElement('div', {
            key: e.id, className: 'env-row' + (envId === e.id ? ' active' : ''), onClick: () => setEnvId(e.id)
          },
            React.createElement(Icon, { name: 'env', size: 15, style: { color: e.id === 'e0' ? 'var(--tx-3)' : 'var(--m-get)', opacity: 0.9 } }),
            React.createElement('span', { className: 'ename' }, e.name),
            envId === e.id && React.createElement(Icon, { name: 'check', size: 14, style: { color: 'var(--accent)' } })
          )))
      ),

      React.createElement('div', { style: { marginTop: 'auto', padding: 10, borderTop: '1px solid var(--line)' } },
        React.createElement('button', { className: 'tree-row', style: { width: '100%' }, onClick: onOpenSettings },
          React.createElement('span', { className: 'twirl' }, React.createElement(Icon, { name: 'settings', size: 15 })),
          React.createElement('span', { className: 'name' }, 'Настройки'),
          React.createElement('span', { className: 'kbd' }, '⌘,'))
      )
    );
  }

  window.Sidebar = Sidebar;
  window.statusColor = statusColor;
  window.MethodTag = MethodTag;
})();

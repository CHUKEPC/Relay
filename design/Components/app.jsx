/* Relay — main app shell */
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const Icon = window.Icon;

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  function App() {
    const [theme, setTheme] = useState('dark');
    const [sideTab, setSideTab] = useState('collections');
    const [query, setQuery] = useState('');
    const [tabs, setTabs] = useState([
      { id: 't1', name: 'List products', method: 'GET', dirty: false },
      { id: 't2', name: 'Create order', method: 'POST', dirty: true },
    ]);
    const [activeTab, setActiveTab] = useState('t1');
    const [req, setReq] = useState(window.OPEN_REQUEST);
    const [respState, setRespState] = useState('done'); // empty | loading | done | error
    const [aiOpen, setAiOpen] = useState(true);
    const [aiConnected, setAiConnected] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsSection, setSettingsSection] = useState('providers');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [methodOpen, setMethodOpen] = useState(false);
    const [envOpen, setEnvOpen] = useState(false);
    const [modelOpen, setModelOpen] = useState(false);
    const [envId, setEnvId] = useState('e1');
    const [providers, setProviders] = useState(window.PROVIDERS);
    const [respHeight, setRespHeight] = useState(46); // percent
    const [layout, setLayout] = useState('split-v'); // split-v | split-h

    const activeProvider = providers.find(p => p.active) || providers[0];
    const env = window.ENVIRONMENTS.find(e => e.id === envId);

    // theme apply with transition
    useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
      document.body.classList.add('theming');
      const t = setTimeout(() => document.body.classList.remove('theming'), 400);
      return () => clearTimeout(t);
    }, [theme]);

    // keyboard shortcuts
    useEffect(() => {
      const onKey = (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
        else if (mod && e.key === 'Enter') { e.preventDefault(); doSend(); }
        else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setAiOpen(o => !o); }
        else if (mod && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
        else if (e.key === 'Escape') { setSettingsOpen(false); setMethodOpen(false); setEnvOpen(false); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    });

    const doSend = useCallback(() => {
      setRespState('loading');
      setTimeout(() => setRespState('done'), 1100);
    }, []);

    function openReq(node) {
      const exists = tabs.find(t => t.name === node.name);
      if (!exists) {
        const id = 't' + Date.now();
        setTabs(prev => [...prev, { id, name: node.name, method: node.method, dirty: false }]);
        setActiveTab(id);
      } else setActiveTab(exists.id);
      setReq(r => ({ ...r, method: node.method || r.method }));
      setRespState('empty');
    }

    function closeTab(id, e) {
      e.stopPropagation();
      setTabs(prev => {
        const next = prev.filter(t => t.id !== id);
        if (activeTab === id && next.length) setActiveTab(next[next.length - 1].id);
        return next;
      });
    }

    function newRequest() {
      const id = 't' + Date.now();
      setTabs(prev => [...prev, { id, name: 'Untitled', method: 'GET', dirty: true }]);
      setActiveTab(id);
      setRespState('empty');
    }

    function handlePaletteAction(it) {
      setPaletteOpen(false);
      if (it.kind === 'req') openReq({ name: it.title, method: it.mt });
      else if (it.kind === 'new') newRequest();
      else if (it.kind === 'send') doSend();
      else if (it.kind === 'ai') setAiOpen(true);
      else if (it.kind === 'settings') setSettingsOpen(true);
      else if (it.kind === 'theme') setTheme(t => t === 'dark' ? 'light' : 'dark');
      else if (it.kind === 'env') { /* env switch */ }
    }

    function askAI() { setAiOpen(true); }

    // divider drag
    const draggingRef = useRef(false);
    const wsRef = useRef(null);
    function onDividerDown(e) {
      draggingRef.current = true;
      document.body.style.cursor = layout === 'split-v' ? 'row-resize' : 'col-resize';
      const move = (ev) => {
        if (!draggingRef.current || !wsRef.current) return;
        const r = wsRef.current.getBoundingClientRect();
        let pct;
        if (layout === 'split-v') pct = (1 - (ev.clientY - r.top) / r.height) * 100;
        else pct = (1 - (ev.clientX - r.left) / r.width) * 100;
        setRespHeight(Math.max(18, Math.min(78, pct)));
      };
      const up = () => { draggingRef.current = false; document.body.style.cursor = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    }

    const curReq = { ...req, method: tabs.find(t => t.id === activeTab)?.method || req.method };

    return React.createElement('div', { className: 'app' },
      // ---- titlebar ----
      React.createElement('div', { className: 'titlebar' },
        React.createElement('div', { className: 'win-dots' }, React.createElement('i'), React.createElement('i'), React.createElement('i')),
        React.createElement('div', { className: 'brand', style: { marginLeft: 6 } },
          React.createElement('div', { className: 'brand-mark' }, React.createElement(Icon, { name: 'bolt', size: 13, style: { color: '#fff' } })),
          'Relay'),
        React.createElement('div', { className: 'grow' }),
        React.createElement('div', { className: 'global-search nodrag', onClick: () => setPaletteOpen(true) },
          React.createElement(Icon, { name: 'search', size: 14 }),
          React.createElement('span', { className: 'ph' }, 'Поиск или команда…'),
          React.createElement('span', { className: 'kbd' }, '⌘K')),
        React.createElement('div', { className: 'grow' }),
        // env pill
        React.createElement('div', { style: { position: 'relative' } },
          React.createElement('div', { className: 'env-pill', onClick: () => setEnvOpen(o => !o) },
            React.createElement('span', { className: 'dot' }),
            env ? env.name : 'No Environment',
            React.createElement(Icon, { name: 'chevDsm', size: 13, style: { color: 'var(--tx-3)' } })),
          envOpen && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 60 }, onClick: () => setEnvOpen(false) },
            React.createElement('div', { className: 'popover', style: { top: 44, right: 120, minWidth: 200 }, onClick: e => e.stopPropagation() },
              window.ENVIRONMENTS.map(e => React.createElement('div', { key: e.id, className: 'pop-item' + (envId === e.id ? ' on' : ''), onClick: () => { setEnvId(e.id); setEnvOpen(false); } },
                React.createElement(Icon, { name: 'env', size: 14, style: { color: e.id === 'e0' ? 'var(--tx-3)' : 'var(--m-get)' } }),
                e.name,
                envId === e.id && React.createElement(Icon, { name: 'check', size: 14, className: 'tick' })))))),
        // theme toggle
        React.createElement('div', { className: 'theme-toggle' },
          React.createElement('button', { className: theme === 'light' ? 'on' : '', onClick: () => setTheme('light'), title: 'Светлая' }, React.createElement(Icon, { name: 'sun', size: 15 })),
          React.createElement('button', { className: theme === 'dark' ? 'on' : '', onClick: () => setTheme('dark'), title: 'Тёмная' }, React.createElement(Icon, { name: 'moon', size: 14 }))),
        React.createElement('button', { className: 'icon-btn nodrag' + (aiOpen ? ' on' : ''), onClick: () => setAiOpen(o => !o), title: 'AI-ассистент (⌘J)' },
          React.createElement(Icon, { name: 'sparkle', size: 16 }))),

      // ---- tab strip ----
      React.createElement('div', { className: 'tabstrip' },
        tabs.map(t => React.createElement('div', { key: t.id, className: 'rtab' + (activeTab === t.id ? ' on' : ''), onClick: () => setActiveTab(t.id) },
          React.createElement('span', { className: `method-tag m-${t.method}` }, t.method === 'DELETE' ? 'DEL' : t.method),
          React.createElement('span', { className: 'label' }, t.name),
          t.dirty
            ? React.createElement('span', { className: 'dirty', title: 'Несохранённые изменения' })
            : React.createElement('span', { className: 'x', onClick: (e) => closeTab(t.id, e) }, React.createElement(Icon, { name: 'close', size: 12 })))),
        React.createElement('button', { className: 'icon-btn', style: { alignSelf: 'center', marginLeft: 4 }, onClick: newRequest, title: 'Новый запрос (⌘N)' },
          React.createElement(Icon, { name: 'plus', size: 16 }))),

      // ---- body ----
      React.createElement('div', { className: 'body' },
        React.createElement(window.Sidebar, { tab: sideTab, setTab: setSideTab, onOpenReq: openReq, activeId: 'r4', query, setQuery, onNewRequest: newRequest, envId, setEnvId, onOpenSettings: () => setSettingsOpen(true) }),

        React.createElement('div', { className: 'main' },
          React.createElement('div', { className: 'workspace', ref: wsRef, style: layout === 'split-h' ? { flexDirection: 'row' } : null },
            // request builder
            React.createElement('div', { style: layout === 'split-h' ? { width: (100 - respHeight) + '%', display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--line)' } : { flex: 'none' } },
              React.createElement(window.RequestBuilder, { req: curReq, onSend: doSend, sending: respState === 'loading', onPickMethod: () => setMethodOpen(o => !o) }),
              methodOpen && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 60 }, onClick: () => setMethodOpen(false) },
                React.createElement('div', { className: 'popover', style: { top: 96, left: 78, minWidth: 130 }, onClick: e => e.stopPropagation() },
                  METHODS.map(m => React.createElement('div', { key: m, className: 'pop-item', onClick: () => { setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, method: m } : t)); setMethodOpen(false); } },
                    React.createElement('span', { className: `method-tag m-${m}`, style: { width: 48 } }, m), curReq.method === m && React.createElement(Icon, { name: 'check', size: 14, className: 'tick' })))))),

            // divider
            layout === 'split-v'
              ? React.createElement('div', { className: 'divider', onMouseDown: onDividerDown }, React.createElement('div', { className: 'grip' }))
              : null,

            // response
            React.createElement('div', { style: layout === 'split-v' ? { height: respHeight + '%', display: 'flex', flexDirection: 'column', minHeight: 0 } : { width: respHeight + '%', display: 'flex', flexDirection: 'column', minWidth: 0 } },
              layout === 'split-h' ? React.createElement('div', { className: 'divider', style: { width: 8, height: 'auto', cursor: 'col-resize', position: 'absolute' } }) : null,
              React.createElement(window.ResponsePanel, { state: respState, onAskAI: askAI }))
          )),

        // ---- AI panel ----
        aiOpen && (aiConnected
          ? React.createElement(window.AiPanel, { onClose: () => setAiOpen(false), onPickModel: () => setModelOpen(true), activeProvider })
          : React.createElement(window.AiPanelEmpty, { onClose: () => setAiOpen(false), onConnect: () => { setSettingsSection('providers'); setSettingsOpen(true); } }))),

      // ---- overlays ----
      settingsOpen && React.createElement(window.Settings, { onClose: () => setSettingsOpen(false), theme, setTheme, providers, setProviders, initialSection: settingsSection }),
      paletteOpen && React.createElement(window.CommandPalette, { onClose: () => setPaletteOpen(false), onAction: handlePaletteAction }),
      modelOpen && React.createElement(window.ModelPicker, { providers, onClose: () => setModelOpen(false), onManage: () => { setModelOpen(false); setSettingsSection('providers'); setSettingsOpen(true); },
        onPick: (pid, m) => { setProviders(prev => prev.map(p => ({ ...p, active: p.id === pid, model: p.id === pid ? m : p.model, connected: p.id === pid ? true : p.connected }))); setModelOpen(false); } })
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();

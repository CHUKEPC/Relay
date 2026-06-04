/* Command palette (Cmd/Ctrl+K) + model picker popover */
(function () {
  const { useState, useEffect, useRef } = React;
  const Icon = window.Icon;

  function CommandPalette({ onClose, onAction }) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(0);
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

    const groups = [
      { label: 'Запросы', items: [
        { id: 'r4', mt: 'GET', title: 'List products', desc: 'Acme Commerce API / Products', icon: 'doc', kind: 'req' },
        { id: 'r6', mt: 'POST', title: 'Create product', desc: 'Acme Commerce API / Products', icon: 'doc', kind: 'req' },
        { id: 'r1', mt: 'POST', title: 'Login', desc: 'Acme Commerce API / Authentication', icon: 'doc', kind: 'req' },
        { id: 'r8', mt: 'DELETE', title: 'Delete product', desc: 'Acme Commerce API / Products', icon: 'doc', kind: 'req' },
      ]},
      { label: 'Действия', items: [
        { id: 'new', title: 'Новый запрос', desc: '', icon: 'plus', kbd: ['⌘', 'N'], kind: 'new' },
        { id: 'send', title: 'Отправить текущий запрос', desc: '', icon: 'send', kbd: ['⌘', '↵'], kind: 'send' },
        { id: 'ai', title: 'Открыть AI-ассистента', desc: '', icon: 'sparkle', kbd: ['⌘', 'J'], kind: 'ai' },
        { id: 'settings', title: 'Открыть настройки', desc: '', icon: 'settings', kbd: ['⌘', ','], kind: 'settings' },
        { id: 'theme', title: 'Переключить тему', desc: '', icon: 'moon', kind: 'theme' },
      ]},
      { label: 'Среды', items: [
        { id: 'e1', title: 'Перейти в Production', desc: 'Окружение', icon: 'env', kind: 'env' },
        { id: 'e2', title: 'Перейти в Staging', desc: 'Окружение', icon: 'env', kind: 'env' },
      ]},
    ];

    const filtered = groups.map(g => ({ ...g, items: g.items.filter(it => (it.title + ' ' + it.desc + ' ' + (it.mt || '')).toLowerCase().includes(q.toLowerCase())) })).filter(g => g.items.length);
    const flat = filtered.flatMap(g => g.items);
    const clampedSel = Math.min(sel, Math.max(0, flat.length - 1));

    useEffect(() => {
      const onKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); flat[clampedSel] && onAction(flat[clampedSel]); }
        else if (e.key === 'Escape') { onClose(); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [flat, clampedSel]);

    let runningIndex = -1;
    return React.createElement('div', { className: 'palette-scrim', onClick: onClose },
      React.createElement('div', { className: 'palette', onClick: e => e.stopPropagation() },
        React.createElement('div', { className: 'palette-input' },
          React.createElement(Icon, { name: 'search', size: 18 }),
          React.createElement('input', { ref: inputRef, placeholder: 'Поиск запросов и действий…', value: q, onChange: e => { setQ(e.target.value); setSel(0); } }),
          React.createElement('span', { className: 'kbd' }, 'esc')),
        React.createElement('div', { className: 'palette-list' },
          flat.length === 0 && React.createElement('div', { style: { padding: '26px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 } }, 'Ничего не найдено'),
          filtered.map(g => React.createElement('div', { key: g.label },
            React.createElement('div', { className: 'pal-group-label' }, g.label),
            g.items.map(it => {
              runningIndex++;
              const isSel = runningIndex === clampedSel;
              return React.createElement('div', { key: it.id, className: 'pal-item' + (isSel ? ' sel' : ''), onMouseEnter: (function (idx) { return () => setSel(idx); })(runningIndex), onClick: () => onAction(it) },
                React.createElement('div', { className: 'pal-ico' }, React.createElement(Icon, { name: it.icon, size: 15 })),
                React.createElement('div', { className: 'pal-text' },
                  React.createElement('div', { className: 'pal-title' }, it.mt && React.createElement('span', { className: `mt m-${it.mt}` }, it.mt), it.title),
                  it.desc && React.createElement('div', { className: 'pal-desc' }, it.desc)),
                it.kbd && React.createElement('div', { style: { display: 'flex', gap: 3 } }, it.kbd.map((k, j) => React.createElement('span', { key: j, className: 'kbd' }, k))));
            })))),
        React.createElement('div', { className: 'pal-foot' },
          React.createElement('span', null, React.createElement('span', { className: 'kbd' }, '↑'), React.createElement('span', { className: 'kbd' }, '↓'), 'навигация'),
          React.createElement('span', null, React.createElement('span', { className: 'kbd' }, '↵'), 'выбрать'),
          React.createElement('div', { className: 'grow' }),
          React.createElement('span', null, React.createElement(Icon, { name: 'bolt', size: 12 }), 'Relay'))));
  }

  // Model picker popover (anchored)
  function ModelPicker({ providers, onPick, onClose, onManage }) {
    useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
    }, []);
    return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 70 }, onClick: onClose },
      React.createElement('div', { className: 'popover', style: { top: 78, right: 18, minWidth: 240 }, onClick: e => e.stopPropagation() },
        providers.filter(p => p.connected).map(p =>
          React.createElement('div', { key: p.id },
            p.models.map(m => React.createElement('div', { key: m, className: 'pop-item' + (p.active && m === p.model ? ' on' : ''), onClick: () => onPick(p.id, m) },
              React.createElement('span', { className: 'glyph', style: { width: 16, height: 16, borderRadius: 4, display: 'grid', placeItems: 'center', background: `oklch(0.6 0.17 ${p.hue})`, color: '#fff', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)' } }, p.glyph),
              React.createElement('span', { className: 'mono', style: { fontSize: 11.5 } }, m),
              p.active && m === p.model && React.createElement(Icon, { name: 'check', size: 14, className: 'tick' }))))),
        React.createElement('div', { className: 'pop-sep' }),
        React.createElement('div', { className: 'pop-item', onClick: onManage },
          React.createElement(Icon, { name: 'settings', size: 15 }), 'Управление провайдерами')));
  }

  window.CommandPalette = CommandPalette;
  window.ModelPicker = ModelPicker;
})();

/* Settings screen — AI providers, appearance, preferences */
(function () {
  const { useState } = React;
  const Icon = window.Icon;

  function ProviderCard({ p, selected, onClick }) {
    return React.createElement('div', { className: 'prov-card' + (selected ? ' active' : ''), onClick },
      React.createElement('div', { className: 'prov-logo', style: { background: `oklch(0.6 0.17 ${p.hue})` } }, p.glyph),
      React.createElement('div', { className: 'prov-info' },
        React.createElement('div', { className: 'prov-name' }, p.name,
          p.active && React.createElement('span', { className: 'badge-active' }, 'Активен')),
        React.createElement('div', { className: 'prov-sub' }, p.sub, p.connected ? ' · ' + p.model : '')),
      React.createElement('span', { className: 'prov-status ' + (p.connected ? 'ok' : 'no') },
        React.createElement('span', { className: 'd' }), p.connected ? 'Подключён' : 'Не подключён'),
      React.createElement(Icon, { name: 'chevR', size: 16, style: { color: 'var(--tx-3)' } }));
  }

  function ProviderDetail({ p, onSetActive, providers }) {
    const [reveal, setReveal] = useState(false);
    const [key, setKey] = useState(p.connected ? 'sk-' + p.id + '-••••••••••••••••3a9f' : '');
    const [model, setModel] = useState(p.model);
    const [open, setOpen] = useState(false);

    return React.createElement('div', { className: 'prov-detail' },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 } },
        React.createElement('div', { className: 'prov-logo', style: { background: `oklch(0.6 0.17 ${p.hue})`, width: 34, height: 34, borderRadius: 9, fontSize: 14 } }, p.glyph),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontWeight: 600, fontSize: 14 } }, p.name),
          React.createElement('div', { className: 'prov-sub' }, p.sub)),
        p.connected && !p.active && React.createElement('button', { className: 'btn primary', onClick: () => onSetActive(p.id) }, 'Сделать активным'),
        p.active && React.createElement('span', { className: 'prov-status ok' }, React.createElement('span', { className: 'd' }), 'Активный провайдер')),

      React.createElement('div', { className: 'field' },
        React.createElement('label', null, 'API-ключ'),
        React.createElement('div', { className: 'input-row' },
          React.createElement('div', { className: 'input-key' },
            React.createElement('input', { className: 'input mono', type: reveal ? 'text' : 'password', value: key, placeholder: 'sk-…', onChange: e => setKey(e.target.value) }),
            React.createElement('button', { className: 'icon-btn reveal', onClick: () => setReveal(r => !r) }, React.createElement(Icon, { name: 'eye', size: 15 }))),
          React.createElement('button', { className: 'btn' }, p.connected ? 'Обновить' : 'Подключить')),
        React.createElement('div', { className: 'hint' }, 'Ключ хранится локально и в зашифрованном виде. Никогда не покидает устройство, кроме запросов к провайдеру.')),

      React.createElement('div', { className: 'field' },
        React.createElement('label', null, 'Модель по умолчанию'),
        React.createElement('div', { style: { position: 'relative', display: 'inline-block' } },
          React.createElement('div', { className: 'select-box mono', onClick: () => setOpen(o => !o) },
            model, React.createElement(Icon, { name: 'chevDsm', size: 14, style: { marginLeft: 'auto', color: 'var(--tx-3)' } })),
          open && React.createElement('div', { className: 'popover', style: { top: 42, left: 0, minWidth: 220 } },
            p.models.map(mo => React.createElement('div', { key: mo, className: 'pop-item' + (mo === model ? ' on' : ''), onClick: () => { setModel(mo); setOpen(false); } },
              React.createElement('span', { className: 'mono', style: { fontSize: 12 } }, mo),
              mo === model && React.createElement(Icon, { name: 'check', size: 14, className: 'tick' })))))),

      p.id === 'openrouter' && React.createElement('div', { className: 'field' },
        React.createElement('label', null, 'Base URL (необязательно)'),
        React.createElement('input', { className: 'input mono', defaultValue: 'https://openrouter.ai/api/v1' }))
    );
  }

  const SNAV = [
    { id: 'providers', label: 'AI-провайдеры', icon: 'sparkle' },
    { id: 'appearance', label: 'Внешний вид', icon: 'sun' },
    { id: 'general', label: 'Основные', icon: 'settings' },
    { id: 'shortcuts', label: 'Горячие клавиши', icon: 'bolt' },
  ];

  function Settings({ onClose, theme, setTheme, providers, setProviders, initialSection }) {
    const [section, setSection] = useState(initialSection || 'providers');
    const [selId, setSelId] = useState(providers.find(p => p.active)?.id || providers[0].id);
    const sel = providers.find(p => p.id === selId);

    const setActive = (id) => setProviders(providers.map(p => ({ ...p, active: p.id === id, connected: p.id === id ? true : p.connected })));

    return React.createElement('div', { className: 'settings-overlay' },
      React.createElement('div', { className: 'settings-top' },
        React.createElement('button', { className: 'icon-btn', onClick: onClose }, React.createElement(Icon, { name: 'arrowR', size: 17, style: { transform: 'rotate(180deg)' } })),
        React.createElement('h2', null, 'Настройки'),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement('span', { className: 'kbd' }, 'Esc')),
      React.createElement('div', { className: 'settings-body' },
        React.createElement('div', { className: 'settings-nav' },
          SNAV.map(s => React.createElement('div', { key: s.id, className: 'snav-item' + (section === s.id ? ' on' : ''), onClick: () => setSection(s.id) },
            React.createElement(Icon, { name: s.icon, size: 16 }), s.label))),

        React.createElement('div', { className: 'settings-content' }, React.createElement('div', { className: 'inner' },
          section === 'providers' && React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'set-h' }, 'AI-провайдеры'),
            React.createElement('div', { className: 'set-sub' }, 'Подключите один или несколько LLM-провайдеров. Ассистент работает через активного — переключайтесь в любой момент.'),
            React.createElement('div', { className: 'prov-grid' },
              providers.map(p => React.createElement(ProviderCard, { key: p.id, p, selected: p.id === selId, onClick: () => setSelId(p.id) }))),
            sel && React.createElement(ProviderDetail, { p: sel, onSetActive: setActive, providers })),

          section === 'appearance' && React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'set-h' }, 'Внешний вид'),
            React.createElement('div', { className: 'set-sub' }, 'Тема и плотность интерфейса.'),
            React.createElement('div', { className: 'set-group-label' }, 'Тема'),
            React.createElement('div', { className: 'theme-swatch-row' },
              [{ id: 'dark', label: 'Тёмная', bg: ['#1a1b1f', '#26272d'] }, { id: 'light', label: 'Светлая', bg: ['#f7f7f8', '#ffffff'] }].map(t =>
                React.createElement('div', { key: t.id, className: 'theme-swatch' + (theme === t.id ? ' on' : ''), onClick: () => setTheme(t.id) },
                  React.createElement('div', { className: 'prev' },
                    React.createElement('div', { style: { width: '38%', background: t.bg[0] } }),
                    React.createElement('div', { style: { flex: 1, background: t.bg[1], display: 'grid', placeItems: 'center' } },
                      React.createElement('div', { style: { width: 28, height: 6, borderRadius: 3, background: 'oklch(0.62 0.19 264)' } }))),
                  React.createElement('div', { className: 'lab' }, t.label,
                    theme === t.id && React.createElement(Icon, { name: 'check', size: 13, style: { color: 'var(--accent)', float: 'right' } }))))),
            React.createElement('div', { className: 'set-group-label' }, 'Акцентный цвет'),
            React.createElement('div', { style: { display: 'flex', gap: 10 } },
              [264, 158, 25, 305, 200].map((h, i) => React.createElement('div', { key: h, onClick: () => document.documentElement.style.setProperty('--accent', `oklch(0.62 0.19 ${h})`),
                style: { width: 30, height: 30, borderRadius: 9, cursor: 'pointer', background: `oklch(0.62 0.19 ${h})`, boxShadow: i === 0 ? '0 0 0 2px var(--bg-0), 0 0 0 4px oklch(0.62 0.19 264)' : 'inset 0 1px 0 oklch(1 0 0 / 0.2)' } })))),

          section === 'general' && React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'set-h' }, 'Основные'),
            React.createElement('div', { className: 'set-sub' }, 'Поведение запросов и рабочей области.'),
            React.createElement(SettingsToggles, null)),

          section === 'shortcuts' && React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'set-h' }, 'Горячие клавиши'),
            React.createElement('div', { className: 'set-sub' }, 'Основные сочетания клавиш Relay.'),
            React.createElement(Shortcuts, null))
        )))
    );
  }

  function SettingsToggles() {
    const rows = [
      { t: 'Автосохранение запросов', d: 'Сохранять изменения в коллекции автоматически', on: true },
      { t: 'Следовать редиректам', d: 'Автоматически переходить по 3xx-ответам', on: true },
      { t: 'Проверять SSL-сертификаты', d: 'Отклонять небезопасные соединения', on: true },
      { t: 'Переносить длинные строки', d: 'Word wrap в просмотрщике ответа', on: false },
      { t: 'Отправлять контекст в AI', d: 'Прикреплять текущий запрос и ответ к диалогу', on: true },
    ];
    const [state, setState] = useState(rows.map(r => r.on));
    return React.createElement('div', null,
      rows.map((r, i) => React.createElement('div', { key: i, className: 'set-row' },
        React.createElement('div', { className: 'label' }, React.createElement('div', { className: 't' }, r.t), React.createElement('div', { className: 'd' }, r.d)),
        React.createElement('div', { className: 'toggle' + (state[i] ? ' on' : ''), onClick: () => setState(s => s.map((v, j) => j === i ? !v : v)) }))));
  }

  function Shortcuts() {
    const list = [
      ['Командная палитра', ['⌘', 'K']], ['Отправить запрос', ['⌘', '↵']], ['Новый запрос', ['⌘', 'N']],
      ['Открыть/скрыть AI', ['⌘', 'J']], ['Настройки', ['⌘', ',']], ['Поиск в ответе', ['⌘', 'F']],
      ['Закрыть вкладку', ['⌘', 'W']], ['Сохранить', ['⌘', 'S']],
    ];
    return React.createElement('div', null, list.map(([label, keys], i) =>
      React.createElement('div', { key: i, className: 'set-row' },
        React.createElement('div', { className: 'label' }, React.createElement('div', { className: 't' }, label)),
        React.createElement('div', { style: { display: 'flex', gap: 4 } }, keys.map((k, j) => React.createElement('span', { key: j, className: 'kbd' }, k))))));
  }

  window.Settings = Settings;
})();

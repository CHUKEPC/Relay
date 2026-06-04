/* AI assistant panel */
(function () {
  const { useState, useRef, useEffect } = React;
  const Icon = window.Icon;

  // rich text mini-renderer: **bold**, `code`, and \n
  function RichText({ text }) {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, i) => {
      if (/^\*\*.*\*\*$/.test(p)) return React.createElement('strong', { key: i }, p.slice(2, -2));
      if (/^`.*`$/.test(p)) return React.createElement('code', { key: i }, p.slice(1, -1));
      return React.createElement('span', { key: i }, p);
    });
  }

  function Bubble({ children }) { return React.createElement('div', { className: 'bubble' }, children); }

  function CodeBlock({ lang, code }) {
    const [copied, setCopied] = useState(false);
    return React.createElement('div', { className: 'ai-code' },
      React.createElement('div', { className: 'ai-code-head' },
        React.createElement('span', { className: 'lang' }, lang),
        React.createElement('button', { className: 'icon-btn', style: { width: 24, height: 22 }, onClick: () => { setCopied(true); setTimeout(() => setCopied(false), 1200); } },
          React.createElement(Icon, { name: copied ? 'check' : 'copy', size: 13 }))),
      React.createElement('pre', null, React.createElement(window.Hl, { text: code })));
  }

  function AiMsg({ children }) {
    return React.createElement('div', { className: 'msg ai' },
      React.createElement('div', { className: 'who' },
        React.createElement('span', { className: 'glyph', style: { background: 'oklch(0.62 0.19 264)', width: 14, height: 14, borderRadius: 4, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 9, fontWeight: 700 } }, '✦'),
        'Relay AI'),
      children);
  }
  function UserMsg({ children, ctx }) {
    return React.createElement('div', { className: 'msg user' },
      ctx && React.createElement('div', { className: 'ctx-card' },
        React.createElement('span', { className: 'ci' }, React.createElement(Icon, { name: ctx.icon, size: 13 })),
        React.createElement('span', { className: 'ct mono' }, ctx.label)),
      React.createElement('div', { className: 'bubble' }, children));
  }

  // Scripted demo conversation
  const SUGGESTIONS = [
    { icon: 'info', text: 'Объясни этот ответ' },
    { icon: 'warn', text: 'Диагностировать ошибку' },
    { icon: 'code2', text: 'Сгенерировать curl' },
    { icon: 'check', text: 'Написать тесты' },
    { icon: 'doc', text: 'Сделать документацию' },
  ];

  function AiPanel({ onClose, onPickModel, activeProvider }) {
    const [thread, setThread] = useState([
      { role: 'ai', kind: 'intro' },
    ]);
    const [input, setInput] = useState('');
    const [typing, setTyping] = useState(false);
    const [ctxOn, setCtxOn] = useState(true);
    const threadRef = useRef(null);

    useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [thread, typing]);

    // pre-seed an example exchange so the panel "in action" reads well
    useEffect(() => {
      const t = setTimeout(() => {
        setThread([
          { role: 'ai', kind: 'intro' },
          { role: 'user', kind: 'explain', ctx: { icon: 'doc', label: 'GET /v1/products · 200 OK' } },
          { role: 'ai', kind: 'explain-answer' },
        ]);
      }, 350);
      return () => clearTimeout(t);
    }, []);

    function pushUser(label, ctx, replyKind) {
      setThread(prev => [...prev, { role: 'user', text: label, ctx }]);
      setTyping(true);
      setTimeout(() => {
        setTyping(false);
        setThread(prev => [...prev, { role: 'ai', kind: replyKind || 'generic', text: label }]);
      }, 1100);
    }

    function handleSuggest(s) {
      const map = {
        'Сгенерировать curl': { reply: 'curl', ctx: { icon: 'doc', label: 'GET /v1/products' } },
        'Диагностировать ошибку': { reply: 'diagnose', ctx: { icon: 'warn', label: 'POST /v1/orders · 500' } },
        'Написать тесты': { reply: 'tests', ctx: { icon: 'doc', label: 'GET /v1/products · 200' } },
        'Объясни этот ответ': { reply: 'explain-answer', ctx: { icon: 'doc', label: 'GET /v1/products · 200 OK' } },
        'Сделать документацию': { reply: 'docs', ctx: { icon: 'doc', label: 'GET /v1/products' } },
      };
      const m = map[s.text] || { reply: 'generic' };
      pushUser(s.text, m.ctx, m.reply);
    }

    function send() {
      if (!input.trim()) return;
      const text = input.trim();
      setInput('');
      // route a couple of natural-language intents for the demo
      let reply = 'generic';
      if (/curl/i.test(text)) reply = 'curl';
      else if (/тест|test/i.test(text)) reply = 'tests';
      else if (/created|создан|post|создай|запрос/i.test(text)) reply = 'generate-req';
      pushUser(text, ctxOn ? { icon: 'doc', label: 'GET /v1/products · 200 OK' } : null, reply);
    }

    return React.createElement('aside', { className: 'ai-panel' },
      React.createElement('div', { className: 'ai-head' },
        React.createElement('div', { className: 'ai-title' },
          React.createElement('span', { className: 'ai-spark' }, React.createElement(Icon, { name: 'sparkle', size: 14 })),
          'AI-ассистент'),
        React.createElement('button', { className: 'ai-model-pill', onClick: onPickModel },
          React.createElement('span', { className: 'glyph', style: { background: `oklch(0.62 0.17 ${activeProvider.hue})` } }, activeProvider.glyph),
          activeProvider.model,
          React.createElement(Icon, { name: 'chevDsm', size: 12, style: { color: 'var(--tx-3)' } })),
        React.createElement('button', { className: 'icon-btn', onClick: onClose, title: 'Скрыть панель' }, React.createElement(Icon, { name: 'close', size: 15 }))),

      React.createElement('div', { className: 'ai-thread', ref: threadRef },
        thread.map((m, i) => React.createElement(MsgRenderer, { key: i, m, onSuggest: handleSuggest })),
        typing && React.createElement(AiMsg, null, React.createElement('div', { className: 'bubble', style: { padding: 4 } }, React.createElement('div', { className: 'typing' }, React.createElement('i'), React.createElement('i'), React.createElement('i'))))),

      React.createElement('div', { className: 'ai-composer' },
        React.createElement('div', { className: 'composer-box' },
          React.createElement('textarea', {
            placeholder: 'Спросите про запрос, ошибку или API…', value: input, rows: 1,
            onChange: e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; },
            onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
          }),
          React.createElement('div', { className: 'composer-foot' },
            React.createElement('button', { className: 'ctxbtn' + (ctxOn ? ' on' : ''), onClick: () => setCtxOn(o => !o) },
              React.createElement(Icon, { name: 'link', size: 13 }), 'Контекст запроса'),
            React.createElement('div', { className: 'grow' }),
            React.createElement('button', { className: 'send-msg', disabled: !input.trim(), onClick: send },
              React.createElement(Icon, { name: 'send', size: 14 })))))
    );
  }

  function MsgRenderer({ m, onSuggest }) {
    if (m.role === 'user') {
      return React.createElement(UserMsg, { ctx: m.ctx }, m.text || (m.kind === 'explain' ? 'Объясни этот ответ' : ''));
    }
    // AI messages by kind
    if (m.kind === 'intro') {
      return React.createElement(AiMsg, null,
        React.createElement(Bubble, null,
          React.createElement('p', null, React.createElement(RichText, { text: 'Привет! Я подключён к текущему запросу и ответу. Могу **объяснить ответ**, **сгенерировать запрос** из описания, разобрать ошибку, написать тесты или собрать `curl`.' }))),
        React.createElement('div', { className: 'ai-suggest' },
          SUGGESTIONS.map((s, i) => React.createElement('button', { key: i, className: 'sug-chip', onClick: () => onSuggest(s) },
            React.createElement(Icon, { name: s.icon, size: 13 }), s.text))));
    }
    if (m.kind === 'explain-answer') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, React.createElement(RichText, { text: 'Ответ — **постраничный список** товаров. Ключевые поля:' })),
        React.createElement('ul', null,
          React.createElement('li', null, React.createElement(RichText, { text: '`total: 248` — всего товаров; вернулось 2 из них.' })),
          React.createElement('li', null, React.createElement(RichText, { text: '`has_more: true` — есть следующая страница.' })),
          React.createElement('li', null, React.createElement(RichText, { text: '`next_cursor` — передайте в параметре `cursor`, чтобы догрузить.' }))),
        React.createElement('p', null, React.createElement(RichText, { text: 'Лимит запросов в норме: осталось **4998 / 5000**.' }))));
    }
    if (m.kind === 'curl') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, 'Готовый curl для этого запроса:'),
        React.createElement(CodeBlock, { lang: 'bash', code: 'curl -X GET "https://api.acme.com/v1/products?limit=20&category=audio" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Accept: application/json"' })));
    }
    if (m.kind === 'diagnose') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, React.createElement(RichText, { text: '**500 Internal Server Error** обычно на стороне сервера. По телу запроса вижу вероятную причину:' })),
        React.createElement('ul', null,
          React.createElement('li', null, React.createElement(RichText, { text: 'Поле `amount` отправлено строкой `"42.00"`, а API ждёт число.' })),
          React.createElement('li', null, React.createElement(RichText, { text: 'Отсутствует заголовок `Idempotency-Key` — рекомендован для создания заказов.' }))),
        React.createElement('p', null, 'Поправить тело запроса автоматически?'),
        React.createElement('div', { className: 'ai-suggest' },
          React.createElement('button', { className: 'sug-chip' }, React.createElement(Icon, { name: 'bolt', size: 13 }), 'Исправить тело запроса'))));
    }
    if (m.kind === 'tests') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, 'Базовые тесты на ответ:'),
        React.createElement(CodeBlock, { lang: 'javascript', code: 'pm.test("status is 200", () => {\n  pm.response.to.have.status(200);\n});\npm.test("has data array", () => {\n  const b = pm.response.json();\n  pm.expect(b.data).to.be.an("array");\n});\npm.test("response < 300ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(300);\n});' })));
    }
    if (m.kind === 'docs') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, React.createElement(RichText, { text: '**GET /v1/products** — список товаров с пагинацией.' })),
        React.createElement('ul', null,
          React.createElement('li', null, React.createElement(RichText, { text: '`limit` (int, ≤100) — размер страницы.' })),
          React.createElement('li', null, React.createElement(RichText, { text: '`category` (string) — фильтр по категории.' })),
          React.createElement('li', null, React.createElement(RichText, { text: '`cursor` (string) — курсор следующей страницы.' }))),
        React.createElement('p', null, 'Сгенерировать полный Markdown для всей коллекции?')));
    }
    if (m.kind === 'generate-req') {
      return React.createElement(AiMsg, null, React.createElement(Bubble, null,
        React.createElement('p', null, React.createElement(RichText, { text: 'Собрал запрос из описания. Создать новый запрос в коллекции?' })),
        React.createElement(CodeBlock, { lang: 'http', code: 'POST {{base_url}}/v1/products\nContent-Type: application/json\n\n{\n  "name": "New product",\n  "category": "audio",\n  "price": 0\n}' }),
        React.createElement('div', { className: 'ai-suggest' },
          React.createElement('button', { className: 'sug-chip' }, React.createElement(Icon, { name: 'plus', size: 13 }), 'Создать запрос'))));
    }
    // generic
    return React.createElement(AiMsg, null, React.createElement(Bubble, null,
      React.createElement('p', null, React.createElement(RichText, { text: 'Понял. Опираясь на текущий запрос и ответ, вот что я предлагаю: проверьте заголовки авторизации и параметры пагинации. Что именно нужно — `curl`, тесты или объяснение полей?' }))));
  }

  // Empty / not-connected state for AI
  function AiPanelEmpty({ onClose, onConnect }) {
    return React.createElement('aside', { className: 'ai-panel' },
      React.createElement('div', { className: 'ai-head' },
        React.createElement('div', { className: 'ai-title' },
          React.createElement('span', { className: 'ai-spark' }, React.createElement(Icon, { name: 'sparkle', size: 14 })), 'AI-ассистент'),
        React.createElement('button', { className: 'icon-btn', onClick: onClose }, React.createElement(Icon, { name: 'close', size: 15 }))),
      React.createElement('div', { className: 'empty', style: { flex: 1 } },
        React.createElement('div', { className: 'empty-card' },
          React.createElement('div', { className: 'empty-ico', style: { color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'transparent' } },
            React.createElement(Icon, { name: 'sparkle', size: 24 })),
          React.createElement('h3', null, 'Подключите AI-провайдера'),
          React.createElement('p', null, 'Выберите OpenAI, Anthropic, OpenRouter или другого провайдера и добавьте ключ — ассистент заработает прямо здесь.'),
          React.createElement('div', { className: 'empty-actions' },
            React.createElement('button', { className: 'btn primary', onClick: onConnect }, React.createElement(Icon, { name: 'bolt', size: 14 }), 'Подключить провайдера')))));
  }

  window.AiPanel = AiPanel;
  window.AiPanelEmpty = AiPanelEmpty;
})();

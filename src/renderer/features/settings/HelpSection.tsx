import type { ReactNode } from 'react'
import { FEEDBACK_EMAIL } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { Kbd } from '@renderer/components/primitives'
import { MOD } from '@renderer/lib/platform'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { KEY_ACTIONS, formatCombo } from '@renderer/lib/keymap'
import { startTour } from '@renderer/features/onboarding/Tour'

import { tr, trf } from '@renderer/lib/i18n'
type TopicId =
  | 'quickstart'
  | 'collections'
  | 'variables'
  | 'scripts'
  | 'import-export'
  | 'ai'
  | 'runner'
  | 'shortcuts'
  | 'faq'

const TOPICS: { id: TopicId; label: string }[] = [
  { id: 'quickstart', label: 'Быстрый старт' },
  { id: 'collections', label: 'Коллекции и папки' },
  { id: 'variables', label: 'Переменные и окружения' },
  { id: 'scripts', label: 'Скрипты и тесты' },
  { id: 'import-export', label: 'Импорт и экспорт' },
  { id: 'ai', label: 'AI-ассистент' },
  { id: 'runner', label: 'Раннер и поиск' },
  { id: 'shortcuts', label: 'Горячие клавиши' },
  { id: 'faq', label: 'FAQ' }
]

function Card({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="help-card">
      {title && <h4>{title}</h4>}
      {children}
    </div>
  )
}

function FaqItem({ q, children }: { q: string; children: ReactNode }): JSX.Element {
  return (
    <details className="faq-item">
      <summary>
        <span className="faq-chev">
          <Icon name="chevR" size={13} />
        </span>
        {q}
      </summary>
      <div className="faq-a">{children}</div>
    </details>
  )
}

function QuickstartTopic(): JSX.Element {
  return (
    <>
      <button
        className="btn ghost tour-restart-help"
        onClick={() => {
          // The tour spotlights the main window — close settings first.
          useUi.getState().closeSettings()
          setTimeout(startTour, 250)
        }}
      >
        <Icon name="refresh" size={14} /> {tr('Показать тур по интерфейсу')} </button>
      <div className="help-topic-title">{tr('Быстрый старт')}</div>
      <Card title={tr('Первый запрос')}>
        <ul>
          <li> {tr('Создайте вкладку:')} <Kbd>{MOD}</Kbd> <Kbd>N</Kbd> {tr('или кнопка «+» на панели вкладок.')} </li>
          <li>{tr('Выберите метод, введите URL — например,')} <code>https://httpbin.org/get</code>.</li>
          <li>{tr('Параметры, заголовки и тело настраиваются на вкладках Params, Headers и Body.')}</li>
          <li> {tr('Нажмите «Отправить» или')} <Kbd>{MOD}</Kbd> <Kbd>↵</Kbd>.
          </li>
        </ul>
      </Card>
      <Card title={tr('Ответ')}>
        <p> {tr('Ниже появятся статус, время и размер ответа. Тело можно смотреть в режимах Pretty, Raw и Preview, а заголовки и cookies — на соседних вкладках. Поиск по ответу —')} <Kbd>{MOD}</Kbd>{' '}
          <Kbd>F</Kbd>.
        </p>
      </Card>
      <Card title={tr('Сохранение')}>
        <p>
          <Kbd>{MOD}</Kbd> <Kbd>S</Kbd> {tr('сохраняет запрос в коллекцию. Все отправленные запросы также автоматически попадают в Историю в боковой панели.')} </p>
      </Card>
    </>
  )
}

function CollectionsTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('Коллекции и папки')}</div>
      <Card title={tr('Создание и организация')}>
        <p> {tr('Коллекция создаётся кнопкой «+» в боковой панели. Правый клик по коллекции или папке открывает контекстное меню: «Новый запрос», «Новая папка», «Переименовать», «Дублировать», «Удалить». Вложенность папок не ограничена.')} </p>
      </Card>
      <Card title={tr('Перетаскивание')}>
        <p> {tr('Запросы и папки можно перетаскивать мышью: меняйте порядок или бросайте элемент на папку, чтобы переместить его внутрь.')} </p>
      </Card>
      <Card title={tr('Экспорт')}>
        <p> {tr('Коллекция целиком экспортируется в JSON формата Postman v2.1 через контекстное меню. Папки и отдельные запросы тоже экспортируются в JSON — удобно, чтобы поделиться парой запросов, не отдавая всю коллекцию.')} </p>
      </Card>
      <Card title={tr('Запуск')}>
        <p> {tr('Пункт «Запустить» в контекстном меню открывает раннер уже с этой коллекцией или папкой. Кнопка «Раннер» в боковой панели открывает его пустым, чтобы отметить произвольный набор запросов из разных коллекций.')} </p>
      </Card>
    </>
  )
}

function VariablesTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('Переменные и окружения')}</div>
      <Card title={tr('Синтаксис')}>
        <p> {tr('Пишите')} <code>{'{{baseUrl}}'}</code> {tr('в URL, параметрах, заголовках, теле и скриптах — значение подставится перед отправкой. Неразрешённые переменные подсвечиваются.')} </p>
      </Card>
      <Card title={tr('Области видимости')}>
        <p>{tr('При совпадении имён действует приоритет (от высшего к низшему):')}</p>
        <ul>
          <li>{tr('локальные — заданы скриптом на время запроса;')}</li>
          <li>{tr('переменные коллекции;')}</li>
          <li>{tr('активное окружение (вкладка «Окружения» в боковой панели);')}</li>
          <li>{tr('глобальные — видны везде.')}</li>
        </ul>
      </Card>
      <Card title={tr('Секретные значения')}>
        <p> {tr('У переменной можно включить флажок «Секретное значение» — оно маскируется в редакторе и показывается только по кнопке-глазу.')} </p>
      </Card>
      <Card title={tr('Динамические переменные')}>
        <p> {tr('Значения вида')} <code>{'{{$guid}}'}</code>, <code>{'{{$timestamp}}'}</code>,{' '}
          <code>{'{{$randomEmail}}'}</code> {tr('генерируются заново при каждой отправке.')} </p>
      </Card>
    </>
  )
}

function ScriptsTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('Скрипты и тесты')}</div>
      <Card title={tr('Pre-request и Tests')}>
        <p> {tr('На вкладке Scripts у запроса два редактора: pre-request выполняется перед отправкой (подготовить токен, выставить переменную), tests — после получения ответа (проверки).')} </p>
      </Card>
      <Card title="pm.* API">
        <ul>
          <li>
            <code>pm.test(name, fn)</code> {tr('и')} <code>pm.expect(...)</code> {tr('— проверки;')}
          </li>
          <li>
            <code>pm.response</code> {tr('— статус, заголовки,')} <code>pm.response.json()</code>;
          </li>
          <li>
            <code>pm.environment</code>, <code>pm.globals</code>, <code>pm.variables</code> — <code>get</code>/<code>set</code>{' '}
            {tr('переменных;')}
          </li>
          <li>
            <code>pm.request</code> {tr('— данные текущего запроса.')} </li>
        </ul>
      </Card>
      <Card title={tr('Сниппеты')}>
        <p> {tr('Панель «Сниппеты» справа от редактора вставляет готовые проверки: код ответа, время ответа, значения JSON, заголовки. Результаты тестов видны в панели ответа.')} </p>
      </Card>
    </>
  )
}

function ImportExportTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('Импорт и экспорт')}</div>
      <Card title={tr('Импорт')}>
        <p> {tr('Диалог «Импорт» принимает файл или вставленный текст. Поддерживаемые форматы: Postman v2.1, OpenAPI 3, Swagger 2.0, cURL, HAR, Insomnia. Режим «Авто» определяет формат сам.')} </p>
      </Card>
      <Card title={tr('Экспорт')}>
        <p> {tr('Коллекции экспортируются в JSON формата Postman v2.1 — файл открывается в Postman и других клиентах. Папки и отдельные запросы экспортируются так же, через контекстное меню.')} </p>
      </Card>
      <Card title={tr('Резервная копия SQLite')}>
        <p> {tr('В «Настройки → Данные» весь рабочий набор (коллекции, окружения, история) выгружается в один файл')} <code>.sqlite</code> {tr('и импортируется обратно. Основное хранилище приложения остаётся JSON.')} </p>
      </Card>
    </>
  )
}

function AiTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('AI-ассистент')}</div>
      <Card title={tr('Как подключить')}>
        <ul>
          <li>{tr('Откройте «Настройки → AI-провайдеры» и нажмите «Добавить провайдера».')}</li>
          <li>{tr('Выберите сервис из списка, вставьте API-ключ и нажмите «Подключить».')}</li>
          <li> {tr('Первый подключённый провайдер становится активным. Если провайдеров несколько, переключайтесь кнопкой «Сделать активным» или выбором модели в панели ассистента.')} </li>
        </ul>
        <p style={{ marginTop: 8 }}> {tr('Ключ шифруется системным хранилищем (Keychain / DPAPI / libsecret) и отправляется только выбранному провайдеру.')} </p>
      </Card>
      <Card title={tr('Какие ИИ можно подключить')}>
        <ul>
          <li>
            <b>Anthropic (Claude)</b> {tr('— ключ в')} <code>console.anthropic.com</code> → Settings → API Keys.
          </li>
          <li>
            <b>OpenAI (GPT)</b> {tr('— ключ в')} <code>platform.openai.com</code> {tr('→ API keys. Подписка ChatGPT Plus для API не подходит, нужен баланс в Platform.')} </li>
          <li>
            <b>OpenRouter</b> {tr('— один ключ (')}<code>openrouter.ai/keys</code>{tr(') даёт доступ к моделям Google Gemini, Meta Llama, DeepSeek, Mistral, Qwen, xAI Grok, а также Claude и GPT.')} </li>
          <li>
            <b>Ollama</b> {tr('— локальные модели без интернета и ключа. Base URL')} <code>http://localhost:11434/v1</code>
            {tr(', модель сначала скачайте командой')} <code>ollama pull llama3.1</code>.
          </li>
          <li>
            <b>LM Studio</b> {tr('— локальные модели. Включите сервер во вкладке Developer, Base URL')} <code>http://localhost:1234/v1</code>.
          </li>
          <li>
            <b>{tr('Другой OpenAI-совместимый')}</b> {tr('— любой сервер с эндпоинтом')} <code>/v1/chat/completions</code>{tr(': Groq, Together, DeepSeek, Mistral, vLLM, LocalAI, корпоративный шлюз. Укажите его Base URL и ключ, если он нужен.')} </li>
        </ul>
      </Card>
      <Card title={tr('Откуда берётся список моделей')}>
        <p>
          {tr('После подключения Relay запрашивает у провайдера список доступных моделей (эндпоинт')} <code>/models</code>{tr(') — показываются все модели, доступные вашему ключу. Список обновляется кнопкой «Обновить» в выборе модели. Если провайдер не отдаёт список, впишите название модели вручную в поле поиска и нажмите «Использовать».')} </p>
      </Card>
      <Card title={tr('Контекст запроса')}>
        <p> {tr('Ассистент открывается по')} <Kbd>{MOD}</Kbd> <Kbd>J</Kbd>{tr('. Если в «Настройки → Основные» включено «Отправлять контекст в AI», он видит текущий запрос и ответ — может объяснить ошибку, написать тест или поправить запрос. Предложенные изменения применяются вручную или автоматически (отдельная настройка).')} </p>
      </Card>
    </>
  )
}

function RunnerTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">{tr('Раннер и поиск')}</div>
      <Card title={tr('Раннер коллекций')}>
        <p>
          {tr('Кнопка «Раннер» в боковой панели или')} <Kbd>{MOD}</Kbd> <Kbd>Shift</Kbd> <Kbd>R</Kbd>{' '}
          {tr('открывают прогон. Сверху выбирается коллекция или папка, ниже — список запросов: галочками отмечается, что именно выполнять, стрелками меняется порядок. «Запустить» из контекстного меню коллекции сразу подставляет её в этот список.')}
        </p>
      </Card>
      <Card title={tr('Итерации и данные')}>
        <p> {tr('«Итераций» повторяет весь набор нужное число раз, «Задержка» выдерживает паузу между запросами, а файл CSV или JSON подставляет по строке на итерацию — колонки доступны как переменные и в pm.iterationData. «Стоп при ошибке» прерывает прогон на первом упавшем запросе или тесте.')} </p>
      </Card>
      <Card title={tr('Результаты')}>
        <p> {tr('По каждому запросу видно статус, время и число пройденных тестов; итог — сверху. Кнопка «Отчёт» сохраняет прогон в JSON, который можно приложить к баг-репорту.')} </p>
      </Card>
      <Card title={tr('Поиск и замена')}>
        <p>
          <Kbd>{MOD}</Kbd> <Kbd>Shift</Kbd> <Kbd>F</Kbd>{' '}
          {tr('ищет сразу по всем коллекциям, окружениям и глобальным переменным: по названиям, URL, параметрам, заголовкам, телу, авторизации, скриптам и описаниям. Область поиска сужается чипами, а Aa, ab и .* включают регистр, слово целиком и регулярные выражения.')}
        </p>
        <p> {tr('Найденное показывается списком с контекстом; галочки решают, что заменить, — поэтому массовую замену вроде смены домена можно применить только там, где нужно. Значения секретных переменных в поиск не попадают.')} </p>
      </Card>
    </>
  )
}

function ShortcutsTopic(): JSX.Element {
  const keybindings = useSettings((st) => st.settings.keybindings)
  // Both lists are generated from the one shortcut table, so a shortcut that is
  // added or rebound can never leave the help text behind.
  const rowsOf = (group: 'general' | 'panes') =>
    KEY_ACTIONS.filter((a) => a.group === group).map((a) => {
      const custom = keybindings[a.id]
      const combo = custom !== undefined ? custom : a.defaultCombo
      return { id: a.id, label: a.label, keys: combo ? formatCombo(combo) : [] }
    })
  const rows = rowsOf('general')
  const paneRows = rowsOf('panes')
  return (
    <>
      <div className="help-topic-title">{tr('Горячие клавиши')}</div>
      <Card title={tr('Основные сочетания')}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--tx-1)' }}>{tr(r.label)}</span>
            {r.keys.length ? r.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>) : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>{tr('не назначено')}</span>}
          </div>
        ))}
      </Card>
      <Card title={tr('Панели')}>
        <p> {tr('Экран делится на панели как в Terminator: у каждой свой запрос, свои размеры и заголовок — его можно перетащить на другую панель, чтобы поменять их местами. Любую панель можно открыть в отдельном окне и переключаться между окнами через Alt+Tab.')} </p>
        {paneRows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--tx-1)' }}>{tr(r.label)}</span>
            {r.keys.length ? r.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>) : <span style={{ color: 'var(--tx-3)', fontSize: 12 }}>{tr('не назначено')}</span>}
          </div>
        ))}
      </Card>
      <Card>
        <p>
          {tr('Полный список — в разделе «Горячие клавиши» настроек; там же сочетания можно переназначить под себя.')} <Kbd>{MOD}</Kbd>{' '}
          <Kbd>Z</Kbd> {tr('отменяет последнее изменение в поле запроса, а вне полей — последнее изменение во вкладке.')}
        </p>
      </Card>
    </>
  )
}

function FaqTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">FAQ</div>
      <FaqItem q={tr('Как отправить первый запрос?')}>
        {trf('Создайте вкладку ({mod}+N), вставьте URL — например', { mod: MOD })} <code>https://httpbin.org/get</code>{' '}
        {trf('— и нажмите «Отправить» ({mod}+↵). Статус, заголовки и тело ответа появятся в панели ниже.', { mod: MOD })}
      </FaqItem>
      <FaqItem q={tr('Как поделиться парой запросов с коллегой?')}> {tr('Правый клик по запросу или папке в дереве коллекций → экспорт в JSON. Коллега импортирует файл через диалог «Импорт» (формат Postman v2.1) — в Relay или даже в самом Postman.')} </FaqItem>
      <FaqItem q={tr('Как подключить локальную модель (Ollama / LM Studio)?')}> {tr('«Настройки → AI-провайдеры» → «Добавить провайдера» → Ollama или LM Studio. Адрес подставится сам (')}<code>http://localhost:11434/v1</code> {tr('или')}{' '}
        <code>http://localhost:1234/v1</code>{tr('), ключ не нужен — нажмите «Подключить без ключа».')} </FaqItem>
      <FaqItem q={tr('Где хранятся мои данные?')}> {tr('Локально, в папке данных приложения (userData), в JSON-файлах. Ничего не отправляется в облако и не требует аккаунта. API-ключи шифруются системным хранилищем (Keychain / DPAPI / libsecret).')} </FaqItem>
      <FaqItem q={tr('Как включить тему в стиле Postman или Insomnia?')}> {tr('«Настройки → Внешний вид»: выберите соответствующий пресет темы. Светлый/тёмный режим и акцентный цвет настраиваются отдельно.')} </FaqItem>
      <FaqItem q={tr('Как узнать о новых версиях?')}> {tr('В разделе «О приложении» включите проверку обновлений — приложение сверяет свою версию с релизами на GitHub и сообщает, когда вышла новая.')} </FaqItem>
      <FaqItem q={tr('Почему запрос работает здесь, но падает в браузере?')}> {tr('Relay отправляет запросы из основного процесса Electron, без браузерных ограничений CORS. Если браузер блокирует запрос, а Relay — нет, проверьте CORS-заголовки на сервере.')} </FaqItem>
      <FaqItem q={tr('Как отключить проверку SSL-сертификатов?')}>
        {tr('«Настройки → Основные» → выключите «Проверять SSL-сертификаты». Пригодится для localhost с самоподписанным сертификатом; для боевых серверов проверку лучше не отключать.')}
      </FaqItem>
      <FaqItem q={tr('Как сделать резервную копию всех данных?')}> {tr('«Настройки → Данные» → «Резервная копия (SQLite)»: экспорт коллекций, окружений и истории в один файл')} <code>.sqlite</code> {tr('и обратный импорт на любом компьютере.')} </FaqItem>
      <FaqItem q={tr('Ошибка «self signed certificate in certificate chain» — что делать?')}>
        {tr('Сертификат сервера подписан корнем, которого нет в списке доверенных. Причин две: это ваш собственный или внутренний сертификат, либо HTTPS перехватывает антивирус или корпоративный прокси — они подписывают трафик своим корнем, который установлен в системе, а движок запросов доверяет своему списку. Правильное решение — «Настройки → Сеть» → указать этот корневой сертификат (.pem): публичные сайты при этом продолжат проверяться. Для своего dev-сервера можно проще: «Настройки → Основные» → выключить «Проверять SSL-сертификаты». Обе настройки действуют и на pm.sendRequest в скриптах.')}
      </FaqItem>
      <FaqItem q={tr('Как получить токен в pre-request скрипте?')}>
        {tr('Через pm.sendRequest с колбэком — песочница выполняет обычный скрипт, поэтому await на верхнем уровне в ней не работает: pm.sendRequest({ url, method: "POST", body }, function (err, r) { pm.environment.set("token", r.json().access_token) }). Запрос уходит через тот же движок, что и обычная отправка, то есть с вашими настройками TLS, CA, прокси и клиентских сертификатов, и ждёт ответа в пределах таймаута запроса.')}
      </FaqItem>
      <FaqItem q={tr('Как прогнать всю коллекцию разом?')}>
        {trf('Кнопка «Раннер» в боковой панели или {mod}+Shift+R: выберите коллекцию либо отметьте отдельные запросы, задайте число итераций и при желании файл CSV/JSON с данными. После прогона виден отчёт по каждому запросу и тесту, его можно сохранить в JSON.', { mod: MOD })}
      </FaqItem>
      <FaqItem q={tr('Как разом поменять домен во всех запросах?')}>
        {trf('{mod}+Shift+F — поиск и замена по всем коллекциям, окружениям и переменным. Найденное показывается списком: снимите галочки там, где менять не нужно, и нажмите «Заменить». Лучше же держать адрес в переменной окружения — тогда менять придётся одно значение.', { mod: MOD })}
      </FaqItem>
      <FaqItem q={tr('Не работает горячая клавиша — что проверить?')}>
        {tr('«Настройки → Горячие клавиши»: там видны все текущие сочетания, конфликты и кнопка «Сбросить все». Сочетание можно переназначить на любое со своим Ctrl, Alt или F-клавишей.')}
      </FaqItem>
      <FaqItem q={tr('Куда писать с предложениями и багами?')}> {tr('На')} <code>{FEEDBACK_EMAIL}</code>{tr('. В разделе «О приложении» есть почта, GitHub и Telegram автора — каждый с кнопкой «Написать» и копированием в буфер.')} </FaqItem>
    </>
  )
}

const TOPIC_CONTENT: Record<TopicId, () => JSX.Element> = {
  quickstart: QuickstartTopic,
  collections: CollectionsTopic,
  variables: VariablesTopic,
  scripts: ScriptsTopic,
  'import-export': ImportExportTopic,
  ai: AiTopic,
  runner: RunnerTopic,
  shortcuts: ShortcutsTopic,
  faq: FaqTopic
}

export function HelpSection(): JSX.Element {
  const stored = useUi((s) => s.helpTopic)
  const topic: TopicId = stored in TOPIC_CONTENT ? (stored as TopicId) : 'quickstart'
  const setTopic = (id: TopicId): void => useUi.setState({ helpTopic: id })
  const Content = TOPIC_CONTENT[topic]

  return (
    <>
      <div className="set-h">{tr('Справка')}</div>
      <div className="set-sub">{tr('Как устроен Relay: возможности и ответы на частые вопросы.')}</div>

      <div className="help-layout">
        <nav className="help-nav" aria-label={tr('Темы справки')}>
          {TOPICS.map((t) => (
            <button
              key={t.id}
              className={`help-nav-item${topic === t.id ? ' on' : ''}`}
              onClick={() => setTopic(t.id)}
              aria-current={topic === t.id}
            >
              {tr(t.label)}
            </button>
          ))}
        </nav>
        <div className="help-content">
          <Content />
        </div>
      </div>
    </>
  )
}

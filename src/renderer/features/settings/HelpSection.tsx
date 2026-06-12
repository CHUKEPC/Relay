import { useState } from 'react'
import type { ReactNode } from 'react'
import { FEEDBACK_EMAIL } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { Kbd } from '@renderer/components/primitives'
import { MOD } from '@renderer/lib/platform'
import { useUi } from '@renderer/store/ui'
import { startTour } from '@renderer/features/onboarding/Tour'

type TopicId =
  | 'quickstart'
  | 'collections'
  | 'variables'
  | 'scripts'
  | 'import-export'
  | 'ai'
  | 'shortcuts'
  | 'faq'

const TOPICS: { id: TopicId; label: string }[] = [
  { id: 'quickstart', label: 'Быстрый старт' },
  { id: 'collections', label: 'Коллекции и папки' },
  { id: 'variables', label: 'Переменные и окружения' },
  { id: 'scripts', label: 'Скрипты и тесты' },
  { id: 'import-export', label: 'Импорт и экспорт' },
  { id: 'ai', label: 'AI-ассистент' },
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
        <Icon name="refresh" size={14} /> Показать тур по интерфейсу
      </button>
      <div className="help-topic-title">Быстрый старт</div>
      <Card title="Первый запрос">
        <ul>
          <li>
            Создайте вкладку: <Kbd>{MOD}</Kbd> <Kbd>N</Kbd> или кнопка «+» на панели вкладок.
          </li>
          <li>Выберите метод, введите URL — например, <code>https://httpbin.org/get</code>.</li>
          <li>Параметры, заголовки и тело настраиваются на вкладках Params, Headers и Body.</li>
          <li>
            Нажмите «Отправить» или <Kbd>{MOD}</Kbd> <Kbd>↵</Kbd>.
          </li>
        </ul>
      </Card>
      <Card title="Ответ">
        <p>
          Ниже появятся статус, время и размер ответа. Тело можно смотреть в режимах Pretty, Raw и
          Preview, а заголовки и cookies — на соседних вкладках. Поиск по ответу — <Kbd>{MOD}</Kbd>{' '}
          <Kbd>F</Kbd>.
        </p>
      </Card>
      <Card title="Сохранение">
        <p>
          <Kbd>{MOD}</Kbd> <Kbd>S</Kbd> сохраняет запрос в коллекцию. Все отправленные запросы
          также автоматически попадают в Историю в боковой панели.
        </p>
      </Card>
    </>
  )
}

function CollectionsTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">Коллекции и папки</div>
      <Card title="Создание и организация">
        <p>
          Коллекция создаётся кнопкой «+» в боковой панели. Правый клик по коллекции или папке
          открывает контекстное меню: «Новый запрос», «Новая папка», «Переименовать»,
          «Дублировать», «Удалить». Вложенность папок не ограничена.
        </p>
      </Card>
      <Card title="Перетаскивание">
        <p>
          Запросы и папки можно перетаскивать мышью: меняйте порядок или бросайте элемент на папку,
          чтобы переместить его внутрь.
        </p>
      </Card>
      <Card title="Экспорт">
        <p>
          Коллекция целиком экспортируется в JSON формата Postman v2.1 через контекстное меню.
          Папки и отдельные запросы тоже экспортируются в JSON — удобно, чтобы поделиться парой
          запросов, не отдавая всю коллекцию.
        </p>
      </Card>
      <Card title="Запуск">
        <p>
          Пункт «Запустить» в контекстном меню открывает Runner: все запросы коллекции или папки
          выполняются по очереди, с тестами и итоговым отчётом.
        </p>
      </Card>
    </>
  )
}

function VariablesTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">Переменные и окружения</div>
      <Card title="Синтаксис">
        <p>
          Пишите <code>{'{{baseUrl}}'}</code> в URL, параметрах, заголовках, теле и скриптах —
          значение подставится перед отправкой. Неразрешённые переменные подсвечиваются.
        </p>
      </Card>
      <Card title="Области видимости">
        <p>При совпадении имён действует приоритет (от высшего к низшему):</p>
        <ul>
          <li>локальные — заданы скриптом на время запроса;</li>
          <li>переменные коллекции;</li>
          <li>активное окружение (вкладка «Окружения» в боковой панели);</li>
          <li>глобальные — видны везде.</li>
        </ul>
      </Card>
      <Card title="Секретные значения">
        <p>
          У переменной можно включить флажок «Секретное значение» — оно маскируется в редакторе и
          показывается только по кнопке-глазу.
        </p>
      </Card>
      <Card title="Динамические переменные">
        <p>
          Значения вида <code>{'{{$guid}}'}</code>, <code>{'{{$timestamp}}'}</code>,{' '}
          <code>{'{{$randomEmail}}'}</code> генерируются заново при каждой отправке — как в
          Postman.
        </p>
      </Card>
    </>
  )
}

function ScriptsTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">Скрипты и тесты</div>
      <Card title="Pre-request и Tests">
        <p>
          На вкладке Scripts у запроса два редактора: pre-request выполняется перед отправкой
          (подготовить токен, выставить переменную), tests — после получения ответа (проверки).
        </p>
      </Card>
      <Card title="pm.* API">
        <ul>
          <li>
            <code>pm.test(name, fn)</code> и <code>pm.expect(...)</code> — проверки;
          </li>
          <li>
            <code>pm.response</code> — статус, заголовки, <code>pm.response.json()</code>;
          </li>
          <li>
            <code>pm.environment</code>, <code>pm.globals</code>, <code>pm.variables</code> —{' '}
            <code>get</code>/<code>set</code> переменных;
          </li>
          <li>
            <code>pm.request</code> — данные текущего запроса.
          </li>
        </ul>
      </Card>
      <Card title="Сниппеты">
        <p>
          Панель «Сниппеты» справа от редактора вставляет готовые проверки: код ответа, время
          ответа, значения JSON, заголовки. Результаты тестов видны в панели ответа.
        </p>
      </Card>
    </>
  )
}

function ImportExportTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">Импорт и экспорт</div>
      <Card title="Импорт">
        <p>
          Диалог «Импорт» принимает файл или вставленный текст. Поддерживаемые форматы: Postman
          v2.1, OpenAPI 3, Swagger 2.0, cURL, HAR, Insomnia. Режим «Авто» определяет формат сам.
        </p>
      </Card>
      <Card title="Экспорт">
        <p>
          Коллекции экспортируются в JSON формата Postman v2.1 — файл открывается в Postman и
          других клиентах. Папки и отдельные запросы экспортируются так же, через контекстное
          меню.
        </p>
      </Card>
      <Card title="Резервная копия SQLite">
        <p>
          В «Настройки → Данные» весь рабочий набор (коллекции, окружения, история) выгружается в
          один файл <code>.sqlite</code> и импортируется обратно. Основное хранилище приложения
          остаётся JSON.
        </p>
      </Card>
    </>
  )
}

function AiTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">AI-ассистент</div>
      <Card title="Подключение провайдера">
        <p>
          «Настройки → AI-провайдеры» → добавьте OpenAI, Anthropic, OpenRouter или любой
          OpenAI-совместимый эндпоинт. Используется ваш собственный API-ключ — он шифруется
          системным хранилищем и никуда не передаётся, кроме выбранного провайдера.
        </p>
      </Card>
      <Card title="Локальные модели">
        <p>
          Ollama и LM Studio подключаются как «OpenAI-compatible»: укажите base URL{' '}
          <code>http://localhost:11434/v1</code> (Ollama) или <code>http://localhost:1234/v1</code>{' '}
          (LM Studio).
        </p>
      </Card>
      <Card title="Контекст запроса">
        <p>
          Ассистент открывается по <Kbd>{MOD}</Kbd> <Kbd>J</Kbd>. Если в «Настройки → Основные»
          включено «Отправлять контекст в AI», он видит текущий запрос и ответ — может объяснить
          ошибку, написать тест или поправить запрос. Предложенные изменения применяются вручную
          или автоматически (отдельная настройка).
        </p>
      </Card>
    </>
  )
}

function ShortcutsTopic(): JSX.Element {
  const rows: { label: string; keys: string[] }[] = [
    { label: 'Командная палитра', keys: [MOD, 'K'] },
    { label: 'Отправить запрос', keys: [MOD, '↵'] },
    { label: 'Новый запрос', keys: [MOD, 'N'] },
    { label: 'Открыть/скрыть AI', keys: [MOD, 'J'] },
    { label: 'Сохранить', keys: [MOD, 'S'] },
    { label: 'Закрыть вкладку', keys: [MOD, 'W'] },
    { label: 'Настройки', keys: [MOD, ','] }
  ]
  return (
    <>
      <div className="help-topic-title">Горячие клавиши</div>
      <Card title="Основные сочетания">
        {rows.map((r) => (
          <div
            key={r.label}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
          >
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--tx-1)' }}>{r.label}</span>
            {r.keys.map((k, i) => (
              <Kbd key={i}>{k}</Kbd>
            ))}
          </div>
        ))}
      </Card>
      <Card>
        <p>
          Полный список — в разделе «Горячие клавиши» настроек; там же сочетания можно
          переназначить под себя.
        </p>
      </Card>
    </>
  )
}

function FaqTopic(): JSX.Element {
  return (
    <>
      <div className="help-topic-title">FAQ</div>
      <FaqItem q="Как отправить первый запрос?">
        Создайте вкладку ({MOD}+N), вставьте URL — например <code>https://httpbin.org/get</code> —
        и нажмите «Отправить» ({MOD}+↵). Статус, заголовки и тело ответа появятся в панели ниже.
      </FaqItem>
      <FaqItem q="Как поделиться парой запросов с коллегой?">
        Правый клик по запросу или папке в дереве коллекций → экспорт в JSON. Коллега импортирует
        файл через диалог «Импорт» (формат Postman v2.1) — в Relay или даже в самом Postman.
      </FaqItem>
      <FaqItem q="Как подключить локальную модель (Ollama / LM Studio)?">
        «Настройки → AI-провайдеры» → тип «OpenAI-compatible». Base URL{' '}
        <code>http://localhost:11434/v1</code> для Ollama или{' '}
        <code>http://localhost:1234/v1</code> для LM Studio; ключ — любая непустая строка.
      </FaqItem>
      <FaqItem q="Где хранятся мои данные?">
        Локально, в папке данных приложения (userData), в JSON-файлах. Ничего не отправляется в
        облако и не требует аккаунта. API-ключи шифруются системным хранилищем (Keychain / DPAPI /
        libsecret).
      </FaqItem>
      <FaqItem q="Как включить тему в стиле Postman или Insomnia?">
        «Настройки → Внешний вид»: выберите соответствующий пресет темы. Светлый/тёмный режим и
        акцентный цвет настраиваются отдельно.
      </FaqItem>
      <FaqItem q="Как узнать о новых версиях?">
        В разделе «О приложении» включите проверку обновлений — приложение сверяет свою версию с
        релизами на GitHub и сообщает, когда вышла новая.
      </FaqItem>
      <FaqItem q="Почему запрос работает здесь, но падает в браузере?">
        Relay отправляет запросы из основного процесса Electron, без браузерных ограничений CORS.
        Если браузер блокирует запрос, а Relay — нет, проверьте CORS-заголовки на сервере.
      </FaqItem>
      <FaqItem q="Как отключить проверку SSL-сертификатов?">
        «Настройки → Основные» → выключите «Проверять SSL-сертификаты». Пригодится для localhost с
        самоподписанным сертификатом; для боевых серверов проверку лучше не отключать.
      </FaqItem>
      <FaqItem q="Как сделать резервную копию всех данных?">
        «Настройки → Данные» → «Резервная копия (SQLite)»: экспорт коллекций, окружений и истории
        в один файл <code>.sqlite</code> и обратный импорт на любом компьютере.
      </FaqItem>
      <FaqItem q="Куда писать с предложениями и багами?">
        На <code>{FEEDBACK_EMAIL}</code>. В разделе «О приложении» есть кнопки «Написать» и
        «Копировать» для этого адреса.
      </FaqItem>
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
  shortcuts: ShortcutsTopic,
  faq: FaqTopic
}

export function HelpSection(): JSX.Element {
  const [topic, setTopic] = useState<TopicId>('quickstart')
  const Content = TOPIC_CONTENT[topic]

  return (
    <>
      <div className="set-h">Справка</div>
      <div className="set-sub">Как устроен Relay: возможности и ответы на частые вопросы.</div>

      <div className="help-layout">
        <nav className="help-nav" aria-label="Темы справки">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              className={`help-nav-item${topic === t.id ? ' on' : ''}`}
              onClick={() => setTopic(t.id)}
              aria-current={topic === t.id}
            >
              {t.label}
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

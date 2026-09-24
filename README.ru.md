# Relay — десктопный клиент для тестирования API

*[English version](README.md)*

Кроссплатформенный десктопный клиент для тестирования API под **Windows, macOS и Linux** на
**Electron + React + TypeScript**. Данные хранятся локально в JSON в пользовательском каталоге;
секреты шифруются хранилищем ключей ОС.

## Основные возможности

- **HTTP-движок без CORS** в главном процессе Electron: все методы, все типы тела
  (raw/urlencoded/form-data/binary/GraphQL), авторизация (Bearer/Basic/API-key/OAuth 1.0/OAuth 2.0 со
  входом через браузер и PKCE/Digest/AWS SigV4/Hawk/NTLM/JWT/ASAP/EdgeGrid/inherit), редиректы с записью
  цепочки, таймаут, переключатель TLS, отмена, метрики времени и размера.
- **WebSocket, SSE, Socket.IO, MQTT, gRPC и GraphQL** наряду с HTTP.
- **Перемещаемые панели**: навигацию можно перетащить к любому краю окна, а запрос и ответ — к любому краю
  своей панели; панели меняются местами, а не сдвигают друг друга, плавающими становятся одним щелчком.
- **Импорт перетаскиванием файлов**: коллекции, OpenAPI/HAR/cURL, окружения, `.env`/CSV и темы, брошенные из
  проводника, распознаются сами.
- **Режим для слабых ПК**: без GPU, без анимаций, лёгкий редактор — при тех же возможностях.
- **Собственные темы** из JSON-файла ([руководство по темам](docs/THEMES.ru.md) · [in English](docs/THEMES.md)),
  а также комплект из 15 готовых тем.
- **AI-ассистент** (комплект возможностей): OpenAI, Anthropic, OpenRouter или любой OpenAI-совместимый
  endpoint со своим ключом; потоковый ответ, контекст с замаскированными секретами, вызов инструментов с
  подтверждением.
- **Коллекции, окружения и глобальные переменные** с подстановкой `{{var}}` повсюду, показом значения
  при наведении и пометкой неразрешённых переменных.
- Редактор тела запроса **на базе Monaco** и просмотр ответа в режимах Pretty/Raw/Preview.
- **Pre-request- и тестовые скрипты** с API `pm.*` в песочнице и вкладкой результатов тестов.
- **Импорт** Postman v2.1 / OpenAPI 3 / cURL, **экспорт** Postman v2.1, **генерация кода**
  (cURL/HTTP/JS/Python, ещё двенадцать языков — с комплектом), **вставка cURL**, палитра команд,
  горячие клавиши.
- **Раннер коллекций** для коллекции, папки или любого отмеченного набора запросов: итерации, файл данных
  CSV/JSON, остановка при первой ошибке и отчёт в JSON.
- **Отправка в терминал**: один щелчок — и запрос выполняется через curl (или HTTPie, wget, PowerShell) в
  новом окне терминала, с переносом переменных, авторизации, cookie, прокси и настроек TLS.
- **Импорт и экспорт переменных** — Postman, JSON, `.env` и CSV — для глобальных переменных, окружений и
  коллекций.
- **Плагины**: комплекты возможностей (темы, сниппеты, языки генерации кода, языки интерфейса, протоколы)
  и плагины с кодом в песочнице —
  см. [руководство по плагинам](docs/plugin-guide/README.ru.md) ([in English](docs/plugin-guide/README.md)).
- **Поиск и замена по всему рабочему пространству**: поиск по коллекциям, окружениям и переменным с
  выбором групп полей и замена ровно тех совпадений, которые вы подтвердили.
- **Локальное хранение**: все данные сохраняются в JSON в `userData`; API-ключи шифруются через Electron
  `safeStorage`.

## Документация

| | English | Русский |
|---|---|---|
| Возможности и их статус | [docs/FEATURES.md](docs/FEATURES.md) | [docs/FEATURES.ru.md](docs/FEATURES.ru.md) |
| Архитектура | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | [docs/ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md) |
| Система плагинов | [docs/PLUGINS.md](docs/PLUGINS.md) | [docs/PLUGINS.ru.md](docs/PLUGINS.ru.md) |
| Как написать плагин | [docs/plugin-guide/README.md](docs/plugin-guide/README.md) | [docs/plugin-guide/README.ru.md](docs/plugin-guide/README.ru.md) |
| Как сделать тему | [docs/THEMES.md](docs/THEMES.md) | [docs/THEMES.ru.md](docs/THEMES.ru.md) |
| AI-ассистент | [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md) | [docs/AI_ASSISTANT.ru.md](docs/AI_ASSISTANT.ru.md) |
| Встроенные комплекты возможностей | [plugins/README.md](plugins/README.md) | [plugins/README.ru.md](plugins/README.ru.md) |

## Запуск

```bash
npm install          # install dependencies
npm run dev          # launch the desktop app (electron-vite, HMR)
```

Если `npm install` падает с ошибкой кэша `EACCES` (каталог `~/.npm` принадлежит root), используйте кэш внутри проекта:

```bash
npm install --cache ./.npmcache
```

### Сборка и упаковка

```bash
npm run build        # type-check + bundle (main/preload/renderer)
npm run build:mac    # package macOS dmg + zip   (electron-builder)
npm run build:win    # package Windows NSIS installer
npm run build:linux  # package Linux AppImage + deb
```

Готовые пакеты попадают в `release/`. Сборки для macOS/Windows по умолчанию не подписаны — для
распространения настройте подпись и нотаризацию в `electron-builder.yml`.

### Релизы

Отправка тега версии запускает в GitHub Actions (`.github/workflows/release.yml`) сборку пакетов для
Windows, macOS и Linux и публикует их. Без Actions публикуйте релиз с каждой ОС:

```bash
git tag v1.2.0
git push origin v1.2.0
npm run release        # builds for this OS and uploads to the v1.2.0 release
```

Для `npm run release` нужен `gh auth login` или `GH_TOKEN` с правом записи в содержимое репозитория;
запустите его на Windows, macOS и Linux, чтобы добавить файлы каждой системы в один и тот же релиз.
На Windows `npm run release -- --linux-tar` дополнительно собирает переносимый `tar.gz` для Linux (скрипт
восстанавливает биты исполнения, которые NTFS не умеет хранить); для `.deb`, `.AppImage` и `.dmg` для macOS
нужна машина с Linux / macOS или CI-workflow.
Примечания к релизу берутся из `docs/releases/v<version>.md`.

### Тесты и линтинг

```bash
npm test                       # Vitest: HTTP engine, interpolation, AI adapters, cURL, scripting
RELAY_NET_TESTS=1 npm test     # also run live httpbin.org network tests
npm run lint                   # eslint + tsc --noEmit
```

## Подключение AI-провайдера

1. Откройте **Настройки → AI-провайдеры** (внизу боковой панели или `⌘/Ctrl+,`).
2. Выберите провайдера (Anthropic, OpenAI, OpenRouter или собственный OpenAI-совместимый базовый URL для
   Ollama/LM Studio) и вставьте свой API-ключ. Он хранится локально **в зашифрованном виде** и покидает
   ваш компьютер только в запросах к этому провайдеру.
3. Откройте AI-панель (`⌘/Ctrl+J`), выберите модель и задавайте вопросы.

Для локальных моделей (Ollama/LM Studio) добавьте собственного провайдера с базовым URL, например
`http://localhost:11434/v1`, и оставьте ключ пустым.

## Где что находится

- HTTP-движок: [`src/main/http`](src/main/http) · AI-клиент: [`src/main/ai`](src/main/ai)
- Хранилище и зашифрованные секреты: [`src/main/storage`](src/main/storage)
- Общий контракт: [`src/shared`](src/shared) (типы, IPC-контракт, интерполяция, cURL)
- UI рендерера: [`src/renderer`](src/renderer) (фичи, компоненты, Zustand-сторы)
- Эталон дизайна: [`design/`](design)

Все руководства на английском и русском — в таблице раздела «Документация» выше.

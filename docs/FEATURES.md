# FEATURES.md — Postman-parity feature target

*[Русская версия](FEATURES.ru.md)*

The goal is **maximum Postman parity** in an **isolated** desktop client: everything local, no
account, no telemetry, no connection the user did not ask for. The AI assistant is an optional pack.
Features are tiered by priority. **P0 must work** in the first build. P1 should be attempted in the same build
and is expected to mostly work. P2 is best-effort / future. Anything requiring a hosted backend
(team sync, cloud workspaces) is **out of scope** — this app is **local-first**.

Legend: `[x]` done · `[~]` partial · `[ ]` not yet. Updated to reflect the implemented build.

---

## P0 — Core (all implemented & verified)

### Request builder
- [x] Method selector: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (+ custom via engine).
- [x] URL bar with `{{variable}}` highlighting and inline hover resolution (source + value).
- [x] Query params editor: key / value / description / enabled checkbox; two-way sync with URL.
- [x] Path variables (`:id` style) auto-detected from the URL and editable.
- [x] Headers editor: key / value / enabled; common-header name autocomplete; note about auto-added headers.
- [x] Body types:
  - [x] none
  - [x] raw with language selector (JSON, Text, XML, HTML, JavaScript) via Monaco; sets Content-Type
  - [x] `x-www-form-urlencoded` (key/value/enabled table)
  - [x] `form-data` (text **and** file fields; file picker)
  - [x] binary (single file upload)
  - [x] GraphQL (query editor + variables editor)
- [x] "Beautify"/format action for JSON/XML bodies.

### Auth
- [x] No Auth
- [x] Bearer Token
- [x] Basic Auth (username/password → base64)
- [x] API Key (add to header or query param)
- [x] Inherit auth from parent collection/folder (walks the tree)
- [x] OAuth 2.0 (token fetch + attach), Digest (best-effort) — see P1

### Sending & response
- [x] Send button; cancel in-flight request.
- [x] Status code + reason, response time (ms), response size (B/KB/MB).
- [x] Response body tabs: **Pretty** (Monaco, JSON/XML/HTML with folding + syntax highlight),
      **Raw**, **Preview** (sandboxed `<iframe>` HTML; rendered image for image responses).
- [x] Pretty viewer via Monaco with folding + in-editor search (Cmd/Ctrl+F).
- [x] Response headers table.
- [x] Response cookies table (parsed from Set-Cookie).
- [x] Copy response; save response to file.
- [x] Graceful errors: DNS/connection/TLS/timeout shown as structured error states, never crash.

### Collections & tabs
- [x] Left sidebar: tree of collections → folders → requests.
- [x] Create / rename (inline) / delete / duplicate collections, folders, requests (context menu).
- [x] Save current request into a collection (Save / Save As with target picker).
- [x] Multiple open requests as **tabs**; dirty/unsaved indicator; reopen on restart.
- [x] Reorder via **drag-and-drop** (native HTML5 DnD: reorder requests/folders within and
      between folders/collections, reorder top-level collections; drop indicators; cycle-safe).

### Variables & environments
- [x] Environments: create / duplicate / delete / rename / select active environment.
- [x] Environment variables and **global** variables (key / value / enabled / secret).
- [x] Variable interpolation `{{var}}` in URL, params, path vars, headers, body, and auth.
- [x] Resolution precedence: collection → environment → global (+ dynamic `{{$...}}`).
- [x] Variable name highlighting; hover shows resolved value & source; unresolved vars flagged.

### History
- [x] Every sent request is logged (method, url, status, time, timestamp).
- [x] Click a history item to restore it into a tab.
- [x] Clear history. Capped to `maxHistory`.

### Persistence & settings
- [x] Collections, environments, globals, history, open tabs, providers, and settings persist to
      disk (atomic JSON in userData) and survive restart.
- [x] Settings screen: theme (light/dark/system), request timeout, SSL verification on/off,
      follow-redirects on/off, max history, word-wrap, AI-context toggle, accent color.
- [x] AI provider settings: add providers from templates (Anthropic, OpenAI, OpenRouter, Ollama,
      LM Studio, custom OpenAI-compatible — nothing is pre-seeded), store API keys **encrypted**
      (safeStorage) or connect local servers without a key, pick default provider/model. The model
      list is fetched live from the provider (`/models`, incl. Anthropic's paginated endpoint) with
      search, refresh and a free-text model id.

### AI assistant (optional pack) — see docs/AI_ASSISTANT.md
- [x] Dockable AI panel with a chat thread.
- [x] Provider + model picker (OpenAI, Anthropic, OpenRouter, custom OpenAI-compatible).
- [x] **Streaming** responses (token-by-token over IPC).
- [x] **Context** about current request, last response, and active environment (secret-masked).
- [x] Core use-cases: explain a response, generate a request, suggest fixes, write a test, convert to code.
- [x] "Apply to request" / "insert" actions for AI-produced HTTP / cURL / test / JSON snippets.

---

## P1 — High value (attempted in this build)

- [x] **Pre-request scripts** and **Tests** in a sandboxed (isolated child-process) `pm.*` runtime:
      `pm.environment`, `pm.globals`, `pm.variables` (incl. `.set/.unset` local scope),
      `pm.collectionVariables`, `pm.iterationData`, `pm.request`, `pm.response`, `pm.cookies`,
      `pm.sendRequest`, `pm.visualizer`, `pm.test`, and a broad `pm.expect` chai surface
      (`.members/.oneOf/.keys/.closeTo/.throw/.nested.property/…`). **Collection- and folder-level**
      pre-request/test scripts run top-down around the request. Results in a Tests tab with console.
- [x] **Import**: Postman Collection v2.1, OpenAPI 3.x **and Swagger 2.0** (JSON **or YAML**),
      **HAR**, **Insomnia v4**, and cURL (paste or file).
- [x] **Export**: collection as Postman v2.1 JSON; full workspace as a portable `.sqlite`.
- [x] **Code generation** (16 targets): cURL, raw HTTP, JavaScript (fetch) and Python (requests) in
      the core; Node, Go, **Java (OkHttp), C# (HttpClient), PHP (cURL), Ruby (Net::HTTP), Swift
      (URLSession), Kotlin (OkHttp), Rust (reqwest), PowerShell, HTTPie, wget** with the
      `codegen-languages` pack (1.2).
- [x] **Paste cURL** into the URL bar to auto-fill the whole request.
- [x] **~50 dynamic variables** (`{{$randomFirstName}}`, `{{$randomEmail}}`, `{{$randomIP}}`,
      `{{$randomDatetime}}`, … the Postman set) plus `{{$guid}}/{{$timestamp}}/{{$counter}}`.
- [x] **OAuth 2.0**: client_credentials, password, authorization_code (**+ PKCE**), **refresh_token**,
      and **device code** (RFC 8628); client creds via body or HTTP Basic; **auto-refresh on 401**.
- [x] **Digest auth** — full RFC 7616 challenge/response (MD5, SHA-256 and `-sess` variants;
      qop=auth; legacy RFC 2069 fallback). The first request is sent unauthenticated; the engine
      answers the 401 `WWW-Authenticate: Digest` challenge and replays once. Unit-tested against
      the canonical RFC vectors. **Preemptive mode** sends credentials on the first request from a
      known realm/nonce.
- [x] **Cookie manager**: persistent, editable jar in main (per workspace) — auto-captures
      `Set-Cookie` and auto-attaches matching cookies (domain/path/secure/expiry) to requests; a
      Cookie Manager UI (grouped by domain; add/edit/delete; clear-all / clear-by-domain). The
      per-response Cookies table remains.
- [x] Save **response examples** on a request (save the current response as a named example;
      Examples tab to view/restore/delete; restore shows the stored response without sending;
      round-trips to/from Postman v2.1 `item.response[]`).
- [x] **Bulk edit** for params/headers (key:value text mode; `//` disables a row; blank lines
      ignored; lossless two-way, preserving enabled state + descriptions).
- [x] **Extended auth types** (pure `node:crypto`, vector-tested): **JWT Bearer** (HS/RS/PS),
      **OAuth 1.0a** (HMAC-SHA1/256, PLAINTEXT), **AWS Signature v4** (incl. UNSIGNED-PAYLOAD for
      multipart), **Hawk**, **Akamai EdgeGrid**, **ASAP**, and **NTLM** (NTLMv2 with a hand-written
      pure-JS MD4 since OpenSSL 3 drops it; the Type 1/2/3 handshake runs inside the engine on a
      forced single-connection pool, replaying the 401 challenge with the Type 3 message). Token-style
      auth attaches a header; request-bound auth is signed after the body is assembled. **This now
      covers Postman's entire auth roster.**
- [x] **Test snippets** — a Snippets panel in the Scripts editor inserts ready `pm.test`/`pm.expect`
      boilerplate (status code, response time, body contains/equals/JSON value, header checks,
      set/get env vars, …).
- [x] **HTTP/2** — optional ALPN negotiation (undici `allowH2`), toggle in Settings → Network.
- [x] **Search** across collections/requests; **command palette** (Cmd/Ctrl+K).
- [x] Keyboard shortcuts (Send = Cmd/Ctrl+Enter, new tab ⌘N, save ⌘S, close tab ⌘W, AI ⌘J, settings ⌘,).
- [x] **AI tool-calling**: assistant can read/modify the current request, set variables, and send the
      request — mutating/sending actions gated by an explicit confirmation dialog (auto-apply toggle in Settings).

---

## P2 — implemented locally (no hosted backend needed)

- [x] Collection **Runner** (N iterations + optional CSV/JSON data file). Each iteration binds one
      data row as the highest-precedence scope and exposes `pm.iterationData`; runs every request
      in order with pre-request/test scripts; live progress; per-request/iteration pass/fail; stop.
      The run list is editable: a collection or folder fills it, the tick boxes decide what runs and
      the arrows set the order, so an arbitrary set of requests — from different collections — can
      be sent as one pass. Opens from a collection's context menu, from the sidebar («Раннер»,
      empty, for hand-picking) or with Ctrl/⌘+Shift+R. «Stop on failure» ends the run at the first
      failed request or test, and the result can be saved as a JSON report.
- [x] **Find & replace across the workspace** (Ctrl/⌘+Shift+F): one pass over every collection,
      environment and global variable — names, URLs, params, headers, bodies (raw, GraphQL, form),
      auth fields, scripts and descriptions. Case, whole-word and regex switches; the search area
      narrows by field group and by scope. Matches come back as a list with context, each with a
      tick box, so a bulk edit (a domain, an API version) lands only where it should. Secret
      variable values never take part. The logic is pure and unit-tested
      (`src/renderer/lib/find-replace.ts`).
- [x] **WebSocket** + **SSE** client (main-process engines over undici; per-connection IPC event
      stream; custom handshake headers; WS send + binary frames as base64; SSE `event/data/id/retry`
      parsing with auto-reconnect + `Last-Event-ID`). Mode switch in the URL bar; messages/events
      panel + composer.
- [x] **Default request headers**: `User-Agent: Relay/<version>`, `Accept: */*` and
      `Accept-Encoding: gzip, deflate, br` are sent unless the user set one of them (an empty value
      drops it). undici sends none of these on its own, so a request used to arrive carrying nothing
      but `Host` — which WAFs, API gateways and several frameworks answer with 400 or 403 while the
      identical request from Postman goes through.
- [x] **Literal braces survive the URL**: the WHATWG parser escapes `{`/`}` to `%7B`/`%7D`, so an
      API taking a literal `{id}` — or a URL still holding an unresolved `{{var}}` — used to reach
      the server mangled. They are sent raw now, as Postman and browsers do, and a send whose
      variables did not resolve says so instead of leaving a 400 to explain it.
- [x] **Variable peek** (the eye in the titlebar): what the next request will actually use —
      collection, environment and global variables in precedence order, with shadowed names struck
      through, secrets masked behind a reveal, filter and copy. A token written by a pre-request
      script is visible without opening the environment editor.
- [x] **`{{` autocomplete**, as in Postman: typing two braces in any request field (URL, params,
      headers, auth) or in an editor (body, scripts) opens the list of variables that are actually
      in scope — collection, environment, globals with their current values (secrets masked), then
      the built-in dynamic ones. It narrows as the name is typed, ↑↓ pick, Enter/Tab insert the
      whole `{{name}}`, Esc hides it; accepting inside an existing reference replaces it rather
      than nesting. One name defined in several scopes appears once, attributed to the scope that
      wins. The matching/ranking logic is pure and unit-tested (`src/renderer/lib/var-suggest.ts`),
      and the Monaco provider (`var-completion.ts`) feeds from the same function.
- [x] **pm.sendRequest speaks every Postman body mode**: `urlencoded` (list, object or encoded
      string), `raw` with `options.raw.language`, `formdata` (text parts only — a script cannot
      upload a local file) and `graphql`. Only `raw` used to be understood, so the standard
      client_credentials token call went out with an empty body. A failed call's `error` prints as
      its message in the script console instead of `{}`.
- [x] **«Verify SSL certificates» off holds on every hop**: it used to snap back on at a
      cross-origin redirect, so an auth endpoint behind a load balancer still failed with
      «self signed certificate in certificate chain» after the user had switched it off. Postman
      semantics now; credentials are still stripped at an origin change. A certificate error —
      in the response card or from a pre-request script — offers **«Отключить проверку SSL»** in
      place (`src/renderer/lib/tls-hint.ts`).
- [x] **Scripts and plugins actually run in a packaged build**: the sandbox children are the
      Electron binary in `ELECTRON_RUN_AS_NODE` mode, where the built-in `electron` module does not
      exist — and they used to be handed the app's main bundle, whose top-level `require('electron')`
      throws there. It resolves in development (the npm package is on disk), so the failure was
      invisible until the installer: every pre-request/test script and every user plugin died with
      «Script sandbox stopped». The children now run their own electron-free bundle
      (`src/main/sandbox-entry.ts` → `out/main/sandbox.js`).
- [x] **Warm script sandboxes**: forking the Electron binary as Node and loading the bundle costs
      ~500 ms of CPU, and a collection run paid it twice per request (pre-request + test) — which
      pinned a core near 100 % and added half a second per request. A child that finishes a run
      with nothing left in flight is now kept warm (up to two, dropped after two idle minutes) and
      handed to the next script, which starts in single-digit milliseconds. Isolation is unchanged:
      a brand-new `vm` context per run inside a process launched with
      `--disallow-code-generation-from-strings`, and a child whose run timed out, crashed or left a
      `pm.sendRequest` unsettled is killed instead of reused.
- [x] **pm.sendRequest runs on the app's own engine**, not a bare `fetch`: a script that fetches a
      token honours the same TLS strictness, CA bundle, proxy, client certificates and timeout as a
      request sent from the UI, and the async-settle window follows the request timeout instead of a
      flat 3 s. Cookies are still not applied (as in Postman). The `ca` option carries Node's
      default roots along with the user's bundle — setting it replaces the trust store outright,
      which used to break every public host the moment a corporate CA was trusted.
- [x] Response **visualizer**: `pm.visualizer.set(template, data)` rendered with a safe, pure
      template engine inside a locked-down `<iframe sandbox>` (no scripts, no network, strict CSP);
      plus a zero-config auto-table for JSON arrays.
- [x] **Proxy** configuration (undici `ProxyAgent`, proxy auth + no-proxy bypass list) and **client
      TLS certificates** (per-host PEM/PFX + optional CA + passphrase; bytes read only in main).
      Configured in Settings → Network.
- [x] **Workspaces** (local, multiple): each its own isolated collections/environments/globals/
      history/tabs/cookies under a per-workspace dir; titlebar switcher (create/rename/delete/
      switch) with hot-reload on switch. App-level settings, AI providers and secrets are shared.
- [x] **GraphQL** request mode (HTTP POST with a `{query, variables}` body editor) **+ schema
      introspection**: fetch the endpoint's schema, browse a docs panel (types → fields → type), and
      get Monaco autocomplete of root fields/types from the introspected schema.
- [x] **Socket.IO** client (pure-JS `socket.io-client` in main; connect, emit events, listen, with
      bounded reconnection) — a realtime mode with an event + payload composer **and saved message
      templates**.
- [x] **MQTT** client (pure-JS `mqtt.js` in main; connect over mqtt(s)/ws(s), subscribe, publish) —
      a realtime mode with topic subscribe + publish composer, **per-connection QoS (0/1/2) and a
      Last-Will & Testament**, plus saved message templates.
- [x] **gRPC** client (pure-JS `@grpc/grpc-js` + `@grpc/proto-loader`, no native modules): paste or
      upload a `.proto` **or discover services via Server Reflection**, pick a method, edit the request
      message as JSON, set call metadata, **mTLS client certs and a per-call deadline**, and invoke.
      Supports **unary, server-streaming, client-streaming and bidi**; plaintext (h2c) or TLS; results
      stream into a live log (with a Send/Finish composer for client-/bidi-streams).
- [x] **SQLite** backup (optional, pure-WASM `sql.js`, no native modules): export the current
      workspace (collections, environments, globals, history) to a portable `.sqlite` file and import
      it back (Settings → Данные). The file is a real SQLite database with readable columns plus
      lossless `json` columns. NOTE: per CLAUDE.md the **JSON document store remains the canonical
      backend** — SQLite is a backup/interchange format here, NOT a replacement storage engine
      (`better-sqlite3`, a native module, is still intentionally avoided to keep the build green).
- [x] **Split panes (Terminator-style)**: the editor area is a binary split tree
      (`store/panes.ts`). Presets for 1/2/3/4/8 panes, add a pane right/below, close a pane; every
      split has a draggable divider and every pane its own builder/response divider and layout.
      A tab can be shown by only one pane; the tab strip and the active pane stay in sync (click,
      focus or typing inside a pane makes it active). Drag a pane header onto another pane to swap
      (center) or re-split (edges). Keyboard: focus / move / resize by direction, maximize, flip
      the big pane with the neighbouring group — all rebindable in Settings → Горячие клавиши.
- [x] **Detached panes**: any tab can open in its own OS window (Alt+Tab-able, moved/resized with
      the same shortcuts). Windows share data through main (`storage:changed` broadcast); the
      response is handed over on detach/return; realtime/gRPC events route to the owning window.
- [x] **Undo / redo in the request builder** (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y): per-tab history
      grouped by area (URL, Params, Headers, Body, Auth, Scripts, name/description). Inside a field
      it undoes that area even after focus moved away; with nothing focused it undoes the tab's
      latest change, switches to that sub-tab and highlights it.
- [x] **Narrow panes scroll instead of wrapping**: the request bar, the tab rows, the sub-bars and
      the key/value table keep their natural width and scroll sideways, so nothing — the Send button
      least of all — ends up clipped out of reach when a pane is dragged narrow.

- [x] **Drag a tab or a saved request into the grid**: dropping it on the middle of a pane shows
      it there; dropping it on an edge splits that pane; dropping it on an outer edge of the whole
      grid splits the layout itself (VS Code style). The base app allows up to four panes; the
      «Дополнительные панели» pack raises the ceiling to 16 and unlocks the 8-pane preset.
- [x] **Feature packs** (`plugins/` next to the app, see docs/PLUGINS.md §10): the base app is HTTP
      + GraphQL, six auth schemes, ru/en and four panes. WebSocket, SSE, Socket.IO, MQTT, gRPC, the
      AI assistant, the advanced auth schemes, extra languages and extra panes each live in their own
      folder and can be switched off (or removed from the list) individually. Their UI and their
      renderer chunks are absent until the pack is on.
- [x] **One plugin list** (Settings → Плагины): packs and code plugins share the list, and each row
      is just a name plus **info / remove / enable**, with the description, what it adds, the
      permissions and the folder behind the info button. A single **«Выбрать плагин на компьютере…»**
      opens in the `plugins` folder — where the packs nobody picked during installation wait — and
      accepts a folder or a `.zip` from anywhere on disk; the main process works out whether it is a
      capability pack or a code plugin. A pack that was never added is not listed at all, and
      removing one only takes it out of the list: its folder stays, so it can be added back.
- [x] **UI language** (Settings → Основные): Russian and English ship with the app; German and
      Spanish come from the «Дополнительные языки» pack, and a new language is a JSON file dropped
      into that pack. Translation keys *are* the Russian strings, so an untranslated string degrades
      to correct Russian instead of a raw key. Coverage is verified empirically — the app is driven
      in English and its DOM swept for Cyrillic, including the onboarding tour, the pack names read
      from `plugin.json` and the seeded workspace/request names. Switching language reloads the
      window so module-level label tables follow the change.
- [x] **Update check against GitHub**: releases first, falling back to version tags for a repository
      that has not published a release yet; the result distinguishes "no releases", rate limiting,
      timeout and network failure, and shows the release date and notes.

- [x] **Windows installer**: language selection (ru/en) that also becomes the app's UI language and
      the language of the first-run tour — asked once, and inherited by the elevated instance that
      "for all users" spawns; a page for picking which feature packs start enabled; and, on a real
      uninstall, a prompt offering to delete `%APPDATA%\Relay` — the user's own Roaming folder even
      when the uninstall itself runs per-machine (silent uninstalls keep the data).
- [x] **Network** (Settings → Сеть): proxy off / **system** (Chromium resolves the OS settings and
      PAC) / custom with auth and a bypass list; a **shared CA bundle** on top of the system trust
      store; the SSL-verification switch; per-host client certificates (PEM or PFX); and a
      **connection test** that sends a real request through exactly these settings.
- [x] **Backups** (Settings → Данные): the whole workspace — collections, environments, globals and
      history — exported to **JSON** in the base app, plus **ZIP** (one file per kind) and **SQLite**
      from the «Дополнительные форматы резервных копий» pack. Restore either merges into the current
      workspace or replaces it (two-step confirmation). Secrets are never written into a backup.

- [x] **Send to terminal** (1.2): the «cURL» split button next to «Код» runs the resolved request —
      variables, inherited auth incl. Digest/NTLM and AWS/OAuth 1/Hawk/Akamai signatures, body, jar
      cookies, proxy, CA bundle, SSL switch, redirects, timeout — with curl, HTTPie, wget (macOS/Linux)
      or PowerShell (Windows) in a new terminal window (Windows Terminal/PowerShell, Terminal.app,
      gnome-terminal/konsole/xterm/…). The main process builds the script from the RequestSpec (the
      renderer can't hand it a shell command), quotes for the target syntax (a curl config file, POSIX
      shell, PowerShell), writes it into a private temp folder the script deletes after the run, and
      prints what the terminal run does differently (scripts not executed, unresolved variables).
      Code generation gains raw **HTTP** and **wget** targets and «Выполнить в терминале».
- [x] **Variable import** (1.2) into globals, an environment (existing or new) or a collection:
      Postman environment / globals / collection exports, JSON (flat, nested Insomnia-style, or a list of
      entries), `.env` and CSV/TSV/semicolon tables; merge or replace with a preview of what is added
      and updated. Entry points: the «Среды» sidebar head, the variable peek (eye) and every variable
      editor. The general «Импорт» now puts a Postman globals export into the globals.
- [x] **Variable export** (1.2) of globals, an environment or a collection's variables as a Postman
      environment/globals export, flat JSON, `.env` or CSV — each reads back through the import.
      Secret values are written empty unless explicitly included; copy or save with a preview.
      Entry points: the «Среды» sidebar head, an environment's context menu, the variable peek and
      every variable editor.
- [x] **Collection variables editor** (1.2): collection context menu → «Переменные коллекции».
- [x] **Theme pack** (1.2, pack `theme-pack`, capability `themes.extra`): 15 themes — Postman and
      Insomnia (moved out of the core), Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, Solarized, One
      Dark, Synthwave ’84, Rosé Pine and four originals. Themes are data (`themes.json`, dark and/or
      light variants, colour allowlist); Monaco editors derive their palette from the active theme.
- [x] **Script snippets as a pack** (1.2, `script-snippets`, capability `snippets`): the snippets
      panel is data from `snippets.json`, grouped, with checks for every HTTP method. Upgrading from
      1.1 adds the pack and carries a Postman/Insomnia theme over to the theme pack (one-time migration).
- [x] **Code-generation languages as a pack** (1.2, `codegen-languages`, capability `codegen.extra`):
      «Код» keeps cURL, HTTP, JavaScript and Python; the other 12 targets come with the pack. Existing
      installations get the pack added on upgrade (migration `codegen-1.2`).
- [x] **Resizable editors** (1.2): the request builder fills its pane, so dragging the response divider
      resizes the body, GraphQL and script editors instead of scrolling a fixed 300 px box.
- [x] **Plugin authoring guide** (1.2): `docs/plugin-guide` (EN + RU) with five tested examples,
      linked at the bottom of Settings → Плагины.
- [x] **Local release script** (1.2): `npm run release` builds for the current OS and creates or
      updates the GitHub release through the API — for when GitHub Actions is unavailable.

## 1.3 — Isolation, layout, verification

### Isolation
- [x] **Positioning**: an isolated desktop client for API testing; the AI assistant is an optional pack.
- [x] **No automatic update check**: the startup check and its setting are gone; «Проверить сейчас»
      in About is the only way a version check happens.
- [x] **Session hardening**: no DNS prefetch, spellchecker off (it downloads dictionaries), every
      permission request (camera, location, notifications…) declined except the clipboard. The CSP
      (verified to apply to the `file://` page) keeps external images/scripts/connections out,
      including the HTML response preview.
- [x] Main-window reload/crash closes the realtime and gRPC connections it owned.

### Layout and look
- [x] **Low-power mode** (Settings → General, replaces «Экономить видеопамять»; a 1.2 value
      migrates): after a restart — no GPU, software compositing, Chromium low-end-device mode, no
      animations/shadows/blur, and a plain textarea editor instead of Monaco (Monaco is never loaded)
      with the same `{{` autocomplete. Every feature keeps working.
- [x] **Dockable sidebar**: left / right / bottom / floating, by the four buttons in its header or
      by dragging the header — edge zones dock, the middle floats. Size and position persist.
- [x] **Dockable response panel** per pane: bottom / right / left / floating, same drag-to-dock
      (from the status bar or the grip) and buttons; 1.2 layouts migrate.
- [x] **Command palette**: actions are listed before requests.
- [x] **User themes**: Settings → Appearance → My themes → Load theme… reads one JSON file (a theme,
      a list, or a pack's `themes.json`), same colour allowlist as packs; stored app-level.
      Authoring guide: `docs/THEMES.md` (EN) / `docs/THEMES.ru.md` (RU).

### Protocols (verified with local servers, 61 tests)
- [x] SSE works on hosts with undici 7 (bundled dispatcher) and reports why a retry happens;
      multi-byte UTF-8 split across chunks decodes correctly.
- [x] WebSocket: the real handshake failure is shown; a 30 s handshake timeout; subprotocols can be
      set in the UI.
- [x] MQTT: graceful DISCONNECT (no Last Will on a normal disconnect); login, password, client id and
      subscribe-on-connect topics in the UI.
- [x] Socket.IO: stops after the retry budget with a terminal event; event filter in the UI.
- [x] gRPC reflection loads transitive dependencies; bad metadata is an error event, not a rejected call.
- [x] GraphQL introspection follows redirects.

### Authorization (verified against spec vectors, 51+ tests)
- [x] AWS SigV4: `x-amz-content-sha256` for S3, single URI encoding for S3.
- [x] Akamai EdgeGrid hashes POST bodies only; Digest honours `stale=true` and supports SHA-512-256;
      NTLM Type 3 flags masked; OAuth 1.0 signs repeated form keys (engine and send-to-terminal).
- [x] Request-bound signatures are recomputed on every redirect hop and never minted for another host.
- [x] Cryptographic nonces for Hawk and OAuth 1.0.
- [x] **OAuth 2.0 browser sign-in**: authorize URL with `state` and PKCE `code_challenge` (S256),
      loopback redirect caught on `http://127.0.0.1:<port>` (RFC 8252), code exchanged automatically;
      the code field also accepts a pasted redirect URL.
- [x] A token refreshed on 401 is stored on the request (or the folder/collection it inherits from).
- [x] An auth that cannot be built (bad JWT JSON, bad PEM…) stops the send with an `auth` error
      instead of sending the request unauthenticated.
- [x] Postman import/export maps AWS, Hawk, NTLM, OAuth 1.0, EdgeGrid, JWT and ASAP natively; an
      unknown scheme imports as "no auth", never as "inherit".

### Backups and data (verified, 46+ tests)
- [x] A corrupt JSON document is moved aside instead of being overwritten by a seed; a corrupt
      workspace list no longer orphans workspaces.
- [x] SQLite backup: repeated ids, global variable ids, junk rows, corrupt files; import only from a
      dialog-picked path.
- [x] JSON/ZIP restore validates the shape like SQLite; «Добавить» re-ids colliding nodes.
- [x] Backup files are written atomically; files up to 256 MB restore (was 25 MB).
- [x] Postman round trip keeps descriptions, disabled collection variables and path variables.
- [x] The Data screen says honestly what a backup contains (typed-in tokens are included).

## Out of scope (needs a hosted backend)

- Cloud sync, team workspaces, sharing links, mock servers, monitors, in-cloud history.

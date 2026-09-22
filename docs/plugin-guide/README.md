# Writing plugins for Relay

> Русская версия: [README.ru.md](README.ru.md)

This guide takes you from an empty folder to a plugin you can share. Every example
it mentions lives in [`examples/`](examples) and is checked by the test suite
(`src/main/plugins/guide-examples.test.ts`), so what you copy from here works.

- [1. Two kinds of plugins](#1-two-kinds-of-plugins)
- [2. Quick start: your first plugin in five minutes](#2-quick-start-your-first-plugin-in-five-minutes)
- [3. Feature packs: themes, snippets, languages](#3-feature-packs-themes-snippets-languages)
- [4. Code plugins](#4-code-plugins)
- [5. Packaging and sharing](#5-packaging-and-sharing)
- [6. Debugging](#6-debugging)
- [7. What a plugin can never do](#7-what-a-plugin-can-never-do)
- [8. Checklist before you publish](#8-checklist-before-you-publish)

---

## 1. Two kinds of plugins

Every plugin is a folder with a `plugin.json`. What else is in the folder decides the kind:

| | **Feature pack** | **Code plugin** |
|---|---|---|
| What it is | A manifest plus data files (JSON) | A manifest plus JavaScript (`main.js`) |
| Runs code | Never | Yes, in an isolated sandbox process |
| Good for | Colour themes, script snippets, UI languages, switching built-in features on | Buttons, response tabs, palette commands, changing requests before send, reacting to responses |
| Permissions | None needed | Asked from the user when the plugin is enabled |
| Key field | `"capabilities": [...]` | `"main": "main.js"` and `"contributes": {...}` |
| Examples | [`my-theme-pack`](examples/my-theme-pack), [`my-snippets`](examples/my-snippets) | [`hello-toast`](examples/hello-toast), [`response-inspector`](examples/response-inspector), [`request-id`](examples/request-id) |

Start with a feature pack if you only need data (a theme, snippets). Write a code plugin when you need behaviour.

## 2. Quick start: your first plugin in five minutes

We will build [`hello-toast`](examples/hello-toast): a button in the title bar that says hello.

**1. Create a folder** named exactly like the plugin id:

```
hello-toast/
├── plugin.json
└── main.js
```

**2. `plugin.json`** — the manifest:

```json
{
  "id": "hello-toast",
  "name": "Hello Toast",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "The smallest code plugin: a titlebar button that shows a toast.",
  "main": "main.js",
  "permissions": [],
  "contributes": {
    "buttons": [
      { "id": "hello", "label": "Привет", "icon": "sparkle", "location": "titlebar", "tooltip": "Сказать привет" }
    ]
  }
}
```

**3. `main.js`** — the handler:

```js
relay.on('button:hello', () => {
  relay.toast('Привет из плагина!', 'ok')
})
```

**4. Install it.** Zip the folder (`hello-toast.zip` with `hello-toast/plugin.json` inside, or
`plugin.json` at the archive root), then in Relay open **Settings → Plugins → «Выбрать плагин на
компьютере…»** and pick the archive. A freshly installed code plugin is always **off**: switch it
on with «Включить и разрешить».

**5. Click the ✨ button** in the title bar. A toast says hello.

Instead of zipping you can copy a code plugin straight into its plugins directory — Relay watches it
and picks changes up within a second (edits to `main.js` apply on the next click). A pack copied
into its folder is not used until it is added once with «Выбрать плагин на компьютере…» (the
dialog opens in that folder):

| OS | Code plugins | Feature packs |
|---|---|---|
| Windows | `%APPDATA%\Relay\relay-data\plugins\` | `resources\plugins\` in the install folder |
| macOS | `~/Library/Application Support/Relay/relay-data/plugins/` | `Relay.app/Contents/Resources/plugins/` |
| Linux | `~/.config/Relay/relay-data/plugins/` | `resources/plugins/` inside the install folder |

From anywhere else, pick a pack's `plugin.json` or `.zip` with «Выбрать плагин на компьютере…»:
Relay copies it into the right place and switches it on.

## 3. Feature packs: themes, snippets, languages

### 3.1 Manifest

```json
{
  "id": "my-theme-pack",
  "name": "My Theme Pack",
  "description": "Shown in Settings → Plugins",
  "version": "1.0.0",
  "capabilities": ["themes.extra"]
}
```

`id` must equal the folder name and be a plain lowercase token (`a-z`, `0-9`, `-`). A pack must
declare at least one capability; unknown capabilities are ignored.

| Capability | Data file | What it adds |
|---|---|---|
| `themes.extra` | `themes.json` | Colour themes in Settings → Appearance |
| `snippets` | `snippets.json` | The snippets panel on the Scripts tab |
| `i18n.extra` | `locales/<code>.json` + `"locales": [...]` | UI languages |
| `protocol.websocket`, `protocol.sse`, `protocol.socketio`, `protocol.mqtt`, `protocol.grpc` | — | Switch on built-in protocols |
| `ai`, `auth.advanced`, `panes.extra`, `backup.extra`, `codegen.extra` | — | Switch on built-in features |

Several packs can carry the same capability: snippets and themes of all enabled packs are merged.

### 3.2 Theme pack — `themes.json`

```json
{
  "themes": [
    {
      "id": "mint",
      "name": "Mint",
      "description": "Dark teal with a mint accent.",
      "accent": "#2ee6a8",
      "variants": {
        "dark":  { "--bg-0": "#0d1716", "--tx-0": "#e8fbf4", "...": "..." },
        "light": { "--bg-0": "#f4f1ea", "--tx-0": "#1f2640", "...": "..." }
      }
    }
  ]
}
```

- `variants` may hold `dark`, `light` or both. A theme with both follows the light/dark/system
  switch; a theme with one variant always uses it.
- `accent` sets the accent colour (buttons, focus, selection); Relay derives the hover/pressed/soft
  shades from it. The user can still pick another accent afterwards.
- Values must look like colours or plain numbers: `#hex`, `rgb()/rgba()`, `hsl()`, `oklch()`,
  `oklab()`, `lab()`, `lch()`, `hwb()`, keywords, `12px`/`1.5`. Anything else (for example
  `url(...)`) is dropped when the file is read. Up to 40 themes per pack, 80 variables per variant.

Tokens you can set (all optional — missing ones keep Relay's value):

| Token | Meaning |
|---|---|
| `--bg-0` … `--bg-3` | window, panels/sidebar, surfaces/cards, raised elements and inputs |
| `--bg-hover`, `--bg-active` | hover and pressed backgrounds (usually translucent) |
| `--line`, `--line-2` | borders and stronger dividers |
| `--tx-0` … `--tx-3` | primary, secondary, muted and faint text |
| `--code-bg` | code editors and code blocks — the editor colours are derived from it and the `--c-*` tokens |
| `--c-key`, `--c-str`, `--c-num`, `--c-bool`, `--c-null`, `--c-punct` | JSON syntax colours |
| `--m-get`, `--m-post`, `--m-put`, `--m-patch`, `--m-delete`, `--m-head`, `--m-options` | HTTP method colours |
| `--s-2xx`, `--s-3xx`, `--s-4xx`, `--s-5xx` | status code colours |
| `--accent-fg` | text on accent-coloured buttons (use a dark value for light accents) |

Tip: in a development build (`npm run dev`, DevTools with Ctrl+Shift+I) you can edit the variables
on `<html>` live and copy the result into `themes.json`. The 15 themes of the bundled `plugins/theme-pack` are a
good reference.

### 3.3 Snippet pack — `snippets.json`

```json
{
  "snippets": [
    {
      "id": "team-envelope",
      "group": "Team",
      "label": "Response follows our { data, error } envelope",
      "phase": "test",
      "code": "pm.test(\"Envelope\", function () {\n    const body = pm.response.json();\n    pm.expect(body).to.have.property(\"data\");\n});\n"
    }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | lowercase slug, unique within the pack |
| `label` | up to 120 characters |
| `group` | optional heading in the snippets panel |
| `phase` | `pre` (Pre-request), `test` (Post-response) or `both` |
| `code` | up to 20 000 characters; inserted at the end of the script |

Snippets run in Relay's script sandbox, which implements the Postman `pm.*` API: `pm.test`,
`pm.expect`, `pm.response` (`code`, `status`, `json()`, `text()`, `headers.get()`,
`responseTime`, `to.have.status()`, `to.have.header()`), `pm.request` (`url`, `method`,
`headers`), `pm.environment`, `pm.globals`, `pm.collectionVariables`, `pm.variables`,
`pm.cookies`, `pm.sendRequest`.

### 3.4 Language pack

Add `"capabilities": ["i18n.extra"]` and `"locales": ["it"]`, and put the catalog in
`locales/it.json`. The **keys are the Russian source strings**, the values your translation; copy
`src/renderer/locales/en.json` as a starting point. Missing keys fall back to English.

## 4. Code plugins

### 4.1 Manifest reference

| Field | Required | Rules |
|---|---|---|
| `id` | yes | `^[a-z0-9][a-z0-9-]{1,63}$`, equal to the folder name |
| `name`, `version` | yes | `version` is `x.y.z` |
| `description`, `author` | no | shown on the plugin card |
| `main` | no | file name of the handler script (default `main.js`, ≤ 512 KB) |
| `apiVersion` | no | `1`; a plugin written for a newer app is refused, not half-run |
| `permissions` | no | see [4.4](#44-permissions) |
| `contributes.buttons` | no | ≤ 10: `{ id, label, icon?, tooltip?, location }`, `location` = `response-toolbar`, `titlebar` or `sidebar` |
| `contributes.panels` | no | ≤ 10 response tabs: `{ id, label, icon?, location: "response-tab", interactive? }` |
| `contributes.commands` | no | ≤ 20 command-palette entries (Ctrl+K): `{ id, title, icon? }` |
| `contributes.themes` | no | ≤ 10: `{ id, label, base: "dark"\|"light", vars }` — applied from the plugin card |
| `contributes.events` | no | `response`, `request` (needs `request:write`), `workspace`, `collection` |
| `config` | no | ≤ 20 fields `{ key, label, type: "string"\|"secret", placeholder?, description? }` |
| `i18n` | no | `{ "en": { "hello": "Hello" } }`; write a label as `%hello%` to translate it |

Icons are Relay icon names: `send`, `sparkle`, `play`, `copy`, `download`, `upload`, `info`,
`code2`, `terminal`, `link`, `bolt`, `key`, `mail`, `refresh`, `eye`, `settings`, … — an unknown
name falls back to a default glyph.

### 4.2 The `relay` API

`main.js` is evaluated once per event. It registers handlers on the global `relay` object:

| Member | Permission | What it does |
|---|---|---|
| `relay.on(event, fn)` | — | register a handler (`fn` may be `async`) |
| `relay.toast(message, kind?)` | — | show a toast attributed to your plugin; `kind` = `ok` or `error` |
| `relay.log/info/warn/error(...)`, `console.*` | — | log lines, shown on the plugin card |
| `relay.config` | — | the user's values for your `config` fields (secrets included, decrypted only here) |
| `relay.fetch(url, init?)` | `net` or `net:<host>` | HTTP request: `{ ok, status, headers.get(), text(), json() }`; ≤ 5 per event, 10 s, 1 MB |
| `relay.storage.get/set/delete/has/keys` | `storage` | your own key-value store (≤ 100 keys, 8 KB each) |
| `relay.request.setUrl/setMethod/setHeader/removeHeader` | `request:write` | change the request in a `request` handler |
| `relay.panel.set(html)` | — | the HTML of a panel (in a `panel:<id>` handler) |
| `relay.clipboard.writeText(text)` | `clipboard` | copy text for the user |
| `setTimeout` / `clearTimeout` | — | short timers (≤ 5 s each) |

There is no `require`, no `process`, no DOM and no `eval`. Nothing survives between events except
`relay.storage`.

### 4.3 Events and context

| Event key | Fires when | `ctx` contains |
|---|---|---|
| `button:<id>` (or `button`) | the user clicks your button | `buttonId`, `request?`, `response?` |
| `panel:<id>` (or `panel`) | your response tab opens or is refreshed | `panelId`, `request?`, `response?`, `message?` |
| `command:<id>` (or `command`) | the user runs your palette command | `commandId`, `request?`, `response?` |
| `request` | before every send — **blocks the send**, 5 s budget | `request?` |
| `response` | after every response (manual sends and the runner) | `request?`, `response?` |
| `workspace` | the active workspace changed | `workspace` |
| `collection` | collections were saved | `history?` |

`request` is `{ method, url, headers: [{ key, value }] }`, `response` is `{ status, statusText,
headers: [[name, value], …], contentType, bodyText?, truncated?, sizeBytes, timeMs, finalUrl }`.
They are only present when you hold `request:read` / `response:read`. Credential headers
(Authorization, Cookie, API keys…) and every query value are masked.

**Panels.** A panel's HTML is shown in a sandboxed iframe: no scripts, no network, images only as
`data:` URLs. With `"interactive": true` scripts may run, but the frame has a null origin: its only
channel is `parent.postMessage(data, '*')`, which arrives in your handler as `ctx.message`; the HTML
you set in reply replaces the frame.

Example: [`response-inspector`](examples/response-inspector) renders a summary tab.

**Changing requests.** [`request-id`](examples/request-id) adds a header to every request:

```js
relay.on('request', () => {
  relay.request.setHeader(relay.config.headerName || 'X-Request-Id', uuid())
})
```

A request hook may change URL, method and headers. If it points the request at another origin, the
change is refused unless the plugin also holds `net` for that host — and even then the user's auth,
secret headers, body and query are stripped.

### 4.4 Permissions

Declare only what you use; the user sees each one as a plain-language line before enabling.

| Permission | Grants |
|---|---|
| `net` | `relay.fetch` to any host |
| `net:<host>` | `relay.fetch` to one host (`api.example.com`, `*.example.com`, optionally `:port`) — checked on every redirect |
| `request:read` | the (masked) request in `ctx.request` |
| `response:read` | the response in `ctx.response` (body up to 200 KB) |
| `request:write` | `relay.request.*` in a `request` handler; required for the `request` event |
| `storage` | `relay.storage.*` |
| `clipboard` | `relay.clipboard.writeText` |
| `history:read` | the 25 latest history entries (URLs masked) in `ctx.history` |

If an update of your plugin asks for more permissions, Relay switches it off and shows the new ones
until the user approves again.

### 4.5 Limits

| What | Limit |
|---|---|
| synchronous code | 3 s |
| async handler | 10 s (request hook: 5 s) |
| whole run | 15 s, then the process is killed |
| `main.js` / `plugin.json` | 512 KB / 64 KB |
| `relay.fetch` | 5 calls per event, 10 s each, 1 MB response |
| parallel runs | 2 plugin processes; `response` events of one plugin are coalesced |

## 5. Packaging and sharing

- Ship a `.zip` with `plugin.json` at the root or inside one top-level folder. Relay checks the
  size, validates the manifest, writes only files under `plugins/<id>/` and installs code plugins
  **switched off**.
- Bump `version` on every release. Installing the same `id` again replaces the old files (and again
  starts disabled, so the user re-approves the code).
- Put a short README next to `plugin.json`: what it does and why it needs each permission.

## 6. Debugging

- The plugin card in **Settings → Plugins** shows the last run: time, event, duration, error and the
  tail of your logs. Use `relay.log(...)` generously.
- A handler that throws produces an error toast «Плагин <name>: <error>».
- In a development build (`npm run dev`) logs of button runs also appear in the DevTools console.
- Relay reloads a plugin when its folder changes; reopening Settings → Plugins rescans the folder.

| Message | Cause |
|---|---|
| `id "…" must equal the plugin folder name "…"` (code plugin) / `id в манифесте не совпадает с именем папки` (pack) | rename the folder or the id |
| `unknown permission "..."` | typo in `permissions` |
| `unknown event` | `contributes.events` has something other than `response`, `request`, `workspace`, `collection` |
| `the 'request' event requires the 'request:write' permission` | add the permission |
| `relay.fetch requires the 'net' permission` / `relay.fetch: host not allowed by granted permissions` | add `net` / `net:<host>` |
| the theme is missing in Appearance | the pack is off, or all values were dropped by the colour allowlist |

## 7. What a plugin can never do

Plugin code runs in a separate process with code generation disabled and nothing but the `relay`
object: no file system, no Node, no Electron, no access to the window or to other plugins. It never
sees AI provider keys, stored secrets of the app, or other plugins' data. Network, request and
response access exist only as permissions the user granted. The full threat model is in
[docs/PLUGINS.md](../PLUGINS.md#8-security-model).

## 8. Checklist before you publish

- [ ] the folder name equals `id`; `version` is bumped
- [ ] only the permissions you really use, with the reason in your README
- [ ] no secrets in `plugin.json` or `main.js` — use a `secret` config field
- [ ] handlers return quickly and handle a missing `ctx.response`
- [ ] the plugin installs from its `.zip` on a clean profile and works after «Включить и разрешить»
- [ ] theme values are plain colours and look right in both variants you declare

# FEATURES.md — Postman-parity feature target

The goal is **maximum Postman parity** plus the **AI assistant** differentiator. Features are
tiered by priority. **P0 must work** in the first build. P1 should be attempted in the same build
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
- [~] Reorder via drag-and-drop (tree CRUD is done; DnD reorder not implemented).

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
- [x] AI provider settings: add providers, store API keys **encrypted** (safeStorage), pick default
      provider/model, dynamic model listing.

### AI assistant (the differentiator) — see docs/AI_ASSISTANT.md
- [x] Dockable AI panel with a chat thread.
- [x] Provider + model picker (OpenAI, Anthropic, OpenRouter, custom OpenAI-compatible).
- [x] **Streaming** responses (token-by-token over IPC).
- [x] **Context** about current request, last response, and active environment (secret-masked).
- [x] Core use-cases: explain a response, generate a request, suggest fixes, write a test, convert to code.
- [x] "Apply to request" / "insert" actions for AI-produced HTTP / cURL / test / JSON snippets.

---

## P1 — High value (attempted in this build)

- [x] **Pre-request scripts** and **Tests** in a sandboxed `vm` runtime with a `pm.*` subset
      (`pm.environment`, `pm.globals`, `pm.variables`, `pm.request`, `pm.response`, `pm.test`,
      `pm.expect` chai-style). Results shown in a **Tests** tab with console output.
- [x] **Import**: Postman Collection v2.1 JSON, OpenAPI 3.x, and cURL (paste or file).
- [x] **Export**: collection as Postman v2.1 JSON.
- [x] **Code generation**: cURL, JavaScript (fetch), Python (requests), Node, Go.
- [x] **Paste cURL** into the URL bar to auto-fill the whole request.
- [x] **OAuth 2.0** (client credentials + password grant token fetch). [~] Digest auth is best-effort.
- [~] **Cookie manager**: response Set-Cookie parsed and shown per response; persistent editable
      jar UI not built (type + storage scaffolded).
- [ ] Save **response examples** on a request (type scaffolded; no UI yet).
- [ ] **Bulk edit** for params/headers (key:value text mode).
- [x] **Search** across collections/requests; **command palette** (Cmd/Ctrl+K).
- [x] Keyboard shortcuts (Send = Cmd/Ctrl+Enter, new tab ⌘N, save ⌘S, close tab ⌘W, AI ⌘J, settings ⌘,).
- [x] **AI tool-calling**: assistant can read/modify the current request, set variables, and send the
      request — mutating/sending actions gated by an explicit confirmation dialog (auto-apply toggle in Settings).

---

## P2 — Best-effort / future (not in this build)

- [ ] Collection **Runner** (iterations + data file CSV/JSON).
- [ ] **WebSocket** / SSE / Socket.IO client; gRPC.
- [ ] Response **visualizer**.
- [ ] Proxy configuration; client TLS certificates.
- [ ] Workspaces (local, multiple).
- [ ] SQLite storage backend (upgrade from JSON).

## Out of scope (needs a hosted backend)

- Cloud sync, team workspaces, sharing links, mock servers, monitors, in-cloud history.

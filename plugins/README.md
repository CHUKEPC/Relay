# Feature packs

This folder ships next to the app and decides what Relay can do beyond its base:
HTTP requests, the six common auth schemes, Russian and English, and up to four
panes.

Each subfolder is one pack with a `plugin.json` manifest:

```json
{
  "id": "websocket",
  "name": "WebSocket",
  "description": "Shown in Settings → Plugins",
  "version": "1.0.0",
  "capabilities": ["protocol.websocket"]
}
```

`id` must equal the folder name. Everything is declarative — a feature pack
never executes code, which is what separates it from a user plugin
(`docs/PLUGINS.md`, sandboxed and permission-gated).

| Capability | What it unlocks |
|---|---|
| `protocol.websocket` / `protocol.sse` / `protocol.socketio` / `protocol.mqtt` / `protocol.grpc` | the matching entry in the protocol picker |
| `ai` | the AI assistant panel, its shortcut and Settings → AI providers |
| `auth.advanced` | Digest, JWT, OAuth 1.0, AWS Signature v4, Hawk, Akamai, ASAP, NTLM |
| `i18n.extra` | the UI languages listed in `locales` |
| `panes.extra` | up to 16 panes instead of four, and the 8-pane preset |
| `backup.extra` | ZIP and SQLite backups |
| `snippets` | the snippets panel on the Scripts tab, filled from the pack's `snippets.json` |
| `themes.extra` | colour themes in Settings → Appearance, from the pack's `themes.json` |
| `codegen.extra` | twelve more languages in the «Code» window (Node, Go, Java, C#, PHP, Ruby, Swift, Kotlin, Rust, PowerShell, HTTPie, wget) |

Snippet and theme packs carry their data next to the manifest; the formats, the
full token list and ready-to-copy examples are in
[`docs/plugin-guide`](../docs/plugin-guide/README.md).

Deleting a folder removes the feature; switching a pack off in
Settings → Plugins hides it until it is enabled again. The enabled/disabled
state is stored per installation, not in this folder.

## Adding a UI language

`extra-languages` reads `locales/<code>.json`. To add one:

1. copy `locales/en.json` from the app's source (or an existing file here),
2. translate the values — the **keys are the Russian source strings** and must
   stay exactly as they are,
3. save it as `locales/<code>.json` (e.g. `it.json`),
4. add the code to `"locales"` in `plugin.json`,
5. restart Relay and pick the language in Settings → General.

Missing keys fall back to English, then to the Russian source, so a partial
catalog is usable from the first line.

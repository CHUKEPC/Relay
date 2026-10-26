# App icons for Relay

*[Русская версия](ICONS.ru.md)*

Settings → Appearance → **App icon** changes the icon of every Relay window, the
taskbar button and the macOS Dock. There are four ways to get one:

| Where | What it is |
|---|---|
| The cards at the top | nine ready-made icons; **Relay** is the original one |
| **Create your own** | an editor: shape, two background colours, a glyph or one or two letters, the glyph colour |
| **Icons from plugins** | the «App icon pack» plugin (18 icons) or a pack of your own (section 4) |
| **My icons** → **Load an icon…** | a picture of your own, or a JSON file describing an icon (sections 2 and 3) |

The choice is kept for the next start. On Windows, **Icon on the Windows
shortcuts** also puts it on the shortcuts of the installed app — the desktop,
the Start menu and the icon pinned to the taskbar (Explorer may take a moment to
redraw them). Picking **Relay** puts the original icon back everywhere.

The file of the app itself (`Relay.exe`, the `.app` bundle) keeps its built-in
icon: that one is part of the installer.

---

## 1. How an icon is built

An icon is drawn, not stored as a picture: a **shape** filled with a **gradient**
(from the top-left corner to the bottom-right one), a faint light rim, and a
**glyph** or **letters** on top — the same build as the original Relay icon.
Relay draws it at 256×256 for the windows and smaller for the cards.

## 2. A picture of your own

**Load an icon…** accepts PNG, JPEG, SVG, WebP, GIF, BMP and ICO. The picture is
fitted into a 256×256 square (centred, transparent around it) and kept as a PNG.
Use a square picture with a transparent background for the best result; an SVG
is rendered once, at 256 px.

## 3. An icon description (JSON)

The same dialog accepts a `.json` file with one icon, a list of icons, or
`{ "icons": [ … ] }`:

```json
{
  "id": "night-shift",
  "name": "Night shift",
  "shape": "circle",
  "background": ["#30333f", "#15161d"],
  "glyph": "terminal",
  "glyphColor": "#5cf08a"
}
```

| Field | Required | Values |
|---|---|---|
| `id` | no (the file name is used) | lowercase letters, digits and `-`, up to 64 characters |
| `name` | no (the file name is used) | up to 40 characters |
| `description` | no | shown as the card's tooltip, up to 200 characters |
| `shape` | no (`squircle`) | `squircle`, `circle`, `square`, `hexagon` |
| `background` | yes | one colour, or a list of 1–3 colours for a gradient |
| `glyph` | no (`bolt`) | `bolt`, `send`, `star`, `braces`, `code`, `terminal`, `arrows`, `globe`, `pulse`, `plug`, `cube`, `flask`, `rocket`, `link`, `letter` |
| `letter` | with `glyph: "letter"` | one or two letters or digits (any alphabet) |
| `glyphColor` | no (`#ffffff`) | a colour |
| `image` | no | instead of a drawing: `data:image/png;base64,…`, up to 400 KB |

Colours are checked like theme colours: `#rgb`, `#rrggbb`, `rgb()`, `hsl()`,
`oklch()` and the other CSS colour functions, or a colour keyword. Anything
else — `url(...)` included — makes the icon invalid, and it is skipped.
An unknown shape or glyph falls back to the Relay one instead.

## 4. An icon pack

A pack is a folder with two files:

```
my-icon-pack/
├── plugin.json
└── icons.json
```

```json
{
  "id": "my-icon-pack",
  "name": "My Icon Pack",
  "description": "Two example app icons.",
  "version": "1.0.0",
  "capabilities": ["icons.extra"]
}
```

`icons.json` holds `{ "icons": [ … ] }` in the format of section 3 (at most 60
icons; their ids are namespaced with the pack id; in a pack `id` and `name` are
required). Add the folder in Settings →
Plugins → **Choose a plugin on this computer…**; its icons appear under **Icons
from plugins**. A ready example lives in
[`docs/plugin-guide/examples/my-icon-pack`](plugin-guide/examples/my-icon-pack),
and the bundled pack in [`plugins/icon-pack`](../plugins/icon-pack). Nothing in
a pack is executed.

An icon picked from a pack keeps working when the pack is switched off: Relay
keeps a copy of it.

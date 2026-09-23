# Writing a theme for Relay

*[Русская версия](THEMES.ru.md)*

A Relay theme is one JSON file. No code runs, nothing is installed: Settings →
Appearance → **My themes** → **Load theme…** reads the file, checks every value
and adds the theme to the list. The same format is what a theme *pack* ships
(`plugins/theme-pack/themes.json`), so a file you write here can later become a
pack without changes.

---

## 1. The shortest theme that works

```json
{
  "id": "midnight",
  "name": "Midnight",
  "description": "Deep blue, low contrast",
  "accent": "#7aa2f7",
  "variants": {
    "dark": {
      "--bg-0": "#0f1016",
      "--bg-1": "#161822",
      "--bg-2": "#1d2030",
      "--tx-0": "#e6e8f0",
      "--tx-2": "#9aa0b4",
      "--line": "#252938"
    }
  }
}
```

Save it as `midnight.json` and load it. That is the whole workflow.

A file may also hold **several** themes, either as a plain list or with the
wrapper a pack uses — all three shapes load:

```json
{ "themes": [ { "id": "one", "name": "One", "variants": { … } },
              { "id": "two", "name": "Two", "variants": { … } } ] }
```

---

## 2. Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase slug (`a-z`, `0-9`, `-`), up to 64 characters, unique. Loading a file with an id you already have **replaces** that theme. |
| `name` | yes | What the swatch says, up to 40 characters. A single-theme file without one borrows the file name. |
| `description` | no | Tooltip on the swatch. |
| `accent` | no | Accent colour. When absent, `--accent` from the variant is used; when that is absent too, the Relay accent stays. |
| `variants.dark` | one of the two | CSS variables applied when the app is in dark mode. |
| `variants.light` | one of the two | The same for light mode. |

A theme with only one variant is fine: the swatch shows a moon or a sun, and
the theme keeps that look no matter what Dark / Light / System is set to. A
theme with both follows the switch.

---

## 3. The variables

Every value is a CSS custom property. These are the ones worth setting; anything
you leave out keeps its Relay value, so a small theme is a valid theme.

**Surfaces**

| Variable | What it paints |
|---|---|
| `--bg-0` | window background, editors |
| `--bg-1` | sidebar, titlebar, panels |
| `--bg-2` | rows, inputs, cards |
| `--bg-3` | raised surfaces (menus, chips) |
| `--bg-hover`, `--bg-active` | hover and pressed states |
| `--line`, `--line-2` | hairlines and borders |
| `--code-bg` | the editor's background |

**Text**

| Variable | What it paints |
|---|---|
| `--tx-0` | headings and primary text |
| `--tx-1` | body text |
| `--tx-2` | secondary text, descriptions |
| `--tx-3` | placeholders, disabled |

**Accent**

| Variable | What it paints |
|---|---|
| `--accent` | buttons, active tab, focus ring |
| `--accent-hover`, `--accent-press` | its two states (derived when absent) |
| `--accent-soft`, `--accent-soft-2` | tinted backgrounds behind the accent |
| `--accent-fg` | text drawn on top of the accent |

**Status and methods** (used by response codes, the console and method chips)

| Variable | What it paints |
|---|---|
| `--s-2xx`, `--s-3xx`, `--s-4xx`, `--s-5xx` | status colours |
| `--m-get`, `--m-post`, `--m-put`, `--m-patch`, `--m-delete`, `--m-head`, `--m-options` | HTTP method colours |
| `--c-key`, `--c-str`, `--c-num`, `--c-bool`, `--c-null`, `--c-punct` | JSON syntax colours |

The code editor follows the theme automatically: its palette is derived from
these tokens, so you never write editor colours by hand. The full list of tokens
a theme may set is whatever `src/renderer/styles/base.css` defines on `:root`.

---

## 4. What values are allowed

A theme is data, not code, so the loader accepts only colour-ish values and
drops everything else:

- hex — `#abc`, `#aabbcc`, `#aabbccdd`
- functional colours — `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`
- the keywords `transparent`, `currentColor`, `inherit`
- plain numbers and simple lengths (`0`, `6px`, `1.5`) for the few non-colour tokens

`url(...)`, `expression(...)`, `@import`, JavaScript, HTML and anything with
`<`, `>` or a semicolon are rejected. A rejected value is simply skipped — the
rest of the theme still loads. If a theme "does not load", one of its values is
usually outside this list.

Not allowed, and worth knowing before you wonder why a value was ignored:
`color-mix()`, `var()`, gradients and any other function outside that list.

Limits: 512 KB per file, 40 themes per file and 60 stored in total, 200
characters per value, 80 variables per variant, 40 characters per name and
200 per description.

---

## 5. Picking the colours without guessing

The fastest loop: open Relay in the look you want to change, open the developer
tools (`Ctrl+Shift+I` in a development build), edit `--bg-0`, `--tx-0` … live on
`<html>`, and copy the values you settled on into the file. Reloading the theme
file replaces the old one in place, so iterating is just "save, load again".

For readable results:

- keep at least 4.5:1 between `--tx-1` and `--bg-0`, and 3:1 between `--tx-2`
  and the surface it sits on;
- keep `--line` close to the surface it separates — a line brighter than the
  text reads as a cage;
- the accent must stay distinguishable against both `--bg-1` and `--bg-2`, since
  the active tab and the primary button sit on different surfaces;
- status colours must stay apart in both modes: green/red at the same lightness
  is unreadable for a large share of users.

The 15 bundled themes in `plugins/theme-pack/themes.json` are a working
reference — Postman, Insomnia, Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox,
Solarized, One Dark, Synthwave '84, Rosé Pine and four originals.

---

## 6. From a file to a pack

To share a set of themes, ship them as a feature pack instead of a file:

```
my-theme-pack/
├── plugin.json     → { "id": "my-theme-pack", "capabilities": ["themes.extra"], … }
└── themes.json     → { "themes": [ … ] }
```

Settings → Plugins → **Choose a plugin on this computer…** installs the folder.
The full pack manifest is documented in the
[plugin authoring guide](plugin-guide/README.md) ([по-русски](plugin-guide/README.ru.md)).

---

## 7. Troubleshooting

| What you see | Why |
|---|---|
| "This is not a JSON file" | Trailing comma, single quotes or a comment — JSON allows none of them. |
| "No theme in a readable format" | `id` missing or not a slug, `name` missing, or `variants` has neither `dark` nor `light`. |
| The theme loads but looks unchanged | The variable names are misspelled; they all start with `--`. |
| Some colours did not apply | Those values were outside the allowlist in §4. |
| The theme disappeared after a restart | It was replaced by another file with the same `id`. |

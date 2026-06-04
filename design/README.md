# design/ — Drop your Claude Design output here

This folder is the **source of truth for look & feel**. The build reads everything here and
reconciles it with the functional spec in [`../docs/FEATURES.md`](../docs/FEATURES.md).

## Best import format (in priority order)

The app is **React + TypeScript + Tailwind CSS**, so the most directly usable exports are:

1. **React + Tailwind components** — `.tsx` / `.jsx` files. **Best possible input.** The build
   will adapt them into `src/renderer/components` and `src/renderer/features` with minimal change.
2. **Design tokens** — colors, typography, spacing, radii, shadows as **CSS variables**
   (`globals.css` with `:root` / `.dark`) and/or a `theme.ts`/`tokens.json`. These drive
   `tailwind.config.ts` and the light/dark themes. Always include these if you have them.
3. **Static HTML + CSS** mockups — usable as structural/styling reference; the build will port
   them to React.
4. **Screenshots / images** — `.png` / `.svg` of full screens. Lowest fidelity (no code), but
   very useful as a visual target for layout and spacing. Include them even if you also have code.

> If you used Claude's artifact/design tooling, export as **React with Tailwind** when offered.
> That is the cleanest path. Export the **whole screens** (request builder, sidebar/collections,
> response viewer, environments, history, settings, and the AI assistant panel), not just isolated
> widgets, so the build understands the full layout.

## Where to put what

```
design/
├── components/   # exported .tsx/.jsx components (buttons, inputs, tabs, panels, modals, ...)
├── screens/      # full-screen layouts as .tsx OR mockup images (.png/.svg) for reference
├── tokens/       # globals.css (CSS variables), theme.ts / tokens.json, tailwind snippets
├── assets/       # icons (.svg), logo, custom fonts, illustrations
└── (this README)
```

Anything is fine — if you only have screenshots, put them in `screens/`. If you only have a token
file, put it in `tokens/`. The build is written to use whatever is present and fall back to a clean
default design system for anything missing.

## Screens the design should ideally cover

- App shell: top bar, left sidebar (Collections), tabbed request area, bottom/side response area.
- Request builder: method selector + URL bar + Send; tabs for Params, Headers, Body, Auth,
  Pre-request/Tests, Settings.
- Response viewer: status/time/size, tabs for Body (pretty/raw/preview), Headers, Cookies, Tests.
- Collections & environments sidebar; environment/variable manager; history list.
- **AI assistant panel** (the differentiator): chat thread, provider/model picker, an input box,
  and message actions (e.g. "apply to request").
- Settings: providers & API keys, theme, request defaults.

## Notes

- Use **CSS variables** for all colors so light/dark theming works automatically.
- If you provide a logo/app icon, drop a square PNG (≥512px) and/or SVG in `assets/`; it will be
  used for the window and the packaged app icon.

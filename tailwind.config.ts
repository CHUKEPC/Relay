import type { Config } from 'tailwindcss'

/**
 * Tailwind is layered on top of the ported Relay design system (see
 * src/renderer/styles/*.css). All colors reference CSS variables so light/dark
 * theming — driven by the `[data-theme]` attribute — works automatically.
 */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'bg-0': 'var(--bg-0)',
        'bg-1': 'var(--bg-1)',
        'bg-2': 'var(--bg-2)',
        'bg-3': 'var(--bg-3)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        'tx-0': 'var(--tx-0)',
        'tx-1': 'var(--tx-1)',
        'tx-2': 'var(--tx-2)',
        'tx-3': 'var(--tx-3)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        'm-get': 'var(--m-get)',
        'm-post': 'var(--m-post)',
        'm-put': 'var(--m-put)',
        'm-patch': 'var(--m-patch)',
        'm-delete': 'var(--m-delete)',
        's-2xx': 'var(--s-2xx)',
        's-3xx': 'var(--s-3xx)',
        's-4xx': 'var(--s-4xx)',
        's-5xx': 'var(--s-5xx)'
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        mono: 'var(--font-mono)'
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)'
      }
    }
  },
  plugins: []
} satisfies Config

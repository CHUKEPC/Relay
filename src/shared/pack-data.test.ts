import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSafeCssValue, parseSnippets, parseThemes, themeVariant } from './pack-data'

const repo = join(__dirname, '..', '..')
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(repo, rel), 'utf8'))

describe('parseSnippets', () => {
  it('keeps valid entries and drops broken ones', () => {
    const list = parseSnippets({
      snippets: [
        { id: 'ok', label: 'Ok', phase: 'test', code: 'pm.test("x", () => {})' },
        { id: 'Bad Id', label: 'x', phase: 'test', code: 'x' },
        { id: 'no-phase', label: 'x', code: 'x' },
        { id: 'ok', label: 'duplicate', phase: 'pre', code: 'x' },
        'not an object'
      ]
    })
    expect(list.map((s) => s.id)).toEqual(['ok'])
    expect(list[0].code.endsWith('\n')).toBe(true)
  })

  it('accepts a bare array', () => {
    expect(parseSnippets([{ id: 'a', label: 'A', phase: 'both', code: 'x\n' }])).toHaveLength(1)
  })
})

describe('parseThemes', () => {
  it('namespaces ids and filters unsafe values', () => {
    const [theme] = parseThemes(
      {
        themes: [
          {
            id: 'night',
            name: 'Night',
            accent: '#123456',
            variants: { dark: { '--bg-0': '#000', '--bg-1': 'url(https://evil.example/x)', 'color': 'red', '--tx-0': 'oklch(0.9 0.01 264)' } }
          }
        ]
      },
      'my-pack'
    )
    expect(theme.id).toBe('my-pack/night')
    expect(theme.variants.dark).toEqual({ '--bg-0': '#000', '--tx-0': 'oklch(0.9 0.01 264)' })
  })

  it('drops a theme without any usable variant', () => {
    expect(parseThemes([{ id: 'x', name: 'X', variants: { dark: { '--bg-0': 'url(x)' } } }], 'p')).toEqual([])
  })

  it('falls back to the only variant a theme has', () => {
    const [theme] = parseThemes([{ id: 'x', name: 'X', variants: { dark: { '--bg-0': '#111' } } }], 'p')
    expect(themeVariant(theme, 'light')).toEqual({ mode: 'dark', vars: { '--bg-0': '#111' } })
    expect(themeVariant(theme, 'dark').mode).toBe('dark')
  })

  it('rejects CSS that could load remote content', () => {
    expect(isSafeCssValue('url(https://x)')).toBe(false)
    expect(isSafeCssValue('expression(alert(1))')).toBe(false)
    expect(isSafeCssValue('rgb(255 255 255 / 0.05)')).toBe(true)
  })
})

describe('bundled script-snippets pack', () => {
  const raw = readJson('plugins/script-snippets/snippets.json') as { snippets: unknown[] }
  const snippets = parseSnippets(raw)

  it('loses no entry to validation', () => {
    expect(snippets).toHaveLength(raw.snippets.length)
    expect(snippets.length).toBeGreaterThan(20)
  })

  it('every snippet is valid JavaScript', () => {
    for (const s of snippets) {
      // Syntax check only — the sandbox is what runs it for real.
      expect(() => new Function('pm', s.code), s.id).not.toThrow()
    }
  })

  it('covers every HTTP method of the base app', () => {
    const code = snippets.map((s) => s.code).join('\n')
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) expect(code).toContain(m)
    expect(snippets.find((s) => s.id === 'status-200')?.code).toContain('pm.response.to.have.status(200)')
  })

  it('only uses pm APIs the sandbox provides', () => {
    const code = snippets.map((s) => s.code).join('\n')
    expect(code).not.toMatch(/pm\.variables\.replaceIn|pm\.request\.body|pm\.execution/)
  })
})

describe('bundled theme-pack', () => {
  const raw = readJson('plugins/theme-pack/themes.json') as { themes: { variants: Record<string, Record<string, string>> }[] }
  const themes = parseThemes(raw, 'theme-pack')

  it('keeps every theme and every value', () => {
    expect(themes).toHaveLength(raw.themes.length)
    raw.themes.forEach((t, i) => {
      for (const mode of ['dark', 'light'] as const) {
        if (t.variants[mode]) expect(Object.keys(themes[i].variants[mode] ?? {})).toHaveLength(Object.keys(t.variants[mode]).length)
      }
    })
  })

  it('carries the Postman and Insomnia looks in both modes', () => {
    for (const id of ['theme-pack/postman', 'theme-pack/insomnia']) {
      const t = themes.find((x) => x.id === id)
      expect(t?.variants.dark?.['--bg-0']).toBeTruthy()
      expect(t?.variants.light?.['--bg-0']).toBeTruthy()
    }
  })

  it('defines the core surface and text tokens in every variant', () => {
    for (const t of themes) {
      for (const vars of Object.values(t.variants)) {
        for (const key of ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--line', '--tx-0', '--tx-1', '--tx-2', '--code-bg']) {
          expect(vars?.[key], `${t.id} ${key}`).toBeTruthy()
        }
      }
    }
  })
})

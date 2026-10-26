import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findIcon, ICON_GLYPHS, ICON_PRESETS, isIconImage, parseIcon, parseIconFile, parseIcons, slugOf } from './app-icon'

const icon = (over: Record<string, unknown> = {}) => ({ id: 'sea', name: 'Sea', shape: 'circle', background: ['#38c6e8', '#1d5fd6'], glyph: 'send', glyphColor: '#fff', ...over })

describe('parseIcon', () => {
  it('takes a drawn icon and namespaces its id', () => {
    expect(parseIcon(icon(), 'pack')).toEqual({
      id: 'pack/sea',
      name: 'Sea',
      description: undefined,
      shape: 'circle',
      background: ['#38c6e8', '#1d5fd6'],
      glyph: 'send',
      glyphColor: '#fff',
      letter: undefined
    })
  })

  it('accepts one background colour as a string and falls back on unknown shapes and glyphs', () => {
    const parsed = parseIcon(icon({ background: 'oklch(0.6 0.2 250)', shape: 'star', glyph: 'unicorn' }), 'p')
    expect(parsed).toMatchObject({ background: ['oklch(0.6 0.2 250)'], shape: 'squircle', glyph: 'bolt' })
  })

  it('drops icons whose colours are not plain colours', () => {
    expect(parseIcon(icon({ background: ['url(https://x)'] }), 'p')).toBeNull()
    expect(parseIcon(icon({ glyphColor: 'expression(alert(1))' }), 'p')).toBeNull()
    expect(parseIcon(icon({ background: [] }), 'p')).toBeNull()
  })

  it('needs one or two letters for the letter glyph', () => {
    expect(parseIcon(icon({ glyph: 'letter', letter: 'Ж' }), 'p')).toMatchObject({ glyph: 'letter', letter: 'Ж' })
    expect(parseIcon(icon({ glyph: 'letter', letter: 'R2' }), 'p')?.letter).toBe('R2')
    expect(parseIcon(icon({ glyph: 'letter', letter: 'ABC' }), 'p')).toBeNull()
    expect(parseIcon(icon({ glyph: 'letter', letter: '<' }), 'p')).toBeNull()
    expect(parseIcon(icon({ glyph: 'letter' }), 'p')).toBeNull()
  })

  it('keeps a picture only as a PNG data URL of sane size', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(parseIcon({ id: 'pic', name: 'Pic', image: png }, 'user')?.image).toBe(png)
    expect(parseIcon({ id: 'pic', name: 'Pic', image: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'user')).toBeNull()
    expect(parseIcon({ id: 'pic', name: 'Pic', image: 'https://example.com/x.png' }, 'user')).toBeNull()
    expect(isIconImage(`data:image/png;base64,${'A'.repeat(500_000)}`)).toBe(false)
  })

  it('rejects bad ids and missing names', () => {
    expect(parseIcon(icon({ id: '../x' }), 'p')).toBeNull()
    expect(parseIcon(icon({ name: '' }), 'p')).toBeNull()
  })
})

describe('parseIcons / parseIconFile', () => {
  it('reads a list or the pack wrapper and skips duplicates', () => {
    expect(parseIcons([icon(), icon(), icon({ id: 'b' })], 'p').map((i) => i.id)).toEqual(['p/sea', 'p/b'])
    expect(parseIcons({ icons: [icon()] }, 'p')).toHaveLength(1)
    expect(parseIcons({ nope: 1 }, 'p')).toEqual([])
  })

  it('reads one icon, a list or the wrapper from a file, borrowing the file name', () => {
    expect(parseIconFile(JSON.stringify(icon()), 'file').icons[0].id).toBe('user/sea')
    const nameless = parseIconFile(JSON.stringify({ background: ['#000'], glyph: 'bolt' }), 'My Icon')
    expect(nameless.icons[0]).toMatchObject({ id: 'user/my-icon', name: 'My Icon' })
    const many = parseIconFile(JSON.stringify([{ background: ['#000'] }, { background: ['#fff'] }]), 'Set')
    expect(many.icons.map((i) => i.id)).toEqual(['user/set-1', 'user/set-2'])
  })

  it('says why a file gave nothing', () => {
    expect(parseIconFile('not json', 'f').error).toBe('not-json')
    expect(parseIconFile(JSON.stringify({ icons: [{ id: 'x' }] }), 'f').error).toBe('no-icons')
    expect(parseIconFile('x'.repeat(600_000), 'f').error).toBe('too-large')
  })

  it('slugs file names', () => {
    expect(slugOf('My Icon.png')).toBe('my-icon')
    expect(slugOf('Иконка.png')).toBe('icon')
  })
})

describe('presets and the bundled icon pack', () => {
  it('the built-in presets are valid icons, the original first', () => {
    expect(ICON_PRESETS[0].id).toBe('relay')
    for (const p of ICON_PRESETS) {
      expect(parseIcon({ ...p, id: p.id }, 'x')).not.toBeNull()
      expect(ICON_GLYPHS[p.glyph]).toBeDefined()
    }
    expect(findIcon('sunset')?.name).toBe('Закат')
    expect(findIcon('pack/a', [{ ...ICON_PRESETS[0], id: 'pack/a' }])?.id).toBe('pack/a')
    expect(findIcon('gone')).toBeNull()
  })

  it('every icon of plugins/icon-pack survives validation', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../plugins/icon-pack/icons.json'), 'utf8')) as { icons: unknown[] }
    const icons = parseIcons(raw, 'icon-pack')
    expect(icons).toHaveLength(raw.icons.length)
    expect(new Set(icons.map((i) => i.glyph)).size).toBeGreaterThan(10)
  })
})

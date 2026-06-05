import { describe, it, expect } from 'vitest'
import { renderTemplate } from './visualizer-template'

describe('renderTemplate — interpolation', () => {
  it('renders a basic interpolation', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!')
  })

  it('renders {{this}} and {{.}} as the current scope', () => {
    expect(renderTemplate('{{this}}', 'x')).toBe('x')
    expect(renderTemplate('{{.}}', 42)).toBe('42')
  })

  it('renders numbers and booleans', () => {
    expect(renderTemplate('{{n}}/{{b}}', { n: 0, b: true })).toBe('0/true')
  })

  it('resolves dotted paths', () => {
    expect(renderTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } })).toBe('deep')
  })

  it('resolves array indices', () => {
    expect(renderTemplate('{{items.0.name}}', { items: [{ name: 'first' }] })).toBe('first')
  })

  it('renders missing paths as empty string', () => {
    expect(renderTemplate('[{{nope}}]', {})).toBe('[]')
    expect(renderTemplate('[{{a.b.c}}]', { a: {} })).toBe('[]')
  })
})

describe('renderTemplate — HTML escaping', () => {
  it('escapes < > & " \' in interpolations', () => {
    const out = renderTemplate('{{v}}', { v: `<script>alert(1)</script>` })
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out).not.toContain('<script>')
  })

  it('escapes quotes and ampersands', () => {
    expect(renderTemplate('{{v}}', { v: `a & "b" 'c'` })).toBe('a &amp; &quot;b&quot; &#39;c&#39;')
  })

  it('does NOT escape triple-stash raw output', () => {
    expect(renderTemplate('{{{v}}}', { v: '<b>bold</b>' })).toBe('<b>bold</b>')
  })
})

describe('renderTemplate — each', () => {
  it('iterates an array of objects with {{this.x}} and {{@index}}', () => {
    const tpl = '{{#each rows}}{{@index}}:{{this.x}};{{/each}}'
    const out = renderTemplate(tpl, { rows: [{ x: 'a' }, { x: 'b' }] })
    expect(out).toBe('0:a;1:b;')
  })

  it('iterates an array of primitives with {{this}}', () => {
    expect(renderTemplate('{{#each xs}}[{{this}}]{{/each}}', { xs: [1, 2, 3] })).toBe('[1][2][3]')
  })

  it('iterates object values exposing {{@key}}', () => {
    const out = renderTemplate('{{#each obj}}{{@key}}={{this}};{{/each}}', { obj: { a: 1, b: 2 } })
    expect(out).toBe('a=1;b=2;')
  })

  it('renders the {{else}} branch for an empty array', () => {
    expect(renderTemplate('{{#each xs}}x{{else}}empty{{/each}}', { xs: [] })).toBe('empty')
  })

  it('supports nested each blocks', () => {
    const tpl = '{{#each groups}}{{#each this}}{{this}},{{/each}}|{{/each}}'
    const out = renderTemplate(tpl, { groups: [[1, 2], [3]] })
    expect(out).toBe('1,2,|3,|')
  })

  it('escapes values produced inside each', () => {
    expect(renderTemplate('{{#each xs}}{{this}}{{/each}}', { xs: ['<i>'] })).toBe('&lt;i&gt;')
  })
})

describe('renderTemplate — if / unless', () => {
  it('renders the if branch when truthy', () => {
    expect(renderTemplate('{{#if ok}}yes{{else}}no{{/if}}', { ok: true })).toBe('yes')
  })

  it('renders the else branch when falsy', () => {
    expect(renderTemplate('{{#if ok}}yes{{else}}no{{/if}}', { ok: 0 })).toBe('no')
    expect(renderTemplate('{{#if ok}}yes{{else}}no{{/if}}', { ok: '' })).toBe('no')
    expect(renderTemplate('{{#if ok}}yes{{else}}no{{/if}}', {})).toBe('no')
  })

  it('treats an empty array as falsy', () => {
    expect(renderTemplate('{{#if xs}}has{{else}}none{{/if}}', { xs: [] })).toBe('none')
  })

  it('renders if with no else and a falsy value as empty', () => {
    expect(renderTemplate('a{{#if ok}}b{{/if}}c', { ok: false })).toBe('ac')
  })

  it('supports nested if blocks', () => {
    const tpl = '{{#if a}}{{#if b}}both{{/if}}{{/if}}'
    expect(renderTemplate(tpl, { a: true, b: true })).toBe('both')
    expect(renderTemplate(tpl, { a: true, b: false })).toBe('')
  })

  it('supports {{#unless}}', () => {
    expect(renderTemplate('{{#unless ok}}hidden{{/unless}}', { ok: false })).toBe('hidden')
    expect(renderTemplate('{{#unless ok}}hidden{{else}}shown{{/unless}}', { ok: true })).toBe('shown')
  })
})

describe('renderTemplate — security', () => {
  it('resolves {{constructor}} to empty string', () => {
    expect(renderTemplate('[{{constructor}}]', {})).toBe('[]')
  })

  it('does not leak via {{__proto__.x}}', () => {
    expect(renderTemplate('[{{__proto__.x}}]', {})).toBe('[]')
  })

  it('does not leak prototype members through dotted paths', () => {
    expect(renderTemplate('[{{a.constructor}}]', { a: { b: 1 } })).toBe('[]')
    expect(renderTemplate('[{{a.__proto__.polluted}}]', { a: {} })).toBe('[]')
  })

  it('does not expose inherited Object.prototype methods', () => {
    expect(renderTemplate('[{{toString}}]', {})).toBe('[]')
    expect(renderTemplate('[{{hasOwnProperty}}]', {})).toBe('[]')
  })

  it('does not expose array .length as a property', () => {
    expect(renderTemplate('[{{xs.length}}]', { xs: [1, 2, 3] })).toBe('[]')
  })

  it('does not execute code in interpolations (no eval)', () => {
    // A path that looks like an expression is just an (unresolved) lookup.
    expect(renderTemplate('{{1+1}}', {})).toBe('')
  })
})

describe('renderTemplate — robustness', () => {
  it('returns empty string for empty template', () => {
    expect(renderTemplate('', { a: 1 })).toBe('')
  })

  it('leaves an unterminated mustache as literal text', () => {
    expect(renderTemplate('a {{ b', { b: 1 })).toBe('a {{ b')
  })

  it('tolerates a dangling close tag', () => {
    expect(renderTemplate('a{{/each}}b', {})).toBe('ab')
  })

  it('renders text with no tags unchanged', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text')
  })

  it('ignores comments', () => {
    expect(renderTemplate('a{{! this is a comment }}b', {})).toBe('ab')
  })
})

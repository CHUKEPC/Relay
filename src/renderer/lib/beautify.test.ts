import { describe, expect, it } from 'vitest'
import { beautify, formatJson, hasLongLine, reindentJson } from './beautify'

describe('formatJson', () => {
  it('formats valid JSON with the serializer', () => {
    expect(formatJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('formats JSON whose values are unquoted {{variables}}', () => {
    const out = formatJson('{"id":{{id}},"n":{{$randomInt}},"name":"{{name}}"}')
    expect(out).toBe('{\n  "id": {{id}},\n  "n": {{$randomInt}},\n  "name": "{{name}}"\n}')
  })

  it('keeps a variable used as a key', () => {
    expect(formatJson('{ {{key}}: 1 }')).toBe('{\n  {{key}}: 1\n}')
  })

  it('re-indents text with a stray closing brace instead of giving up', () => {
    const out = formatJson('{"a":{"b":1}}}')
    expect(out).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n}')
  })

  it('re-indents text with an extra unbalanced object', () => {
    const out = formatJson('{"a":1,{"b":2}}')
    expect(out.split('\n')).toEqual(['{', '  "a": 1,', '  {', '    "b": 2', '  }', '}'])
  })

  it('leaves braces inside strings alone', () => {
    expect(reindentJson('{"t":"a{b}[c],d:e"}')).toBe('{\n  "t": "a{b}[c],d:e"\n}')
  })

  it('keeps comments and trailing commas', () => {
    const out = formatJson('{"a":1, // one\n"b":2,}')
    expect(out).toContain('// one')
    expect(out).toContain('"b": 2,')
  })

  it('keeps empty objects and arrays on one line', () => {
    expect(reindentJson('{"a":{},"b":[ ],{{x}}')).toBe('{\n  "a": {},\n  "b": [],\n  {{x}}')
  })

  it('never loses a character of content', () => {
    const src = '{"x": {{a}} "y" 1 2, "z": [true false]}'
    const strip = (s: string) => s.replace(/\s+/g, '')
    expect(strip(formatJson(src))).toBe(strip(src))
  })

  it('returns blank input as it is', () => {
    expect(beautify('   ', 'json')).toBe('   ')
  })
})

describe('hasLongLine', () => {
  it('spots a long single line', () => {
    expect(hasLongLine('x'.repeat(200))).toBe(true)
    expect(hasLongLine('short\n' + 'y'.repeat(121))).toBe(true)
  })

  it('is false for formatted text', () => {
    expect(hasLongLine('{\n  "a": 1\n}')).toBe(false)
    expect(hasLongLine(('z'.repeat(100) + '\n').repeat(5))).toBe(false)
  })
})

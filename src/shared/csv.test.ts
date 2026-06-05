import { describe, it, expect } from 'vitest'
import { parseCsvRows, parseCsv } from './csv'

describe('parseCsvRows', () => {
  it('parses simple rows', () => {
    expect(parseCsvRows('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ])
  })

  it('handles a quoted field with an embedded comma', () => {
    expect(parseCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('unescapes doubled "" quotes inside a quoted field', () => {
    expect(parseCsvRows('"she said ""hi""",x')).toEqual([['she said "hi"', 'x']])
  })

  it('keeps an embedded newline inside a quoted field', () => {
    expect(parseCsvRows('"line1\nline2",b')).toEqual([['line1\nline2', 'b']])
  })

  it('handles a quoted field containing a CRLF newline', () => {
    expect(parseCsvRows('"a\r\nb",c')).toEqual([['a\r\nb', 'c']])
  })

  it('supports CRLF line endings between rows', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsvRows('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('does not produce a trailing empty row for a final newline', () => {
    expect(parseCsvRows('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('does not produce a trailing empty row for a final CRLF', () => {
    expect(parseCsvRows('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('skips completely empty lines between rows', () => {
    expect(parseCsvRows('a,b\n\n1,2\n\n\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('keeps rows made of empty cells (not blank lines)', () => {
    expect(parseCsvRows('a,b\n,\n1,2')).toEqual([
      ['a', 'b'],
      ['', ''],
      ['1', '2']
    ])
  })

  it('preserves ragged rows with missing and extra cells', () => {
    expect(parseCsvRows('a,b,c\n1\n1,2,3,4')).toEqual([
      ['a', 'b', 'c'],
      ['1'],
      ['1', '2', '3', '4']
    ])
  })

  it('returns [] for empty input', () => {
    expect(parseCsvRows('')).toEqual([])
  })

  it('does best-effort on an unterminated quoted field without crashing', () => {
    expect(parseCsvRows('a,"unterminated\nstill going')).toEqual([['a', 'unterminated\nstill going']])
  })

  it('keeps a trailing empty cell after a comma', () => {
    expect(parseCsvRows('a,')).toEqual([['a', '']])
  })
})

describe('parseCsv', () => {
  it('maps header row to objects', () => {
    expect(parseCsv('name,age\nAlice,30\nBob,25')).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' }
    ])
  })

  it('trims header names', () => {
    expect(parseCsv(' name , age \nAlice,30')).toEqual([{ name: 'Alice', age: '30' }])
  })

  it('fills missing trailing cells with empty strings', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }])
  })

  it('ignores cells beyond the header count', () => {
    expect(parseCsv('a,b\n1,2,3,4')).toEqual([{ a: '1', b: '2' }])
  })

  it('ignores blank lines between data rows', () => {
    expect(parseCsv('a,b\n\n1,2\n\n3,4\n')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' }
    ])
  })

  it('handles quoted values with commas and newlines', () => {
    expect(parseCsv('name,note\n"Doe, John","multi\nline"')).toEqual([
      { name: 'Doe, John', note: 'multi\nline' }
    ])
  })

  it('strips a BOM before reading headers', () => {
    expect(parseCsv('﻿key,val\nx,y')).toEqual([{ key: 'x', val: 'y' }])
  })

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('returns [] when only a header row is present', () => {
    expect(parseCsv('a,b,c')).toEqual([])
  })
})

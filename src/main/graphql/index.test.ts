import { describe, expect, it } from 'vitest'
import { renderTypeRef } from './index'

describe('renderTypeRef', () => {
  it('renders a plain named type', () => {
    expect(renderTypeRef({ kind: 'SCALAR', name: 'String', ofType: null })).toBe('String')
  })

  it('renders NonNull as a trailing !', () => {
    expect(
      renderTypeRef({
        kind: 'NON_NULL',
        name: null,
        ofType: { kind: 'SCALAR', name: 'String', ofType: null }
      })
    ).toBe('String!')
  })

  it('renders List as [...]', () => {
    expect(
      renderTypeRef({
        kind: 'LIST',
        name: null,
        ofType: { kind: 'OBJECT', name: 'User', ofType: null }
      })
    ).toBe('[User]')
  })

  it('renders NonNull list of NonNull objects: [User!]!', () => {
    expect(
      renderTypeRef({
        kind: 'NON_NULL',
        name: null,
        ofType: {
          kind: 'LIST',
          name: null,
          ofType: {
            kind: 'NON_NULL',
            name: null,
            ofType: { kind: 'OBJECT', name: 'User', ofType: null }
          }
        }
      })
    ).toBe('[User!]!')
  })

  it('renders nested lists: [[Int]!]!', () => {
    expect(
      renderTypeRef({
        kind: 'NON_NULL',
        name: null,
        ofType: {
          kind: 'LIST',
          name: null,
          ofType: {
            kind: 'NON_NULL',
            name: null,
            ofType: {
              kind: 'LIST',
              name: null,
              ofType: { kind: 'SCALAR', name: 'Int', ofType: null }
            }
          }
        }
      })
    ).toBe('[[Int]!]!')
  })

  it('returns empty string for null/undefined', () => {
    expect(renderTypeRef(null)).toBe('')
    expect(renderTypeRef(undefined)).toBe('')
  })
})

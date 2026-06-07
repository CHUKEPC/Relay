import { describe, it, expect } from 'vitest'
import {
  resolveString,
  interpolate,
  extractTokens,
  flattenVariables,
  resolveDynamic,
  DYNAMIC_VAR_NAMES
} from './interpolate'
import type { VariableScope } from './types'

const scope: VariableScope = {
  collection: { base_url: 'https://collection.example', shared: 'col' },
  environment: { base_url: 'https://env.example', token: 'abc' },
  global: { base_url: 'https://global.example', region: 'eu' }
}

describe('variable interpolation', () => {
  it('resolves {{var}} tokens', () => {
    expect(interpolate('{{base_url}}/v1', scope)).toBe('https://collection.example/v1')
  })

  it('honors precedence collection > environment > global', () => {
    expect(interpolate('{{base_url}}', scope)).toBe('https://collection.example')
    expect(interpolate('{{token}}', scope)).toBe('abc') // from environment
    expect(interpolate('{{region}}', scope)).toBe('eu') // from global
  })

  it('flags unresolved variables and leaves them literal', () => {
    const r = resolveString('{{missing}}/x', scope)
    expect(r.value).toBe('{{missing}}/x')
    expect(r.unresolved).toContain('missing')
  })

  it('reports the source of each token', () => {
    const r = resolveString('{{shared}}-{{region}}', scope)
    const sources = Object.fromEntries(r.tokens.map((t) => [t.name, t.source]))
    expect(sources.shared).toBe('collection')
    expect(sources.region).toBe('global')
  })

  it('supports dynamic variables', () => {
    expect(interpolate('{{$timestamp}}', scope)).toMatch(/^\d+$/)
    expect(interpolate('{{$guid}}', scope)).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number(interpolate('{{$randomInt}}', scope))).toBeGreaterThanOrEqual(0)
  })

  describe('Postman-compatible dynamic variables', () => {
    it('returns null for unknown $vars and non-$ names', () => {
      expect(resolveDynamic('$totallyMadeUp')).toBeNull()
      expect(resolveDynamic('notDollar')).toBeNull()
    })

    it('is case-insensitive', () => {
      expect(resolveDynamic('$RANDOMINT')).not.toBeNull()
      expect(resolveDynamic('$randomfirstname')).not.toBeNull()
      expect(resolveDynamic('$RandomFullName')).toMatch(/\S+\s\S+/)
    })

    it('every name in DYNAMIC_VAR_NAMES resolves to a non-empty string', () => {
      for (const name of DYNAMIC_VAR_NAMES) {
        const v = resolveDynamic(name)
        expect(v, name).not.toBeNull()
        expect((v as string).length, name).toBeGreaterThan(0)
      }
    })

    it('$randomFirstName / $randomLastName are single tokens', () => {
      expect(interpolate('{{$randomFirstName}}', scope)).toMatch(/^[A-Za-z-]+$/)
      expect(interpolate('{{$randomLastName}}', scope)).toMatch(/^[A-Za-z-]+$/)
    })

    it('$randomFullName has a space', () => {
      expect(interpolate('{{$randomFullName}}', scope)).toMatch(/^\S+\s\S+/)
    })

    it('$randomEmail looks like an email', () => {
      expect(interpolate('{{$randomEmail}}', scope)).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
    })

    it('$randomUserName has no spaces', () => {
      expect(interpolate('{{$randomUserName}}', scope)).toMatch(/^\S+$/)
    })

    it('$randomUrl / $randomDomainName are plausible', () => {
      expect(interpolate('{{$randomUrl}}', scope)).toMatch(/^https?:\/\/[^\s.]+\.[a-z]+$/)
      expect(interpolate('{{$randomDomainName}}', scope)).toMatch(/^[^\s.]+\.[a-z]+$/)
    })

    it('$randomIP is a dotted quad with valid octets', () => {
      const ip = interpolate('{{$randomIP}}', scope)
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
      for (const octet of ip.split('.')) {
        expect(Number(octet)).toBeGreaterThanOrEqual(0)
        expect(Number(octet)).toBeLessThanOrEqual(255)
      }
    })

    it('$randomIPV6 has eight hex groups', () => {
      expect(interpolate('{{$randomIPV6}}', scope)).toMatch(/^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/)
    })

    it('$randomMACAddress is six hex pairs', () => {
      expect(interpolate('{{$randomMACAddress}}', scope)).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/)
    })

    it('$randomHexColor is a #rrggbb hex color', () => {
      expect(interpolate('{{$randomHexColor}}', scope)).toMatch(/^#[0-9a-f]{6}$/)
    })

    it('$randomUserAgent contains Mozilla', () => {
      expect(interpolate('{{$randomUserAgent}}', scope)).toContain('Mozilla')
    })

    it('$randomLatitude / $randomLongitude are in range', () => {
      const lat = Number(interpolate('{{$randomLatitude}}', scope))
      const lon = Number(interpolate('{{$randomLongitude}}', scope))
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
      expect(lon).toBeGreaterThanOrEqual(-180)
      expect(lon).toBeLessThanOrEqual(180)
    })

    it('$randomPhoneNumber and $randomZipCode are digit-shaped', () => {
      expect(interpolate('{{$randomPhoneNumber}}', scope)).toMatch(/^\d{3}-\d{3}-\d{4}$/)
      expect(interpolate('{{$randomZipCode}}', scope)).toMatch(/^\d{5}$/)
    })

    it('$randomCountryCode is two uppercase letters', () => {
      expect(interpolate('{{$randomCountryCode}}', scope)).toMatch(/^[A-Z]{2}$/)
    })

    it('$randomWords has multiple words; $randomLoremSlug is dashed', () => {
      expect(interpolate('{{$randomWords}}', scope).split(' ').length).toBeGreaterThan(1)
      expect(interpolate('{{$randomLoremSlug}}', scope)).toMatch(/^[a-z]+(-[a-z]+)+$/)
    })

    it('$randomLoremSentence ends with a period and starts capitalized', () => {
      expect(interpolate('{{$randomLoremSentence}}', scope)).toMatch(/^[A-Z].*\.$/)
    })

    it('$randomPrice is a 2-decimal number; $randomCurrencyCode is 3 uppercase letters', () => {
      expect(interpolate('{{$randomPrice}}', scope)).toMatch(/^\d+\.\d{2}$/)
      expect(interpolate('{{$randomCurrencyCode}}', scope)).toMatch(/^[A-Z]{3}$/)
    })

    it('$randomCreditCardMask masks all but the last group', () => {
      expect(interpolate('{{$randomCreditCardMask}}', scope)).toMatch(/^\*{4}-\*{4}-\*{4}-\d{4}$/)
    })

    it('$randomCompanyName / $randomProduct are multi-word', () => {
      expect(interpolate('{{$randomCompanyName}}', scope)).toMatch(/\S+\s\S+/)
      expect(interpolate('{{$randomProduct}}', scope)).toMatch(/\S+\s\S+/)
    })

    it('$randomBoolean is true or false', () => {
      expect(['true', 'false']).toContain(interpolate('{{$randomBoolean}}', scope))
    })

    it('datetime variables are parseable Date strings', () => {
      for (const v of ['$randomDatetime', '$randomDateRecent', '$randomDatePast', '$randomDateFuture']) {
        const s = interpolate(`{{${v}}}`, scope)
        expect(Number.isNaN(Date.parse(s)), v).toBe(false)
      }
    })

    it('$randomDatePast is before now and $randomDateFuture is after now', () => {
      expect(Date.parse(interpolate('{{$randomDatePast}}', scope))).toBeLessThan(Date.now())
      expect(Date.parse(interpolate('{{$randomDateFuture}}', scope))).toBeGreaterThan(Date.now())
    })

    it('$randomUUID matches a v4-shaped guid', () => {
      expect(interpolate('{{$randomUUID}}', scope)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('$counter increments', () => {
      const a = Number(interpolate('{{$counter}}', scope))
      const b = Number(interpolate('{{$counter}}', scope))
      expect(b).toBe(a + 1)
    })

    it('there are at least ~40 supported dynamic variables', () => {
      expect(DYNAMIC_VAR_NAMES.length).toBeGreaterThanOrEqual(40)
    })
  })

  it('resolves nested variables', () => {
    const nested: VariableScope = { environment: { a: '{{b}}', b: 'final' } }
    expect(interpolate('{{a}}', nested)).toBe('final')
  })

  it('leaves a self-referential variable literal instead of duplicating it', () => {
    const s: VariableScope = { environment: { a: 'x {{a}} y' } }
    const r = resolveString('{{a}}', s)
    expect(r.value).toBe('x {{a}} y')
    expect(r.unresolved).toContain('a')
  })

  it('detects mutual reference cycles', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: '{{a}}' } }
    const r = resolveString('{{a}}', s)
    expect(r.unresolved.length).toBeGreaterThan(0)
  })

  it('resolves a chain deeper than the old 5-level limit', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: '{{c}}', c: '{{d}}', d: '{{e}}', e: '{{f}}', f: 'DONE' } }
    expect(interpolate('{{a}}', s)).toBe('DONE')
  })

  it('does not treat inherited Object.prototype names as variables (no crash)', () => {
    const s: VariableScope = { environment: { real: 'x' } }
    const r = resolveString('{{constructor}}/{{toString}}/{{__proto__}}', s)
    expect(r.value).toBe('{{constructor}}/{{toString}}/{{__proto__}}')
    expect(r.unresolved).toContain('constructor')
  })

  it('reports the fully resolved value for a nested token', () => {
    const s: VariableScope = { environment: { a: '{{b}}', b: 'final' } }
    const r = resolveString('{{a}}', s)
    expect(r.tokens.find((t) => t.name === 'a')?.value).toBe('final')
  })

  it('extracts token names', () => {
    expect(extractTokens('{{a}}/{{b}}')).toEqual(['a', 'b'])
  })

  it('flattens enabled variables only', () => {
    const flat = flattenVariables([
      { key: 'on', value: '1', enabled: true },
      { key: 'off', value: '2', enabled: false }
    ])
    expect(flat).toEqual({ on: '1' })
  })
})

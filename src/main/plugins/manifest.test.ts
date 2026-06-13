import { describe, it, expect } from 'vitest'
import { isValidPermission, parseManifest } from './manifest'

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'my-plugin', name: 'My Plugin', version: '1.0.0', ...overrides })
}

describe('plugin manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    const res = parseManifest(manifest(), 'my-plugin')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.manifest.id).toBe('my-plugin')
      expect(res.manifest.permissions).toEqual([])
      expect(res.manifest.contributes.buttons).toEqual([])
      expect(res.manifest.config).toEqual([])
    }
  })

  it('rejects invalid JSON and non-objects', () => {
    expect(parseManifest('{oops', 'my-plugin').ok).toBe(false)
    expect(parseManifest('"str"', 'my-plugin').ok).toBe(false)
    expect(parseManifest('[1]', 'my-plugin').ok).toBe(false)
  })

  it('binds the id to the folder name (anti-impersonation)', () => {
    const res = parseManifest(manifest(), 'other-folder')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('folder')
  })

  it('rejects bad ids and versions', () => {
    expect(parseManifest(manifest({ id: 'Bad_ID' }), 'Bad_ID').ok).toBe(false)
    expect(parseManifest(manifest({ id: 'x' }), 'x').ok).toBe(false)
    expect(parseManifest(manifest({ version: 'one' }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ version: '1.2' }), 'my-plugin').ok).toBe(false)
  })

  it('rejects unknown permissions, accepts net scoping', () => {
    expect(parseManifest(manifest({ permissions: ['fs'] }), 'my-plugin').ok).toBe(false)
    const res = parseManifest(
      manifest({ permissions: ['net', 'net:hooks.example.com', 'net:*.internal', 'response:read'] }),
      'my-plugin'
    )
    expect(res.ok).toBe(true)
  })

  it('keeps main confined to the plugin folder', () => {
    expect(parseManifest(manifest({ main: '../escape.js' }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ main: 'sub/dir.js' }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ main: 'handlers.js' }), 'my-plugin').ok).toBe(true)
  })

  it('validates button contributions', () => {
    const ok = parseManifest(
      manifest({ contributes: { buttons: [{ id: 'go', label: 'Go', location: 'response-toolbar' }] } }),
      'my-plugin'
    )
    expect(ok.ok).toBe(true)
    const badLoc = parseManifest(
      manifest({ contributes: { buttons: [{ id: 'go', label: 'Go', location: 'menu' }] } }),
      'my-plugin'
    )
    expect(badLoc.ok).toBe(false)
    const dupe = parseManifest(
      manifest({
        contributes: {
          buttons: [
            { id: 'go', label: 'A', location: 'response-toolbar' },
            { id: 'go', label: 'B', location: 'response-toolbar' }
          ]
        }
      }),
      'my-plugin'
    )
    expect(dupe.ok).toBe(false)
  })

  it('filters theme vars to -- custom properties with color-shaped values', () => {
    const res = parseManifest(
      manifest({
        contributes: {
          themes: [
            {
              id: 't',
              label: 'T',
              base: 'dark',
              vars: {
                '--accent': '#fff',
                '--soft': 'rgba(34, 197, 94, 0.12)',
                '--word': 'transparent',
                'color': 'red',
                '--x': 42,
                '--evil': 'url(https://attacker.test/beacon)',
                '--also-evil': 'var(--accent), url(/x)'
              }
            }
          ]
        }
      }),
      'my-plugin'
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.manifest.contributes.themes?.[0].vars).toEqual({
        '--accent': '#fff',
        '--soft': 'rgba(34, 197, 94, 0.12)',
        '--word': 'transparent'
      })
    }
  })

  it('rejects unknown events and accepts response', () => {
    expect(parseManifest(manifest({ contributes: { events: ['boot'] } }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ contributes: { events: ['response'] } }), 'my-plugin').ok).toBe(true)
  })

  it('validates config fields', () => {
    const res = parseManifest(
      manifest({ config: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'string' }] }),
      'my-plugin'
    )
    expect(res.ok).toBe(true)
    expect(parseManifest(manifest({ config: [{ key: '1bad', label: 'X' }] }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ config: [{ key: 'k', label: 'X', type: 'json' }] }), 'my-plugin').ok).toBe(false)
  })

  it("accepts config type 'secret'", () => {
    const res = parseManifest(manifest({ config: [{ key: 'token', label: 'Token', type: 'secret' }] }), 'my-plugin')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.manifest.config[0].type).toBe('secret')
  })

  it('validates apiVersion (defaults to 1, rejects future/invalid)', () => {
    const def = parseManifest(manifest(), 'my-plugin')
    expect(def.ok).toBe(true)
    if (def.ok) expect(def.manifest.apiVersion).toBe(1)
    expect(parseManifest(manifest({ apiVersion: 1 }), 'my-plugin').ok).toBe(true)
    expect(parseManifest(manifest({ apiVersion: 99 }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ apiVersion: 0 }), 'my-plugin').ok).toBe(false)
    expect(parseManifest(manifest({ apiVersion: '1' }), 'my-plugin').ok).toBe(false)
  })

  it('accepts P2 permissions, commands, interactive panels, lifecycle events and i18n', () => {
    const res = parseManifest(
      manifest({
        permissions: ['clipboard', 'history:read'],
        contributes: {
          commands: [{ id: 'go', title: 'Go' }],
          panels: [{ id: 'p', label: 'P', location: 'response-tab', interactive: true }],
          events: ['workspace', 'collection']
        },
        i18n: { ru: { greet: 'Привет' } },
        config: [{ key: 'k', label: '%greet%' }]
      }),
      'my-plugin'
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.manifest.contributes.commands?.[0].id).toBe('go')
      expect(res.manifest.contributes.panels?.[0].interactive).toBe(true)
      // %greet% resolved against the default (ru) locale.
      expect(res.manifest.config[0].label).toBe('Привет')
    }
  })

  it('rejects duplicate command ids', () => {
    const res = parseManifest(
      manifest({ contributes: { commands: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] } }),
      'my-plugin'
    )
    expect(res.ok).toBe(false)
  })

  it('accepts the new permissions and button/panel locations', () => {
    const res = parseManifest(
      manifest({
        permissions: ['storage', 'request:write'],
        contributes: {
          buttons: [{ id: 'a', label: 'A', location: 'titlebar' }],
          panels: [{ id: 'p', label: 'P', location: 'response-tab' }],
          events: ['request']
        }
      }),
      'my-plugin'
    )
    expect(res.ok).toBe(true)
  })

  it("requires request:write for the 'request' event", () => {
    const res = parseManifest(manifest({ contributes: { events: ['request'] } }), 'my-plugin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('request:write')
  })

  it('rejects unknown panel locations', () => {
    const res = parseManifest(
      manifest({ contributes: { panels: [{ id: 'p', label: 'P', location: 'sidebar' }] } }),
      'my-plugin'
    )
    expect(res.ok).toBe(false)
  })

  it('validates permission strings standalone', () => {
    expect(isValidPermission('net')).toBe(true)
    expect(isValidPermission('net:example.com')).toBe(true)
    expect(isValidPermission('net:*.corp.local:8443')).toBe(true)
    expect(isValidPermission('net:')).toBe(false)
    expect(isValidPermission('request:write')).toBe(true)
    expect(isValidPermission('storage')).toBe(true)
    expect(isValidPermission('request:delete')).toBe(false)
    expect(isValidPermission(42)).toBe(false)
  })
})

/**
 * The example plugins in docs/plugin-guide/examples are what people copy to
 * start their own — they must stay valid and actually work. Code plugins go
 * through the real manifest validator and sandbox; packs through the pack
 * validator and data parsers.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'
import { runPluginEvent } from './sandbox'
import { validateManifest } from '../features/pack-source'
import { parseSnippets, parseThemes } from '@shared/pack-data'
import type { PluginRunRequest } from '@shared/types'

const dir = join(__dirname, '..', '..', '..', 'docs', 'plugin-guide', 'examples')
const read = (id: string, file: string): string => readFileSync(join(dir, id, file), 'utf8')

function manifestOf(id: string) {
  const res = parseManifest(read(id, 'plugin.json'), id)
  if ('error' in res && res.error) throw new Error(`${id}: ${res.error}`)
  return res
}

const run = (id: string, partial: Partial<PluginRunRequest>) =>
  runPluginEvent({
    pluginId: id,
    code: read(id, 'main.js'),
    permissions: [],
    config: {},
    storage: {},
    event: { type: 'button', buttonId: 'x' },
    context: {},
    ...partial
  })

describe('plugin guide examples', () => {
  it('hello-toast shows a toast on its button', async () => {
    manifestOf('hello-toast')
    const res = await run('hello-toast', { event: { type: 'button', buttonId: 'hello' } })
    expect(res.error).toBeUndefined()
    expect(res.toast).toEqual({ message: 'Привет из плагина!', kind: 'ok' })
  })

  it('response-inspector renders a summary panel', async () => {
    manifestOf('response-inspector')
    const res = await run('response-inspector', {
      permissions: ['response:read'],
      event: { type: 'panel', panelId: 'summary' },
      context: {
        response: {
          status: 201,
          statusText: 'Created',
          headers: [['location', '/items/1'], ['content-type', 'application/json']],
          contentType: 'application/json',
          sizeBytes: 12,
          timeMs: 34,
          finalUrl: 'https://x/items'
        }
      }
    })
    expect(res.error).toBeUndefined()
    expect(res.panelHtml).toContain('201 Created')
    expect(res.panelHtml).toContain('/items/1')
  })

  it('request-id adds its header before send', async () => {
    const m = manifestOf('request-id')
    expect(JSON.stringify(m)).toContain('request:write')
    const res = await run('request-id', { permissions: ['request:write'], event: { type: 'request' }, config: { headerName: 'X-Trace' } })
    expect(res.error).toBeUndefined()
    expect(JSON.stringify(res.requestPatch)).toMatch(/X-Trace/)
  })

  it('my-theme-pack is a valid theme pack', () => {
    expect(validateManifest(join(dir, 'my-theme-pack'))).toMatchObject({ id: 'my-theme-pack' })
    const themes = parseThemes(JSON.parse(read('my-theme-pack', 'themes.json')), 'my-theme-pack')
    expect(themes.map((t) => t.id)).toEqual(['my-theme-pack/mint', 'my-theme-pack/paper'])
    expect(Object.keys(themes[0].variants.dark ?? {})).toHaveLength(20)
  })

  it('my-snippets is a valid snippet pack', () => {
    expect(validateManifest(join(dir, 'my-snippets'))).toMatchObject({ id: 'my-snippets' })
    const snippets = parseSnippets(JSON.parse(read('my-snippets', 'snippets.json')))
    expect(snippets).toHaveLength(2)
    for (const s of snippets) expect(() => new Function('pm', s.code)).not.toThrow()
  })
})

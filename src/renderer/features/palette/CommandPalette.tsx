import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionNode, RequestModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { sendActiveRequest } from '@renderer/lib/request-runner'

interface Item {
  id: string
  title: string
  desc?: string
  icon: string
  method?: string
  kbd?: string[]
  run: () => void
}

function flattenRequests(nodes: CollectionNode[], path: string[], out: { req: RequestModel; path: string }[]) {
  for (const n of nodes) {
    if (n.type === 'request') out.push({ req: n.request, path: path.join(' / ') })
    else flattenRequests(n.children, [...path, n.name], out)
  }
}

export function CommandPalette() {
  const close = () => useUi.getState().setPaletteOpen(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const collections = useCollections((s) => s.doc.collections)
  const environments = useEnvironments((s) => s.env.environments)
  const openSaved = useTabs((s) => s.openSaved)
  const openNew = useTabs((s) => s.openNew)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const groups = useMemo(() => {
    const reqItems: { req: RequestModel; path: string }[] = []
    flattenRequests(collections, [], reqItems)
    const requests: Item[] = reqItems.map((r) => ({
      id: r.req.id,
      title: r.req.name,
      desc: r.path,
      icon: 'doc',
      method: r.req.method,
      run: () => openSaved(r.req, r.req.id)
    }))
    const actions: Item[] = [
      { id: 'new', title: 'Новый запрос', icon: 'plus', kbd: ['⌘', 'N'], run: () => openNew() },
      { id: 'send', title: 'Отправить текущий запрос', icon: 'send', kbd: ['⌘', '↵'], run: () => void sendActiveRequest() },
      { id: 'ai', title: 'Открыть AI-ассистента', icon: 'sparkle', kbd: ['⌘', 'J'], run: () => useUi.getState().setAiOpen(true) },
      { id: 'settings', title: 'Открыть настройки', icon: 'settings', kbd: ['⌘', ','], run: () => useUi.getState().openSettings() },
      { id: 'theme', title: 'Переключить тему', icon: 'moon', run: () => {
        const cur = useSettings.getState().resolvedTheme
        useSettings.getState().setTheme(cur === 'dark' ? 'light' : 'dark')
      } }
    ]
    const envs: Item[] = environments.map((e) => ({
      id: `env-${e.id}`,
      title: `Перейти в ${e.name}`,
      desc: 'Окружение',
      icon: 'env',
      run: () => useEnvironments.getState().setActiveEnv(e.id)
    }))
    return [
      { label: 'Запросы', items: requests },
      { label: 'Действия', items: actions },
      { label: 'Среды', items: envs }
    ]
  }, [collections, environments, openSaved, openNew])

  const filtered = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => `${it.title} ${it.desc ?? ''} ${it.method ?? ''}`.toLowerCase().includes(q.toLowerCase())) }))
    .filter((g) => g.items.length)
  const flat = filtered.flatMap((g) => g.items)
  const clampedSel = Math.min(sel, Math.max(0, flat.length - 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => Math.min(s + 1, flat.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const it = flat[clampedSel]
        if (it) {
          it.run()
          close()
        }
      } else if (e.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, clampedSel])

  let runningIndex = -1
  return (
    <div className="palette-scrim" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            placeholder="Поиск запросов и действий…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list">
          {flat.length === 0 && <div style={{ padding: 26, textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>Ничего не найдено</div>}
          {filtered.map((g) => (
            <div key={g.label}>
              <div className="pal-group-label">{g.label}</div>
              {g.items.map((it) => {
                runningIndex++
                const isSel = runningIndex === clampedSel
                const idx = runningIndex
                return (
                  <div
                    key={it.id}
                    className={`pal-item ${isSel ? 'sel' : ''}`}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => {
                      it.run()
                      close()
                    }}
                  >
                    <div className="pal-ico">
                      <Icon name={it.icon} size={15} />
                    </div>
                    <div className="pal-text">
                      <div className="pal-title">
                        {it.method && <span className={`mt m-${it.method}`}>{it.method}</span>}
                        {it.title}
                      </div>
                      {it.desc && <div className="pal-desc">{it.desc}</div>}
                    </div>
                    {it.kbd && (
                      <div style={{ display: 'flex', gap: 3 }}>
                        {it.kbd.map((k, j) => (
                          <span key={j} className="kbd">
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="pal-foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>
            навигация
          </span>
          <span>
            <span className="kbd">↵</span>
            выбрать
          </span>
          <div className="grow" />
          <span>
            <Icon name="bolt" size={12} />
            Relay
          </span>
        </div>
      </div>
    </div>
  )
}

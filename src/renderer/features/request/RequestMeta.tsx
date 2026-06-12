import { useEffect, useMemo, useRef, useState } from 'react'
import type { RequestModel, TabModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useTabs } from '@renderer/store/tabs'
import { debounce } from '@renderer/lib/debounce'
import '@renderer/styles/feat-reqmeta.css'

/** Max textarea height (~8 rows at 18px line-height + vertical padding). */
const DESC_MAX_HEIGHT = 160

// Module-level debounced commit. Captures tabId per call, so a pending commit
// still lands on the tab it was typed into even if the user switches tabs.
const commitDescription = debounce((tabId: string, description: string) => {
  useTabs.getState().patchTab(tabId, { description })
}, 400)

/**
 * Postman-style request meta row: inline-editable request name (with dirty dot)
 * on the left, a «Описание» toggle on the right revealing an autosizing
 * description textarea. Rendered as the first row of the request builder.
 */
export function RequestMeta({ tab }: { tab: TabModel }): JSX.Element {
  const req = tab.request
  const patch = (p: Partial<RequestModel>) => useTabs.getState().patchTab(tab.id, p)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(req.name)
  const [desc, setDesc] = useState(req.description ?? '')
  // Auto-expand on mount when a description already exists.
  const [descOpen, setDescOpen] = useState(() => !!req.description?.trim())
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Reset local edit state when this component starts showing another tab
  // (the builder is not remounted per tab).
  useEffect(() => {
    setEditing(false)
    setDraft(req.name)
    setDesc(req.description ?? '')
    setDescOpen(!!req.description?.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Adopt external description changes (AI patch, save-as) while not typing.
  useEffect(() => {
    if (document.activeElement !== taRef.current) setDesc(req.description ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.description])

  const autosize = useMemo(
    () => () => {
      const el = taRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, DESC_MAX_HEIGHT)}px`
    },
    []
  )
  useEffect(autosize, [desc, descOpen, autosize])

  const startEdit = () => {
    setDraft(req.name)
    setEditing(true)
  }

  const commitName = () => {
    setEditing(false)
    const name = draft.trim()
    if (name !== req.name) patch({ name })
  }

  const cancelEdit = () => {
    setDraft(req.name)
    setEditing(false)
  }

  const onDescChange = (value: string) => {
    setDesc(value)
    commitDescription(tab.id, value)
  }

  return (
    <div className="reqmeta">
      <div className="reqmeta-row">
        {editing ? (
          <input
            className="reqmeta-input"
            autoFocus
            value={draft}
            placeholder="Без названия"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'Escape') cancelEdit()
            }}
          />
        ) : (
          <>
            <span
              className={`reqmeta-name ${req.name.trim() ? '' : 'placeholder'}`}
              title="Нажмите, чтобы переименовать"
              onClick={startEdit}
            >
              {req.name.trim() || 'Без названия'}
            </span>
            <button className="icon-btn reqmeta-edit" title="Переименовать" onClick={startEdit}>
              <Icon name="pencil" size={13} />
            </button>
          </>
        )}
        {tab.dirty && <span className="reqmeta-dirty" title="Есть несохранённые изменения" />}
        <button
          className={`btn ghost reqmeta-desc-btn ${descOpen ? 'on' : ''}`}
          onClick={() => setDescOpen((v) => !v)}
          title="Описание запроса"
        >
          Описание
          <Icon name={descOpen ? 'chevD' : 'chevR'} size={13} />
        </button>
      </div>
      {descOpen && (
        <div className="reqmeta-desc">
          <textarea
            ref={taRef}
            rows={3}
            value={desc}
            spellCheck={false}
            placeholder="Описание запроса — попадает в экспорт и видно команде…"
            onChange={(e) => onDescChange(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}

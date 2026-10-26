import { useRef } from 'react'
import type { FolderTarget } from '@renderer/lib/copy-target'
import { tr } from '@renderer/lib/i18n'
import '@renderer/styles/feat-copy.css'

export type NameMode = 'copy' | 'own'

/**
 * «Save as “Name (копия)”» or one's own name. Typing in the field picks the
 * second option; an empty own name falls back to the offered one.
 */
export function NameChoice({
  suggested,
  mode,
  onMode,
  own,
  onOwn,
  onEnter
}: {
  suggested: string
  mode: NameMode
  onMode: (m: NameMode) => void
  own: string
  onOwn: (v: string) => void
  onEnter: () => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="name-choice" role="radiogroup" aria-label={tr('Название')}>
      <label className={`nc-opt${mode === 'copy' ? ' on' : ''}`}>
        <input type="radio" name="name-choice" checked={mode === 'copy'} autoFocus={mode === 'copy'} onChange={() => onMode('copy')} onKeyDown={(e) => e.key === 'Enter' && onEnter()} />
        <span className="nc-text">
          {tr('Сохранить как')} <b className="nc-name">«{suggested}»</b>
        </span>
      </label>
      <label className={`nc-opt${mode === 'own' ? ' on' : ''}`}>
        <input
          type="radio"
          name="name-choice"
          checked={mode === 'own'}
          onChange={() => {
            onMode('own')
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        />
        <span className="nc-text">{tr('Своё название')}</span>
      </label>
      <input
        ref={inputRef}
        className="input nc-own"
        value={own}
        placeholder={suggested}
        aria-label={tr('Своё название')}
        onFocus={() => onMode('own')}
        onChange={(e) => {
          onOwn(e.target.value)
          onMode('own')
        }}
        onKeyDown={(e) => e.key === 'Enter' && onEnter()}
      />
    </div>
  )
}

/** A flat, indented list of collections and folders; `extra` options go first. */
export function FolderSelect({
  targets,
  value,
  onChange,
  extra = []
}: {
  targets: FolderTarget[]
  value: string
  onChange: (id: string) => void
  extra?: { id: string; label: string }[]
}): JSX.Element {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: 'var(--font-ui)' }} aria-label={tr('Куда сохранить')}>
      {extra.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  )
}

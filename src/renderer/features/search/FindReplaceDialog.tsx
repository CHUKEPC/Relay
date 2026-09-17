import { useEffect, useMemo, useRef } from 'react'
import { Modal } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { FIND_AREAS, previewOf, type Hit } from '@renderer/lib/find-replace'
import { useFindReplace } from '@renderer/store/find-replace'
import { tr, trf, trp } from '@renderer/lib/i18n'
import '@renderer/styles/feat-find.css'

const SCOPES: { id: 'collections' | 'environments' | 'globals'; label: string }[] = [
  { id: 'collections', label: 'Коллекции' },
  { id: 'environments', label: 'Окружения' },
  { id: 'globals', label: 'Глобальные' }
]

/** One result row: what was found, where, and whether it takes part in a replace. */
function HitRow({ hit, checked }: { hit: Hit; checked: boolean }): JSX.Element {
  // Selected one by one: a selector returning a fresh object re-renders forever.
  const query = useFindReplace((s) => s.query)
  const matchCase = useFindReplace((s) => s.matchCase)
  const wholeWord = useFindReplace((s) => s.wholeWord)
  const useRegex = useFindReplace((s) => s.useRegex)
  const replacement = useFindReplace((s) => s.replacement)
  const preview = useMemo(
    () => previewOf(hit, { query, matchCase, wholeWord, useRegex, areas: [] }),
    [hit, query, matchCase, wholeWord, useRegex]
  )

  return (
    <label className={`find-hit${checked ? '' : ' off'}`}>
      <input type="checkbox" checked={checked} onChange={() => useFindReplace.getState().toggleHit(hit.id)} />
      <div className="find-hit-body">
        <div className="find-hit-head">
          <span className="find-hit-where">{hit.field.ownerPath}</span>
          <span className="find-hit-field">{tr(hit.field.label)}</span>
          {hit.count > 1 && <span className="find-hit-count">{trf('×{n}', { n: hit.count })}</span>}
        </div>
        <div className="find-hit-line mono">
          <span className="ctx">{preview.before}</span>
          <mark>{preview.match}</mark>
          {replacement && <ins>{replacement}</ins>}
          <span className="ctx">{preview.after}</span>
        </div>
      </div>
    </label>
  )
}

export function FindReplaceDialog(): JSX.Element | null {
  const open = useFindReplace((s) => s.open)
  const query = useFindReplace((s) => s.query)
  const replacement = useFindReplace((s) => s.replacement)
  const hits = useFindReplace((s) => s.hits)
  const selected = useFindReplace((s) => s.selected)
  const areas = useFindReplace((s) => s.areas)
  const scopes = useFindReplace((s) => s.scopes)
  const badPattern = useFindReplace((s) => s.badPattern)
  const searched = useFindReplace((s) => s.searched)
  const matchCase = useFindReplace((s) => s.matchCase)
  const wholeWord = useFindReplace((s) => s.wholeWord)
  const useRegex = useFindReplace((s) => s.useRegex)
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-run on every keystroke, but not on every keystroke's render.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => useFindReplace.getState().run(), 180)
    return () => clearTimeout(t)
  }, [open, query, replacement])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const total = hits.reduce((n, h) => n + h.count, 0)
  const selectedCount = hits.filter((h) => selected.has(h.id)).length
  const close = () => useFindReplace.getState().close()

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} width={760} title={tr('Найти и заменить')}>
      <div className="find-fields">
        <div className="side-search find-input">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            placeholder={tr('Найти в коллекциях, окружениях и переменных…')}
            value={query}
            onChange={(e) => useFindReplace.getState().setQuery(e.target.value)}
          />
          <button
            className={`find-flag${matchCase ? ' on' : ''}`}
            title={tr('Учитывать регистр')}
            onClick={() => useFindReplace.getState().toggleFlag('matchCase')}
          >
            Aa
          </button>
          <button
            className={`find-flag${wholeWord ? ' on' : ''}`}
            title={tr('Слово целиком')}
            onClick={() => useFindReplace.getState().toggleFlag('wholeWord')}
          >
            ab
          </button>
          <button
            className={`find-flag${useRegex ? ' on' : ''}`}
            title={tr('Регулярное выражение')}
            onClick={() => useFindReplace.getState().toggleFlag('useRegex')}
          >
            .*
          </button>
        </div>
        <div className="side-search find-input">
          <Icon name="pencil" size={13} />
          <input
            placeholder={tr('Заменить на…')}
            value={replacement}
            onChange={(e) => useFindReplace.getState().setReplacement(e.target.value)}
          />
        </div>
      </div>

      <div className="find-filters">
        <span className="find-filter-label">{tr('Где искать')}</span>
        {SCOPES.map((s) => (
          <button
            key={s.id}
            className={`chip find-chip${scopes[s.id] ? ' on' : ''}`}
            onClick={() => useFindReplace.getState().toggleScope(s.id)}
          >
            {tr(s.label)}
          </button>
        ))}
      </div>
      <div className="find-filters">
        <span className="find-filter-label">{tr('Поля')}</span>
        {FIND_AREAS.map((a) => (
          <button
            key={a.id}
            className={`chip find-chip${areas.includes(a.id) ? ' on' : ''}`}
            onClick={() => useFindReplace.getState().toggleArea(a.id)}
          >
            {tr(a.label)}
          </button>
        ))}
      </div>

      <div className="find-summary">
        {badPattern ? (
          <span className="find-bad">{tr('Неверное регулярное выражение')}</span>
        ) : hits.length ? (
          <>
            <span>
              {trf(trp(total, 'Найдено {n} совпадение', 'Найдено {n} совпадения', 'Найдено {n} совпадений'), { n: total })}
              {' · '}
              {trf(trp(hits.length, '{n} поле', '{n} поля', '{n} полей'), { n: hits.length })}
            </span>
            <button className="btn ghost find-selall" onClick={() => useFindReplace.getState().selectAll(selectedCount !== hits.length)}>
              {selectedCount === hits.length ? tr('Снять все') : tr('Выбрать все')}
            </button>
          </>
        ) : searched ? (
          <span className="find-empty">{tr('Ничего не найдено')}</span>
        ) : (
          <span className="find-empty">{tr('Поиск идёт по названиям, URL, параметрам, заголовкам, телу, скриптам и переменным.')}</span>
        )}
      </div>

      <div className="find-results">
        {hits.map((hit) => (
          <HitRow key={hit.id} hit={hit} checked={selected.has(hit.id)} />
        ))}
      </div>

      <div className="modal-foot">
        <button className="btn ghost" onClick={close}>
          {tr('Закрыть')}
        </button>
        <button
          className="btn primary"
          disabled={!selectedCount || !replacement}
          title={!replacement ? tr('Введите текст замены') : undefined}
          onClick={() => useFindReplace.getState().replaceSelected()}
        >
          <Icon name="check" size={13} /> {trf('Заменить ({n})', { n: selectedCount })}
        </button>
      </div>
    </Modal>
  )
}

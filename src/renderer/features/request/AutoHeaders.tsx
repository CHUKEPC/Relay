import { useMemo } from 'react'
import type { RequestModel, VariableScope } from '@shared/types'
import { autoHeadersFor, disabledAutoHeaders, type AutoHeader } from '@shared/auto-headers'
import { interpolate } from '@shared/interpolate'
import { Checkbox } from '@renderer/components/KVTable'
import { Icon } from '@renderer/components/Icon'
import { useUi } from '@renderer/store/ui'
import { tr } from '@renderer/lib/i18n'

/** Eye toggle in the Headers toolbar: shows or hides the automatic headers. */
export function AutoHeadersToggle({ req }: { req: RequestModel }) {
  const shown = useUi((s) => s.showAutoHeaders)
  const count = useMemo(() => autoHeadersFor(req).length, [req])
  const off = req.disabledAutoHeaders?.length ?? 0
  return (
    <button
      type="button"
      className={`btn ghost kv-auto-toggle ${shown ? 'on' : ''}`}
      onClick={() => useUi.getState().setShowAutoHeaders(!shown)}
      title={shown ? tr('Скрыть автоматические заголовки') : tr('Показать автоматические заголовки')}
      aria-pressed={shown}
    >
      <Icon name={shown ? 'eye' : 'eyeOff'} size={14} />
      {tr('Автоматические')}
      <span className="kv-auto-count">{off ? `${count - off}/${count}` : count}</span>
    </button>
  )
}

/**
 * The headers Relay adds by itself, as rows above the request's own headers.
 * Unticking one stores it in `req.disabledAutoHeaders`, and the engine then
 * leaves it out. Headers HTTP cannot do without (Host, Content-Length, the
 * multipart Content-Type) stay ticked.
 */
export function AutoHeaderRows({
  req,
  scope,
  onChange
}: {
  req: RequestModel
  scope: VariableScope
  onChange: (disabled: string[] | undefined) => void
}) {
  const shown = useUi((s) => s.showAutoHeaders)
  const rows = useMemo(() => {
    let url = req.url
    try {
      url = interpolate(req.url, scope)
    } catch {
      // an unresolvable URL just shows no host
    }
    return autoHeadersFor({ url, body: req.body, headers: req.headers })
  }, [req.url, req.body, req.headers, scope])
  if (!shown) return null
  const disabled = disabledAutoHeaders(req.disabledAutoHeaders)
  const toggle = (h: AutoHeader) => {
    const next = new Set(disabled)
    if (next.has(h.key)) next.delete(h.key)
    else next.add(h.key)
    onChange(next.size ? [...next] : undefined)
  }
  return (
    <>
      {rows.map((h) => {
        const on = h.locked || !disabled.has(h.key)
        const title = h.locked
          ? tr('Обязателен по протоколу HTTP — отключить нельзя')
          : h.overridden
            ? tr('Заменён заголовком с тем же именем ниже')
            : on
              ? tr('Отправляется — снимите галочку, чтобы не отправлять')
              : tr('Не отправляется')
        return (
          <div
            key={h.key}
            className={`kv-row kv-auto ${on ? '' : 'off'} ${h.overridden ? 'overridden' : ''}`}
            style={{ gridTemplateColumns: '26px 1fr 1.3fr 28px' }}
            title={title}
          >
            <Checkbox on={on} disabled={h.locked} onClick={() => toggle(h)} title={title} />
            <div className="kv-cell k">
              <input value={h.name} readOnly tabIndex={-1} />
            </div>
            <div className="kv-cell">
              <input value={h.value ?? autoValueHint(h)} readOnly tabIndex={-1} className={h.value === null ? 'hint' : ''} />
            </div>
            <span className="kv-auto-mark">
              {h.locked ? <Icon name="lock" size={12} /> : h.overridden ? <Icon name="pencil" size={12} /> : null}
            </span>
          </div>
        )
      })}
    </>
  )
}

function autoValueHint(h: AutoHeader): string {
  switch (h.key) {
    case 'host':
      return tr('из URL')
    case 'content-length':
      return tr('вычисляется при отправке')
    case 'cookie':
      return tr('из хранилища cookie, если есть')
    default:
      return ''
  }
}

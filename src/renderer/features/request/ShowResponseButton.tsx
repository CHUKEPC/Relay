import { useContext } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Spinner } from '@renderer/components/primitives'
import { useResponse } from '@renderer/store/response'
import { ResponseVisibilityContext, withCombo } from '@renderer/lib/dock'
import { statusColor } from '@renderer/lib/status-color'
import { tr } from '@renderer/lib/i18n'

/**
 * While a pane's response is hidden, the request header carries this button:
 * the last status (or a spinner while a request runs) and «show the response».
 * Nothing while the response is shown.
 */
export function ShowResponseButton(): JSX.Element | null {
  const vis = useContext(ResponseVisibilityContext)
  const r = useResponse((s) => (vis ? s.byTab[vis.tabId] : undefined))
  if (!vis?.hidden) return null
  const title = withCombo(tr('Показать ответ'), vis.combo)
  const result = r?.status === 'done' || r?.status === 'error' ? r.result : undefined
  return (
    <button type="button" className="btn ghost show-resp-btn" onClick={() => vis.setHidden(false)} title={title} aria-label={title}>
      {r?.status === 'loading' && <Spinner size={12} />}
      {result && (
        <span className="show-resp-status" style={{ color: statusColor(result.status) }}>
          {result.status > 0 ? result.status : tr('ошибка')}
        </span>
      )}
      <Icon name="eye" size={14} />
      <span className="show-resp-label">{tr('Показать ответ')}</span>
    </button>
  )
}

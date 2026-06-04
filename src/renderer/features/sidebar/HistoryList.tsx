import { Icon } from '@renderer/components/Icon'
import { useHistory } from '@renderer/store/history'
import { useTabs } from '@renderer/store/tabs'

function statusColor(s: number): string {
  if (s === 0) return 'var(--s-5xx)'
  if (s >= 500) return 'var(--s-5xx)'
  if (s >= 400) return 'var(--s-4xx)'
  if (s >= 300) return 'var(--s-3xx)'
  return 'var(--s-2xx)'
}

function timeAgo(at: number): string {
  const diff = Math.floor((Date.now() - at) / 1000)
  if (diff < 60) return `${diff} сек назад`
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}

export function HistoryList({ query }: { query: string }) {
  const entries = useHistory((s) => s.doc.entries)
  const clear = useHistory((s) => s.clear)
  const openNew = useTabs((s) => s.openNew)

  const filtered = entries.filter((h) => h.url.toLowerCase().includes(query.toLowerCase()))

  return (
    <>
      <div className="side-section-head">
        <span>История</span>
        {entries.length > 0 && (
          <button className="icon-btn" style={{ width: 22, height: 22 }} title="Очистить историю" onClick={() => clear()}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
      <div className="tree">
        {filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--tx-3)', fontSize: 12 }}>История пуста</div>}
        {filtered.map((h) => (
          <div key={h.id} className="hist-row" onClick={() => openNew(h.request)} title={h.url}>
            <span className={`method-tag mtag m-${h.method}`}>{h.method === 'DELETE' ? 'DEL' : h.method}</span>
            <div className="meta">
              <div className="url">{h.url}</div>
              <div className="time">{timeAgo(h.at)}</div>
            </div>
            <span
              className="status-dot"
              style={{ color: statusColor(h.status), background: `color-mix(in oklch, ${statusColor(h.status)} 14%, transparent)` }}
            >
              {h.status || 'ERR'}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

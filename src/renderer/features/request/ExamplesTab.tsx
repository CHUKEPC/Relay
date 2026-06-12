import type { RequestModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { restoreExample, deleteExample } from '@renderer/lib/examples'
import { statusColor } from '@renderer/lib/status-color'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'

export function ExamplesTab({ req, tabId }: { req: RequestModel; tabId: string }): JSX.Element {
  const examples = req.examples ?? []

  if (examples.length === 0) {
    return (
      <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12.5 }}>
        Пока нет сохранённых примеров. Отправьте запрос и нажмите{' '}
        <Icon name="doc" size={12} style={{ verticalAlign: 'middle' }} /> «Сохранить как пример» в панели ответа.
      </div>
    )
  }

  return (
    <div className="kv-area">
      {examples.map((ex) => {
        const sc = statusColor(ex.status)
        return (
          <div key={ex.id} className="example-row">
            <span className="status-pill" style={{ color: sc, background: `color-mix(in oklch, ${sc} 14%, transparent)`, flex: 'none' }}>
              {ex.status || '—'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ex.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>{ex.contentType || 'нет типа'}</div>
            </div>
            <button
              className="btn ghost"
              style={{ height: 28 }}
              onClick={() => {
                restoreExample(tabId, ex)
                useUi.getState().showToast('Пример показан в панели ответа')
              }}
              title="Показать в панели ответа"
            >
              <Icon name="eye" size={13} />
              Открыть
            </button>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => {
                // deleteExample() edits the ACTIVE tab's request — activate ours first.
                if (useTabs.getState().doc.activeTabId !== tabId) useTabs.getState().setActive(tabId)
                deleteExample(ex.id)
              }}
              title="Удалить пример"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

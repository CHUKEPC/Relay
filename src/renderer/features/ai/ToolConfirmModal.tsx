import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/primitives'
import { useAi } from '@renderer/store/ai'

/** Confirmation gate for mutating AI tool calls (update request, set variable, send). */
export function ToolConfirmModal() {
  const pending = useAi((s) => s.pendingConfirm)
  const confirmTool = useAi((s) => s.confirmTool)
  if (!pending) return null

  return (
    <Modal open onOpenChange={(o) => !o && confirmTool(false)} width={520} title={undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="ai-spark" style={{ width: 26, height: 26 }}>
          <Icon name="sparkle" size={15} />
        </span>
        <div style={{ fontSize: 14.5, fontWeight: 650 }}>Ассистент предлагает действие</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{pending.title}</div>
      <div className="code-block" style={{ margin: 0 }}>
        <pre style={{ maxHeight: 240 }}>{pending.detail}</pre>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 8 }}>
        Подтвердите, чтобы ассистент применил изменение. Авто-применение можно включить в Настройках.
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => confirmTool(false)}>
          Отклонить
        </button>
        <button className="btn primary" onClick={() => confirmTool(true)}>
          <Icon name="check" size={14} />
          Применить
        </button>
      </div>
    </Modal>
  )
}

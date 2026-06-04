import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/primitives'
import { useActiveRequest } from '@renderer/lib/hooks'
import { CODE_TARGETS, generateCode, type CodeTarget } from '@renderer/lib/codegen'

export function CodeGenModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const req = useActiveRequest()
  const [target, setTarget] = useState<CodeTarget>('curl')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()

  const code = useMemo(() => (req ? generateCode(target, req) : ''), [req, target])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Сгенерировать код" width={680}>
      <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {CODE_TARGETS.map((t) => (
          <button key={t.id} className={target === t.id ? 'on' : ''} onClick={() => setTarget(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="code-block" style={{ margin: 0 }}>
        <div className="code-block-head">
          <span className="lang" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--tx-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {CODE_TARGETS.find((t) => t.id === target)?.lang}
          </span>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" style={{ width: 24, height: 22 }} onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
        </div>
        <pre>{code}</pre>
      </div>
    </Modal>
  )
}

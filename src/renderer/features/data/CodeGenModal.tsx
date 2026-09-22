import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/primitives'
import { useActiveRequest } from '@renderer/lib/hooks'
import { CODE_TARGETS, generateCode, type CodeTarget } from '@renderer/lib/codegen'

import { tr } from '@renderer/lib/i18n'
import { useCap } from '@renderer/store/features'
import { useUi } from '@renderer/store/ui'
import { sendToTerminal } from '@renderer/lib/request-runner'
import { loadTools } from '@renderer/features/request/TerminalButton'
import type { TerminalTool } from '@shared/terminal-command'

/** Code targets that are also command-line clients Relay can launch. */
const RUNNABLE: Partial<Record<CodeTarget, TerminalTool>> = { curl: 'curl', httpie: 'httpie', wget: 'wget', powershell: 'powershell' }
export function CodeGenModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const req = useActiveRequest()
  const [target, setTarget] = useState<CodeTarget>('curl')
  const extra = useCap('codegen.extra')
  const targets = CODE_TARGETS.filter((t) => t.core || extra)
  // A language whose pack was switched off falls back to cURL.
  const active: CodeTarget = targets.some((t) => t.id === target) ? target : 'curl'
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const [installed, setInstalled] = useState<TerminalTool[]>([])
  useEffect(() => {
    if (open) void loadTools().then((t) => setInstalled(t.filter((x) => x.available).map((x) => x.id)))
  }, [open])
  const runnable = RUNNABLE[active]

  const code = useMemo(() => (req ? generateCode(active, req) : ''), [req, active])

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tr('Сгенерировать код')} width={680}>
      <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {targets.map((t) => (
          <button key={t.id} className={active === t.id ? 'on' : ''} onClick={() => setTarget(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {!extra && (
        <div className="codegen-more">
          {tr('Node, Go, Java, C#, PHP, Ruby, Swift, Kotlin, Rust, PowerShell, HTTPie и wget — в плагине «Генерация кода: другие языки».')}{' '}
          <button
            className="link-btn"
            onClick={() => {
              onOpenChange(false)
              useUi.getState().openSettings('plugins')
            }}
          >
            {tr('Открыть «Плагины»')}
          </button>
        </div>
      )}
      <div className="code-block" style={{ margin: 0 }}>
        <div className="code-block-head">
          <span className="lang" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--tx-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {CODE_TARGETS.find((t) => t.id === active)?.lang}
          </span>
          <div style={{ flex: 1 }} />
          {runnable && installed.includes(runnable) && (
            <button
              className="btn ghost"
              style={{ height: 22, fontSize: 11.5, marginRight: 4 }}
              title={tr('Открыть терминал и выполнить запрос с подставленными переменными')}
              onClick={() => {
                void sendToTerminal(runnable)
                onOpenChange(false)
              }}
            >
              <Icon name="terminal" size={12} /> {tr('Выполнить в терминале')}
            </button>
          )}
          <button className="icon-btn" style={{ width: 24, height: 22 }} onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={13} />
          </button>
        </div>
        <pre>{code}</pre>
      </div>
    </Modal>
  )
}

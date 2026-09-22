import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { TerminalTool } from '@shared/terminal-command'
import { Icon } from '@renderer/components/Icon'
import { sendToTerminal } from '@renderer/lib/request-runner'
import { tr, trf } from '@renderer/lib/i18n'

type ToolInfo = { id: TerminalTool; label: string; available: boolean }

// What is installed does not change while the app runs; ask main once.
let toolsPromise: Promise<ToolInfo[]> | null = null
export function loadTools(): Promise<ToolInfo[]> {
  toolsPromise ??= window.api
    .terminalTools()
    .then((r) => r.tools)
    .catch(() => [])
  return toolsPromise
}

/**
 * «cURL» — send the request to a terminal in one click. The arrow offers the
 * other command-line clients this OS has, and the command itself.
 */
export function TerminalButton({ tabId, beforeRun, onShowCode }: { tabId: string; beforeRun: () => void; onShowCode: () => void }) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  useEffect(() => {
    let live = true
    void loadTools().then((t) => live && setTools(t))
    return () => {
      live = false
    }
  }, [])

  const run = (tool: TerminalTool) => {
    beforeRun()
    void sendToTerminal(tool, tabId)
  }

  return (
    <div className="split-btn" data-tour="terminal">
      <button className="btn ghost" style={{ height: 28 }} onClick={() => run('curl')} title={tr('Отправить в cURL: открыть терминал и выполнить запрос')}>
        <Icon name="terminal" size={14} /> cURL
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="btn ghost split-btn-arrow" style={{ height: 28 }} title={tr('Другие инструменты терминала')}>
            <Icon name="chevDsm" size={12} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          {/* `.popover` is position:absolute; inside Radix's positioned wrapper it must be
              relative, or the menu slides off the window edge (as every other menu here does). */}
          <DropdownMenu.Content className="popover" align="end" sideOffset={4} collisionPadding={8} style={{ position: 'relative', minWidth: 230 }}>
            {tools.map((t) => (
              <DropdownMenu.Item key={t.id} className="pop-item" disabled={!t.available} onSelect={() => run(t.id)}>
                <Icon name="terminal" size={14} />
                <span style={{ flex: 1 }}>{trf('Отправить в {tool}', { tool: t.label })}</span>
                {!t.available && <span className="pop-hint">{tr('не установлен')}</span>}
              </DropdownMenu.Item>
            ))}
            {tools.length > 0 && <DropdownMenu.Separator className="pop-sep" />}
            <DropdownMenu.Item
              className="pop-item"
              onSelect={() => {
                beforeRun()
                onShowCode()
              }}
            >
              <Icon name="code2" size={14} /> {tr('Показать команду…')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

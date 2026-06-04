import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ClipboardEvent } from 'react'
import type { RequestModel } from '@shared/types'
import { HTTP_METHODS } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { HighlightedInput } from '@renderer/components/HighlightedInput'
import { Spinner } from '@renderer/components/primitives'
import { useTabs } from '@renderer/store/tabs'
import { useResponse } from '@renderer/store/response'
import { useScope, useActiveTab } from '@renderer/lib/hooks'
import { joinUrl, mergeQueryFromUrl } from '@renderer/lib/url'
import { sendActiveRequest, cancelActiveRequest } from '@renderer/lib/request-runner'
import { parseCurl } from '@shared/curl'
import { useUi } from '@renderer/store/ui'

export function UrlBar({ req }: { req: RequestModel }) {
  const scope = useScope()
  const tab = useActiveTab()
  const sending = useResponse((s) => (tab ? s.byTab[tab.id]?.status === 'loading' : false))
  const patch = useTabs((s) => s.patchActive)

  const displayUrl = joinUrl(req.url, req.query)

  const onUrlChange = (value: string) => {
    const { base, query } = mergeQueryFromUrl(req.query, value)
    patch({ url: base, query })
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (/^\s*curl\s/i.test(pasted)) {
      e.preventDefault()
      const { request } = parseCurl(pasted)
      patch({ method: request.method, url: request.url, query: request.query, headers: request.headers, body: request.body, auth: request.auth })
      useUi.getState().showToast('Запрос заполнен из cURL')
    }
  }

  return (
    <div className="req-bar">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="method-select">
            <span className={`m-${req.method}`}>{req.method}</span>
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)', marginLeft: 'auto' }} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="start" sideOffset={6} style={{ position: 'relative', minWidth: 140 }}>
            {HTTP_METHODS.map((m) => (
              <DropdownMenu.Item key={m} className="pop-item" onSelect={() => patch({ method: m })}>
                <span className={`method-tag m-${m}`} style={{ width: 48 }}>
                  {m}
                </span>
                {req.method === m && <Icon name="check" size={14} className="tick" style={{ marginLeft: 'auto' }} />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className="url-bar">
        <HighlightedInput
          value={displayUrl}
          onChange={onUrlChange}
          scope={scope}
          placeholder="https://api.example.com/{{path}}"
          ariaLabel="Request URL"
          onPaste={onPaste}
        />
      </div>

      {sending ? (
        <button className="btn send-btn" onClick={() => cancelActiveRequest()} style={{ minWidth: 120, justifyContent: 'center' }}>
          <Spinner size={15} />
          Отмена
        </button>
      ) : (
        <button className="btn primary send-btn" onClick={() => void sendActiveRequest()}>
          Отправить
          <Icon name="send" size={14} />
        </button>
      )}
    </div>
  )
}

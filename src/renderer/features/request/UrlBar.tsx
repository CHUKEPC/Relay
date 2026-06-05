import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ClipboardEvent } from 'react'
import type { RequestMode, RequestModel } from '@shared/types'
import { HTTP_METHODS } from '@shared/constants'
import { interpolate } from '@shared/interpolate'
import { Icon } from '@renderer/components/Icon'
import { HighlightedInput } from '@renderer/components/HighlightedInput'
import { Spinner } from '@renderer/components/primitives'
import { useTabs } from '@renderer/store/tabs'
import { useResponse } from '@renderer/store/response'
import { useRealtime } from '@renderer/store/realtime'
import { useSettings } from '@renderer/store/settings'
import { useScope, useActiveTab } from '@renderer/lib/hooks'
import { joinUrl, mergeQueryFromUrl } from '@renderer/lib/url'
import { sendActiveRequest, cancelActiveRequest } from '@renderer/lib/request-runner'
import { parseCurl } from '@shared/curl'
import { useUi } from '@renderer/store/ui'

const MODE_LABEL: Record<RequestMode, string> = { http: 'HTTP', websocket: 'WS', sse: 'SSE' }

/** Swap the URL scheme to fit the new mode (http<->ws), best-effort. */
function adaptScheme(url: string, mode: RequestMode): string {
  if (mode === 'websocket') {
    if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'ws://')
    if (/^https:\/\//i.test(url)) return url.replace(/^https:\/\//i, 'wss://')
  } else {
    if (/^ws:\/\//i.test(url)) return url.replace(/^ws:\/\//i, 'http://')
    if (/^wss:\/\//i.test(url)) return url.replace(/^wss:\/\//i, 'https://')
  }
  return url
}

export function UrlBar({ req }: { req: RequestModel }) {
  const scope = useScope()
  const tab = useActiveTab()
  const sending = useResponse((s) => (tab ? s.byTab[tab.id]?.status === 'loading' : false))
  const rtStatus = useRealtime((s) => (tab ? s.byTab[tab.id]?.status : undefined))
  const patch = useTabs((s) => s.patchActive)

  const mode: RequestMode = req.mode ?? 'http'
  const displayUrl = joinUrl(req.url, req.query)

  const onUrlChange = (value: string) => {
    const { base, query } = mergeQueryFromUrl(req.query, value)
    patch({ url: base, query })
  }

  const setMode = (next: RequestMode) => {
    if (next === mode) return
    // Drop any live realtime connection on this tab before changing protocol so
    // a switched-away WebSocket/SSE socket doesn't linger with a stale status.
    if (tab) useRealtime.getState().disconnect(tab.id)
    const { base, query } = mergeQueryFromUrl(req.query, adaptScheme(displayUrl, next))
    patch({ mode: next, url: base, query })
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

  const connectRealtime = () => {
    if (!tab) return
    const url = interpolate(displayUrl, scope)
    const headers = req.headers
      .filter((h) => h.enabled && h.key)
      .map((h) => ({ key: interpolate(h.key, scope), value: interpolate(h.value, scope), enabled: true }))
    useRealtime.getState().connect(tab.id, {
      kind: mode === 'websocket' ? 'websocket' : 'sse',
      url,
      headers,
      rejectUnauthorized: useSettings.getState().settings.rejectUnauthorized
    })
  }

  const realtimeBusy = rtStatus === 'open' || rtStatus === 'connecting'

  return (
    <div className="req-bar">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="method-select" style={{ minWidth: 78 }} title="Протокол">
            <span>{MODE_LABEL[mode]}</span>
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)', marginLeft: 'auto' }} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="start" sideOffset={6} style={{ position: 'relative', minWidth: 160 }}>
            {(['http', 'websocket', 'sse'] as RequestMode[]).map((m) => (
              <DropdownMenu.Item key={m} className="pop-item" onSelect={() => setMode(m)}>
                <span style={{ flex: 1 }}>{m === 'http' ? 'HTTP' : m === 'websocket' ? 'WebSocket' : 'Server-Sent Events'}</span>
                {mode === m && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {mode === 'http' && (
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
      )}

      <div className="url-bar">
        <HighlightedInput
          value={displayUrl}
          onChange={onUrlChange}
          scope={scope}
          placeholder={mode === 'http' ? 'https://api.example.com/{{path}}' : mode === 'websocket' ? 'wss://example.com/socket' : 'https://example.com/events'}
          ariaLabel="Request URL"
          onPaste={onPaste}
        />
      </div>

      {mode === 'http' ? (
        sending ? (
          <button className="btn send-btn" onClick={() => cancelActiveRequest()} style={{ minWidth: 120, justifyContent: 'center' }}>
            <Spinner size={15} />
            Отмена
          </button>
        ) : (
          <button className="btn primary send-btn" onClick={() => void sendActiveRequest()}>
            Отправить
            <Icon name="send" size={14} />
          </button>
        )
      ) : realtimeBusy ? (
        <button className="btn send-btn" onClick={() => tab && useRealtime.getState().disconnect(tab.id)} style={{ minWidth: 120, justifyContent: 'center' }}>
          <Icon name="stop" size={13} />
          Отключить
        </button>
      ) : (
        <button className="btn primary send-btn" onClick={connectRealtime}>
          Подключить
          <Icon name="bolt" size={14} />
        </button>
      )}
    </div>
  )
}

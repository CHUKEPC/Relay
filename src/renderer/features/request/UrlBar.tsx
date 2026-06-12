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
import { useGrpc } from '@renderer/store/grpc'
import { useSettings } from '@renderer/store/settings'
import { useScope } from '@renderer/lib/hooks'
import { joinUrl, mergeQueryFromUrl } from '@renderer/lib/url'
import { sendActiveRequest } from '@renderer/lib/request-runner'
import { parseCurl } from '@shared/curl'
import { useUi } from '@renderer/store/ui'

const MODE_LABEL: Record<RequestMode, string> = {
  http: 'HTTP',
  graphql: 'GraphQL',
  websocket: 'WS',
  sse: 'SSE',
  socketio: 'Socket.IO',
  mqtt: 'MQTT',
  grpc: 'gRPC'
}

const MODE_FULL: Record<RequestMode, string> = {
  http: 'HTTP',
  graphql: 'GraphQL',
  websocket: 'WebSocket',
  sse: 'Server-Sent Events',
  socketio: 'Socket.IO',
  mqtt: 'MQTT',
  grpc: 'gRPC'
}

const MODE_PLACEHOLDER: Record<RequestMode, string> = {
  http: 'https://api.example.com/{{path}}',
  graphql: 'https://api.example.com/graphql',
  websocket: 'wss://example.com/socket',
  sse: 'https://example.com/events',
  socketio: 'wss://example.com',
  mqtt: 'wss://broker.example.com:8884/mqtt',
  grpc: 'localhost:50051'
}

/** Modes that connect (Connect/Disconnect) rather than send a one-shot request. */
function isRealtimeMode(m: RequestMode): boolean {
  return m === 'websocket' || m === 'sse' || m === 'socketio' || m === 'mqtt'
}

/** Best-effort URL-scheme swap to fit the new mode. */
function adaptScheme(url: string, mode: RequestMode): string {
  const toWs = mode === 'websocket' || mode === 'socketio'
  if (toWs) {
    return url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://')
  }
  if (mode === 'mqtt') {
    return url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://')
  }
  // http / graphql / sse use http(s)
  return url.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://')
}

export function UrlBar({ req, tabId }: { req: RequestModel; tabId: string }) {
  const scope = useScope(tabId)
  const sending = useResponse((s) => s.byTab[tabId]?.status === 'loading')
  const rtStatus = useRealtime((s) => s.byTab[tabId]?.status)
  const patch = (p: Partial<RequestModel>) => useTabs.getState().patchTab(tabId, p)

  const mode: RequestMode = req.mode ?? 'http'
  const isGrpc = mode === 'grpc'
  const grpcStatus = useGrpc((s) => s.byTab[tabId]?.status)
  const displayUrl = joinUrl(req.url, req.query)

  const onUrlChange = (value: string) => {
    const { base, query } = mergeQueryFromUrl(req.query, value)
    patch({ url: base, query })
  }

  const setMode = (next: RequestMode) => {
    if (next === mode) return
    // Drop any live realtime/gRPC work on this tab before changing protocol so a
    // switched-away connection/call doesn't linger with a stale status.
    useRealtime.getState().disconnect(tabId)
    useGrpc.getState().cancel(tabId)
    // gRPC keeps its own address/proto state on `req.grpc` and ignores the URL.
    if (next === 'grpc') {
      patch({ mode: next, grpc: req.grpc ?? { message: '{}', plaintext: true } })
      return
    }
    const { base, query } = mergeQueryFromUrl(req.query, adaptScheme(displayUrl, next))
    // GraphQL is HTTP POST with a GraphQL body — switch the body + method to match.
    if (next === 'graphql') {
      const body = req.body.type === 'graphql' ? req.body : { type: 'graphql' as const, query: '', variables: '{}' }
      patch({ mode: next, url: base, query, method: 'POST', body })
    } else {
      patch({ mode: next, url: base, query })
    }
  }

  const grpcAddress = req.grpc?.address ?? ''
  const grpcBusy = grpcStatus === 'running'

  const invokeGrpc = () => {
    const g = req.grpc ?? {}
    // With reflection the descriptors are fetched server-side, so a pasted .proto
    // is not required — only a selected service/method.
    if ((!g.useReflection && !g.proto?.trim()) || !g.service || !g.method) {
      useUi.getState().showToast(
        g.useReflection ? 'Выполните Discover и выберите сервис/метод' : 'Загрузите .proto и выберите сервис/метод'
      )
      return
    }
    if (!grpcAddress.trim()) {
      useUi.getState().showToast('Укажите адрес (host:port)')
      return
    }
    const metadata = (g.metadata ?? [])
      .filter((h) => h.enabled && h.key)
      .map((h) => ({ key: interpolate(h.key, scope), value: interpolate(h.value, scope), enabled: true }))
    useGrpc.getState().invoke(tabId, {
      proto: g.proto ?? '',
      address: interpolate(grpcAddress, scope).replace(/^[a-z]+:\/\//i, ''),
      service: g.service,
      method: g.method,
      message: interpolate(g.message ?? '', scope),
      metadata,
      plaintext: g.plaintext ?? false,
      rejectUnauthorized: useSettings.getState().settings.rejectUnauthorized,
      callKind: g.methodKind ?? 'unary',
      useReflection: g.useReflection,
      deadlineMs: g.deadlineMs,
      caCertPath: g.caCertPath,
      clientCertPath: g.clientCertPath,
      clientKeyPath: g.clientKeyPath
    })
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
    if (!isRealtimeMode(mode)) return
    const url = interpolate(displayUrl, scope)
    const headers = req.headers
      .filter((h) => h.enabled && h.key)
      .map((h) => ({ key: interpolate(h.key, scope), value: interpolate(h.value, scope), enabled: true }))
    useRealtime.getState().connect(tabId, {
      kind: mode as 'websocket' | 'sse' | 'socketio' | 'mqtt',
      url,
      headers,
      rejectUnauthorized: useSettings.getState().settings.rejectUnauthorized,
      // MQTT-only: carry the per-request QoS + Last-Will config into the connection.
      ...(mode === 'mqtt' ? { qos: req.mqtt?.qos, lwt: req.mqtt?.lwt } : {})
    })
  }

  const send = () => {
    void sendActiveRequest(tabId)
  }

  const cancelSend = () => {
    const { requestId } = useResponse.getState().get(tabId)
    if (requestId) void window.api.cancelRequest(requestId)
  }

  const isHttpLike = mode === 'http' || mode === 'graphql'
  // Treat 'error' as still-active: socket.io/mqtt keep retrying in the background
  // after an error, so the user must be able to Disconnect (not see "Connect").
  const realtimeBusy = rtStatus === 'open' || rtStatus === 'connecting' || rtStatus === 'error'

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
            {(['http', 'graphql', 'websocket', 'sse', 'socketio', 'mqtt'] as RequestMode[]).map((m) => (
              <DropdownMenu.Item key={m} className="pop-item" onSelect={() => setMode(m)}>
                <span style={{ flex: 1 }}>{MODE_FULL[m]}</span>
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
        {isGrpc ? (
          <input
            className="grpc-address"
            value={grpcAddress}
            onChange={(e) => patch({ grpc: { ...(req.grpc ?? {}), address: e.target.value } })}
            placeholder={MODE_PLACEHOLDER.grpc}
            aria-label="gRPC address"
            spellCheck={false}
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', color: 'var(--tx-1)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '0 12px', outline: 'none' }}
          />
        ) : (
          <HighlightedInput
            value={displayUrl}
            onChange={onUrlChange}
            scope={scope}
            placeholder={MODE_PLACEHOLDER[mode]}
            ariaLabel="Request URL"
            onPaste={onPaste}
          />
        )}
      </div>

      {isHttpLike ? (
        sending ? (
          <button className="btn send-btn" onClick={cancelSend} style={{ minWidth: 120, justifyContent: 'center' }}>
            <Spinner size={15} />
            Отмена
          </button>
        ) : (
          <button className="btn primary send-btn" data-tour="send" onClick={send}>
            Отправить
            <Icon name="send" size={14} />
          </button>
        )
      ) : isGrpc ? (
        grpcBusy ? (
          <button className="btn send-btn" onClick={() => useGrpc.getState().cancel(tabId)} style={{ minWidth: 120, justifyContent: 'center' }}>
            <Icon name="stop" size={13} />
            Отмена
          </button>
        ) : (
          <button className="btn primary send-btn" onClick={invokeGrpc}>
            Вызвать
            <Icon name="send" size={14} />
          </button>
        )
      ) : realtimeBusy ? (
        <button className="btn send-btn" onClick={() => useRealtime.getState().disconnect(tabId)} style={{ minWidth: 120, justifyContent: 'center' }}>
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

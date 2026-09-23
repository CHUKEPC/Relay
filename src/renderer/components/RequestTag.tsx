import type { RequestModel } from '@shared/types'

/** Short protocol labels; HTTP and GraphQL requests show their method instead. */
const MODE_TAG: Partial<Record<NonNullable<RequestModel['mode']>, string>> = {
  websocket: 'WS',
  sse: 'SSE',
  socketio: 'SIO',
  mqtt: 'MQTT',
  grpc: 'gRPC'
}

/**
 * The coloured label in front of a request name (tabs, tree, panes, runner).
 * A WebSocket or MQTT request has no HTTP method worth showing — its leftover
 * `GET` used to sit in the tab — so non-HTTP modes show the protocol instead.
 */
export function RequestTag({ request, className = '' }: { request: Pick<RequestModel, 'method' | 'mode'>; className?: string }): JSX.Element {
  const proto = request.mode ? MODE_TAG[request.mode] : undefined
  if (proto) return <span className={`method-tag m-proto ${className}`.trim()}>{proto}</span>
  const m = request.method
  return <span className={`method-tag m-${m} ${className}`.trim()}>{m === 'DELETE' ? 'DEL' : m}</span>
}

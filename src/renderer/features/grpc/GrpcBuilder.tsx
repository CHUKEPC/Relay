import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { GrpcConfig, GrpcMethodInfo, GrpcServiceInfo, RequestModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { KVTable } from '@renderer/components/KVTable'
import { Toggle } from '@renderer/components/primitives'
import { useTabs } from '@renderer/store/tabs'
import { useScope } from '@renderer/lib/hooks'

const KIND_LABEL: Record<GrpcMethodInfo['kind'], string> = {
  unary: 'unary',
  server_stream: 'server-stream',
  client_stream: 'client-stream',
  bidi: 'bidi'
}

const SAMPLE_PROTO = `syntax = "proto3";
package helloworld;

message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}`

export function GrpcBuilder({ req }: { req: RequestModel }): JSX.Element {
  const patch = useTabs((s) => s.patchActive)
  const scope = useScope()
  const grpc: GrpcConfig = req.grpc ?? {}
  const [services, setServices] = useState<GrpcServiceInfo[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [section, setSection] = useState<'message' | 'metadata'>('message')

  const set = (p: Partial<GrpcConfig>): void => patch({ grpc: { ...grpc, ...p } })

  const activeService = services.find((s) => s.name === grpc.service) ?? null
  const activeMethod = activeService?.methods.find((m) => m.name === grpc.method) ?? null

  const doParse = async (text: string): Promise<void> => {
    setParsing(true)
    setParseError(null)
    try {
      const res = await window.api.grpcParse(text)
      setServices(res.services)
      if (res.error) {
        setParseError(res.error)
        return
      }
      // Auto-select the first service/method if the saved selection is gone.
      const svc = res.services.find((s) => s.name === grpc.service) ?? res.services[0]
      const method = svc?.methods.find((m) => m.name === grpc.method) ?? svc?.methods[0]
      if (svc && method) set({ service: svc.name, method: method.name, methodKind: method.kind })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  const onFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      set({ proto: text })
      void doParse(text)
    }
    reader.readAsText(file)
  }

  const selectMethod = (svc: GrpcServiceInfo, m: GrpcMethodInfo): void =>
    set({ service: svc.name, method: m.name, methodKind: m.kind })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Proto source */}
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>Proto-файл</span>
        <button className="btn ghost" style={{ height: 26 }} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={13} /> Загрузить .proto
        </button>
        {!grpc.proto && (
          <button className="btn ghost" style={{ height: 26 }} onClick={() => { set({ proto: SAMPLE_PROTO }); void doParse(SAMPLE_PROTO) }}>
            Пример
          </button>
        )}
        <button className="btn" style={{ height: 26 }} disabled={parsing || !(grpc.proto ?? '').trim()} onClick={() => void doParse(grpc.proto ?? '')}>
          {parsing ? 'Разбор…' : 'Разобрать'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".proto,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
      </div>
      <div style={{ height: 160, padding: '0 14px' }}>
        <CodeEditor
          value={grpc.proto ?? ''}
          language="plaintext"
          onChange={(proto) => set({ proto })}
        />
      </div>
      {parseError && <div style={{ color: 'var(--s-5xx)', fontSize: 12, padding: '6px 16px' }}>{parseError}</div>}

      {/* Service + method pickers */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 14px', flexWrap: 'wrap' }}>
        <Picker
          label="Сервис"
          value={activeService?.name ?? '—'}
          disabled={services.length === 0}
          items={services.map((s) => ({ key: s.name, label: s.name, onSelect: () => { const m = s.methods[0]; if (m) selectMethod(s, m) } }))}
        />
        <Picker
          label="Метод"
          value={activeMethod ? activeMethod.name : '—'}
          disabled={!activeService}
          items={(activeService?.methods ?? []).map((m) => ({
            key: m.name,
            label: m.name,
            hint: KIND_LABEL[m.kind],
            onSelect: () => activeService && selectMethod(activeService, m)
          }))}
        />
        {activeMethod && (
          <span className="chip" style={{ alignSelf: 'center', fontSize: 11, color: 'var(--tx-3)' }}>
            {KIND_LABEL[activeMethod.kind]} · {activeMethod.requestType || '?'} → {activeMethod.responseType || '?'}
          </span>
        )}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--tx-2)' }}>
          <Toggle checked={grpc.plaintext ?? false} onChange={(plaintext) => set({ plaintext })} />
          Plaintext (без TLS)
        </label>
      </div>

      {/* Message / metadata tabs */}
      <div className="req-tabs" style={{ marginTop: 2 }}>
        <button className={`tab ${section === 'message' ? 'on' : ''}`} onClick={() => setSection('message')}>
          Сообщение
        </button>
        <button className={`tab ${section === 'metadata' ? 'on' : ''}`} onClick={() => setSection('metadata')}>
          Metadata
          {(grpc.metadata?.filter((m) => m.enabled && m.key).length ?? 0) > 0 && (
            <span className="count">{grpc.metadata!.filter((m) => m.enabled && m.key).length}</span>
          )}
        </button>
      </div>
      {section === 'message' ? (
        <div style={{ height: 200, padding: '6px 14px 14px' }}>
          <CodeEditor value={grpc.message ?? '{}'} language="json" onChange={(message) => set({ message })} />
        </div>
      ) : (
        <KVTable
          rows={grpc.metadata ?? []}
          onChange={(metadata) => set({ metadata })}
          scope={scope}
          keyPlaceholder="metadata-key"
        />
      )}
    </div>
  )
}

function Picker({
  label,
  value,
  items,
  disabled
}: {
  label: string
  value: string
  items: { key: string; label: string; hint?: string; onSelect: () => void }[]
  disabled?: boolean
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="method-select" style={{ minWidth: 180 }} disabled={disabled}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
            <Icon name="chevDsm" size={13} style={{ color: 'var(--tx-3)', marginLeft: 'auto' }} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="popover" align="start" sideOffset={6} style={{ position: 'relative', minWidth: 200, maxHeight: 320, overflow: 'auto' }}>
            {items.length === 0 ? (
              <div className="pop-item" style={{ color: 'var(--tx-3)' }}>Нет элементов</div>
            ) : (
              items.map((it) => (
                <DropdownMenu.Item key={it.key} className="pop-item" onSelect={it.onSelect}>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.hint && <span style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>{it.hint}</span>}
                </DropdownMenu.Item>
              ))
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

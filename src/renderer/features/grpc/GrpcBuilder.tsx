import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { GrpcConfig, GrpcMethodInfo, GrpcServiceInfo, RequestModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { KVTable } from '@renderer/components/KVTable'
import { Toggle } from '@renderer/components/primitives'
import { useGrpc } from '@renderer/store/grpc'
import { useSettings } from '@renderer/store/settings'
import { useTabs } from '@renderer/store/tabs'
import { useScope } from '@renderer/lib/hooks'
import { interpolate } from '@shared/interpolate'

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

export function GrpcBuilder({ req, tabId }: { req: RequestModel; tabId: string }): JSX.Element {
  // Patch THIS builder's tab — patchActive would hit the wrong tab in split-screen.
  const patch = (p: Partial<RequestModel>): void => useTabs.getState().patchTab(tabId, p)
  const scope = useScope(tabId)
  const grpc: GrpcConfig = req.grpc ?? {}
  const [services, setServices] = useState<GrpcServiceInfo[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [section, setSection] = useState<'message' | 'metadata'>('message')

  const set = (p: Partial<GrpcConfig>): void => patch({ grpc: { ...grpc, ...p } })

  const useReflection = grpc.useReflection ?? false
  const activeService = services.find((s) => s.name === grpc.service) ?? null
  const activeMethod = activeService?.methods.find((m) => m.name === grpc.method) ?? null

  /** Apply a discovered service list and re-select (or auto-select) a method. */
  const applyServices = (list: GrpcServiceInfo[]): void => {
    setServices(list)
    const svc = list.find((s) => s.name === grpc.service) ?? list[0]
    const method = svc?.methods.find((m) => m.name === grpc.method) ?? svc?.methods[0]
    if (svc && method) set({ service: svc.name, method: method.name, methodKind: method.kind })
  }

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
      applyServices(res.services)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  /** Discover services from the live server via Server Reflection. */
  const doReflect = async (): Promise<void> => {
    const address = interpolate(grpc.address ?? '', scope).replace(/^[a-z]+:\/\//i, '')
    if (!address.trim()) {
      setParseError('Укажите адрес (host:port) для reflection')
      return
    }
    setDiscovering(true)
    setParseError(null)
    try {
      const metadata = (grpc.metadata ?? [])
        .filter((m) => m.enabled && m.key)
        .map((m) => ({ key: interpolate(m.key, scope), value: interpolate(m.value, scope), enabled: true }))
      const res = await useGrpc.getState().reflect({
        address,
        metadata,
        plaintext: grpc.plaintext,
        rejectUnauthorized: useSettings.getState().settings.rejectUnauthorized,
        caCertPath: grpc.caCertPath,
        clientCertPath: grpc.clientCertPath,
        clientKeyPath: grpc.clientKeyPath
      })
      if (res.error) {
        setServices(res.services)
        setParseError(res.error)
        return
      }
      applyServices(res.services)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setDiscovering(false)
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

  // Pick a file PATH only (never read bytes in the renderer).
  const pickPem = async (field: 'caCertPath' | 'clientCertPath' | 'clientKeyPath'): Promise<void> => {
    const files = await window.api.openFile({
      multiple: false,
      filters: [{ name: 'PEM/сертификат', extensions: ['pem', 'crt', 'cert', 'key', 'ca'] }]
    })
    if (files && files[0]) set({ [field]: files[0].filePath })
  }

  const selectMethod = (svc: GrpcServiceInfo, m: GrpcMethodInfo): void =>
    set({ service: svc.name, method: m.name, methodKind: m.kind })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Discovery source: reflection toggle + (when off) .proto editor */}
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{useReflection ? 'Server Reflection' : 'Proto-файл'}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx-2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          <Toggle checked={useReflection} onChange={(v) => set({ useReflection: v })} />
          Reflection
        </label>
        {useReflection ? (
          <button className="btn" style={{ height: 26 }} disabled={discovering} onClick={() => void doReflect()}>
            {discovering ? 'Обнаружение…' : 'Обнаружить'}
          </button>
        ) : (
          <>
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
          </>
        )}
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
      {useReflection ? (
        <div style={{ padding: '0 14px 4px', fontSize: 12, color: 'var(--tx-3)' }}>
          Дескрипторы запрашиваются у сервера по адресу выше. Нажмите «Обнаружить».
        </div>
      ) : (
        <div style={{ height: 160, padding: '0 14px' }}>
          <CodeEditor
            value={grpc.proto ?? ''}
            language="plaintext"
            onChange={(proto) => set({ proto })}
          />
        </div>
      )}
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
      </div>

      {/* Connection options: TLS, per-call deadline, mTLS PEM paths */}
      <div style={{ display: 'flex', gap: 14, padding: '0 14px 8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--tx-2)' }}>
          <Toggle checked={grpc.plaintext ?? false} onChange={(plaintext) => set({ plaintext })} />
          Plaintext (без TLS)
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>
            Deadline (ms)
          </span>
          <input
            className="input"
            type="number"
            min={0}
            style={{ width: 120, height: 30 }}
            placeholder="нет"
            value={grpc.deadlineMs ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              set({ deadlineMs: e.target.value === '' || Number.isNaN(n) ? undefined : Math.max(0, Math.round(n)) })
            }}
          />
        </div>
      </div>
      {!grpc.plaintext && (
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px', flexWrap: 'wrap' }}>
          <PemPicker label="CA-сертификат" path={grpc.caCertPath} onPick={() => void pickPem('caCertPath')} onClear={() => set({ caCertPath: undefined })} />
          <PemPicker label="Client cert (mTLS)" path={grpc.clientCertPath} onPick={() => void pickPem('clientCertPath')} onClear={() => set({ clientCertPath: undefined })} />
          <PemPicker label="Client key (mTLS)" path={grpc.clientKeyPath} onPick={() => void pickPem('clientKeyPath')} onClear={() => set({ clientKeyPath: undefined })} />
        </div>
      )}

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

/** Compact file-path picker (path only — bytes are read in the main process). */
function PemPicker({
  label,
  path,
  onPick,
  onClear
}: {
  label: string
  path: string | undefined
  onPick: () => void
  onClear: () => void
}): JSX.Element {
  const name = path ? path.replace(/^.*[\\/]/, '') : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 160 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="btn ghost" type="button" style={{ height: 30, maxWidth: 200 }} onClick={onPick} title={path ?? undefined}>
          <Icon name="upload" size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? 'Выбрать…'}</span>
        </button>
        {path && (
          <button className="icon-btn" type="button" title="Очистить" aria-label="Очистить файл" onClick={onClear}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
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

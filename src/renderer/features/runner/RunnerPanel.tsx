import { useMemo } from 'react'
import { Modal } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { statusColor } from '@renderer/lib/status-color'
import { useRunner, type IterationResult } from '@renderer/store/runner'

/** Aggregate pass/fail/time across all iterations. */
function summarize(results: IterationResult[]): { reqs: number; passed: number; failed: number; timeMs: number } {
  let reqs = 0
  let passed = 0
  let failed = 0
  let timeMs = 0
  for (const it of results) {
    for (const r of it.requests) {
      reqs++
      timeMs += r.timeMs
      for (const t of r.tests) (t.passed ? (passed += 1) : (failed += 1))
    }
  }
  return { reqs, passed, failed, timeMs }
}

export function RunnerPanel(): JSX.Element | null {
  const open = useRunner((s) => s.open)
  const targetName = useRunner((s) => s.targetName)
  const iterations = useRunner((s) => s.iterations)
  const delayMs = useRunner((s) => s.delayMs)
  const dataFileName = useRunner((s) => s.dataFileName)
  const dataRows = useRunner((s) => s.dataRows)
  const dataError = useRunner((s) => s.dataError)
  const running = useRunner((s) => s.running)
  const current = useRunner((s) => s.current)
  const results = useRunner((s) => s.results)

  const summary = useMemo(() => summarize(results), [results])

  if (!open) return null

  const close = useRunner.getState().close

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={`Запуск: ${targetName}`} width={680}>
      {/* config */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--tx-2)' }}>
          Итераций
          <input
            className="input mono"
            type="number"
            min={1}
            max={1000}
            value={iterations}
            disabled={running}
            onChange={(e) => useRunner.getState().setIterations(Number(e.target.value))}
            style={{ width: 90, display: 'block', marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 12, color: 'var(--tx-2)' }}>
          Задержка (мс)
          <input
            className="input mono"
            type="number"
            min={0}
            max={60000}
            value={delayMs}
            disabled={running}
            onChange={(e) => useRunner.getState().setDelay(Number(e.target.value))}
            style={{ width: 90, display: 'block', marginTop: 4 }}
          />
        </label>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: 'var(--tx-2)', marginBottom: 4 }}>Файл данных (CSV/JSON)</div>
          {dataFileName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--tx-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dataFileName} · {dataRows.length} строк
              </span>
              <button className="icon-btn" style={{ width: 26, height: 26 }} disabled={running} onClick={() => useRunner.getState().clearData()} title="Убрать файл">
                <Icon name="close" size={13} />
              </button>
            </div>
          ) : (
            <button className="btn ghost" disabled={running} onClick={() => void useRunner.getState().loadDataFile()}>
              <Icon name="upload" size={13} />
              Выбрать файл
            </button>
          )}
        </div>
        {running ? (
          <button className="btn" onClick={() => useRunner.getState().cancel()}>
            <Icon name="stop" size={13} />
            Остановить
          </button>
        ) : (
          <button className="btn primary" onClick={() => void useRunner.getState().run()}>
            <Icon name="play" size={13} />
            Запустить
          </button>
        )}
      </div>

      {dataError && <div style={{ color: 'var(--s-5xx)', fontSize: 12, marginTop: 8 }}>{dataError}</div>}

      {/* progress */}
      {running && current && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--tx-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="refresh" size={13} className="spin" />
            Итерация {current.iter}, запрос «{current.reqName}»…
          </div>
        </div>
      )}

      {/* summary */}
      {results.length > 0 && (
        <div className="test-summary" style={{ marginTop: 14 }}>
          <span className="test-badge">{summary.reqs} запросов</span>
          <span className="test-badge pass">{summary.passed} тестов пройдено</span>
          <span className="test-badge fail">{summary.failed} провалено</span>
          <span className="test-badge">{summary.timeMs} ms</span>
        </div>
      )}

      {/* results */}
      <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 10 }}>
        {results.map((it) => (
          <div key={it.index} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0' }}>
              Итерация {it.index + 1}
            </div>
            {it.requests.map((r) => {
              const sc = statusColor(r.status)
              const failed = r.tests.filter((t) => !t.passed).length
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-2)', marginBottom: 5 }}>
                  <span className={`method-tag m-${r.method}`} style={{ flex: 'none' }}>
                    {r.method === 'DELETE' ? 'DEL' : r.method}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>{r.name}</span>
                  {r.error ? (
                    <span style={{ color: 'var(--s-5xx)', fontSize: 11.5 }}>{r.error}</span>
                  ) : (
                    <>
                      {r.tests.length > 0 && (
                        <span style={{ fontSize: 11.5, color: failed ? 'var(--s-5xx)' : 'var(--s-2xx)' }}>
                          {r.tests.length - failed}/{r.tests.length} тестов
                        </span>
                      )}
                      <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>{r.timeMs} ms</span>
                      <span className="mono" style={{ color: sc, fontWeight: 600, fontSize: 12, minWidth: 34, textAlign: 'right' }}>
                        {r.status || '—'}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {results.length === 0 && !running && (
          <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 12.5 }}>
            Настройте параметры и нажмите «Запустить». Будут выполнены все запросы выбранного узла по порядку.
          </div>
        )}
      </div>
    </Modal>
  )
}

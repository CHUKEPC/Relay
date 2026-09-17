import { useMemo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Modal, Toggle } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { statusColor } from '@renderer/lib/status-color'
import { useRunner, type IterationResult } from '@renderer/store/runner'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-runner.css'

/** Aggregate pass/fail/time across all iterations. */
function summarize(results: IterationResult[]): { reqs: number; passed: number; failed: number; errors: number; timeMs: number } {
  let reqs = 0
  let passed = 0
  let failed = 0
  let errors = 0
  let timeMs = 0
  for (const it of results) {
    for (const r of it.requests) {
      reqs++
      timeMs += r.timeMs
      if (r.error || !r.ok) errors++
      for (const t of r.tests) (t.passed ? (passed += 1) : (failed += 1))
    }
  }
  return { reqs, passed, failed, errors, timeMs }
}

/** Collection / folder picker — or the whole workspace, to hand-pick requests. */
function TargetPicker(): JSX.Element {
  const targetId = useRunner((s) => s.targetId)
  const targetName = useRunner((s) => s.targetName)
  const running = useRunner((s) => s.running)
  // Recomputed whenever the modal shows a different target — the collection
  // tree cannot change while it is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => useRunner.getState().targets(), [targetId])

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="btn ghost run-target" disabled={running}>
          <Icon name="folder" size={13} />
          <span className="run-target-name">{tr(targetName || 'Выберите коллекцию')}</span>
          <Icon name="chevDsm" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="popover run-target-pop" align="start" sideOffset={4} style={{ position: 'relative' }}>
          {targets.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              className={`pop-item ${targetId === t.id ? 'on' : ''}`}
              onSelect={() => useRunner.getState().setTarget(t.id)}
            >
              <span style={{ flex: 1, paddingLeft: t.depth * 12 }}>{tr(t.name)}</span>
              <span className="run-target-count">{t.requests}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="pop-sep" />
          <DropdownMenu.Item className={`pop-item ${targetId === null ? 'on' : ''}`} onSelect={() => useRunner.getState().setTarget(null)}>
            <Icon name="grid" size={14} />
            <span style={{ flex: 1 }}>{tr('Все коллекции — выбрать запросы вручную')}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** The ordered run list: tick what to send, drag-free reordering with arrows. */
function RunList(): JSX.Element {
  const items = useRunner((s) => s.items)
  const targetId = useRunner((s) => s.targetId)
  const running = useRunner((s) => s.running)
  const picked = items.filter((i) => i.enabled).length

  if (!items.length) {
    // Nothing to run means either an empty folder or an empty workspace — the
    // way out of each is a different one.
    return (
      <div className="run-list-empty">
        {tr(targetId ? 'В выбранной коллекции нет запросов.' : 'Пока нет сохранённых запросов — сохраните запрос в коллекцию, и его можно будет прогнать здесь.')}
      </div>
    )
  }

  return (
    <>
      <div className="run-list-head">
        <span>{trf('Запросов: {picked} из {total}', { picked, total: items.length })}</span>
        <button className="btn ghost" disabled={running} onClick={() => useRunner.getState().setAllItems(picked !== items.length)}>
          {picked === items.length ? tr('Снять все') : tr('Выбрать все')}
        </button>
      </div>
      <div className="run-list">
        {items.map((item, index) => (
          <div className={`run-item${item.enabled ? '' : ' off'}`} key={item.id}>
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={running}
              onChange={() => useRunner.getState().toggleItem(item.id)}
            />
            <span className={`method-tag m-${item.method}`}>{item.method === 'DELETE' ? 'DEL' : item.method}</span>
            <span className="run-item-name">{tr(item.name || 'Без названия')}</span>
            {item.path && <span className="run-item-path">{item.path}</span>}
            <div className="run-item-order">
              <button
                className="icon-btn"
                disabled={running || index === 0}
                title={tr('Выше')}
                onClick={() => useRunner.getState().moveItem(item.id, -1)}
              >
                <Icon name="chevD" size={12} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                className="icon-btn"
                disabled={running || index === items.length - 1}
                title={tr('Ниже')}
                onClick={() => useRunner.getState().moveItem(item.id, 1)}
              >
                <Icon name="chevD" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export function RunnerPanel(): JSX.Element | null {
  const open = useRunner((s) => s.open)
  const iterations = useRunner((s) => s.iterations)
  const delayMs = useRunner((s) => s.delayMs)
  const stopOnFailure = useRunner((s) => s.stopOnFailure)
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
    <Modal open={open} onOpenChange={(o) => !o && close()} title={tr('Раннер коллекций')} width={720}>
      <div className="run-bar">
        <TargetPicker />
        <label className="run-field">
          {tr('Итераций')}
          <input
            className="input mono"
            type="number"
            min={1}
            max={1000}
            value={iterations}
            disabled={running}
            onChange={(e) => useRunner.getState().setIterations(Number(e.target.value))}
          />
        </label>
        <label className="run-field">
          {tr('Задержка (мс)')}
          <input
            className="input mono"
            type="number"
            min={0}
            max={60000}
            value={delayMs}
            disabled={running}
            onChange={(e) => useRunner.getState().setDelay(Number(e.target.value))}
          />
        </label>
        <label className="run-field run-stop">
          {tr('Стоп при ошибке')}
          <Toggle
            checked={stopOnFailure}
            disabled={running}
            title={tr('Остановить прогон на первом упавшем запросе или тесте')}
            onChange={(v) => useRunner.getState().setStopOnFailure(v)}
          />
        </label>
      </div>

      <div className="run-bar">
        <div className="run-data">
          <span className="run-data-label">{tr('Файл данных (CSV/JSON)')}</span>
          {dataFileName ? (
            <>
              <span className="mono run-data-name">
                {dataFileName} · {trf('строк: {n}', { n: dataRows.length })}
              </span>
              <button className="icon-btn" disabled={running} onClick={() => useRunner.getState().clearData()} title={tr('Убрать файл')}>
                <Icon name="close" size={13} />
              </button>
            </>
          ) : (
            <button className="btn ghost" disabled={running} onClick={() => void useRunner.getState().loadDataFile()}>
              <Icon name="upload" size={13} /> {tr('Выбрать файл')}
            </button>
          )}
        </div>
        <div className="grow" />
        {results.length > 0 && !running && (
          <button className="btn ghost" onClick={() => void useRunner.getState().exportReport()}>
            <Icon name="download" size={13} /> {tr('Отчёт')}
          </button>
        )}
        {running ? (
          <button className="btn" onClick={() => useRunner.getState().cancel()}>
            <Icon name="stop" size={13} /> {tr('Остановить')}
          </button>
        ) : (
          <button className="btn primary" onClick={() => void useRunner.getState().run()}>
            <Icon name="play" size={13} /> {tr('Запустить')}
          </button>
        )}
      </div>

      {dataError && <div className="run-error">{dataError}</div>}

      {results.length === 0 && !running && <RunList />}

      {running && current && (
        <div className="run-progress">
          <Icon name="refresh" size={13} className="spin" />
          {trf('Итерация {n} из {total}, запрос «{name}»…', { n: current.iter, total: current.total, name: tr(current.reqName) })}
        </div>
      )}

      {results.length > 0 && (
        <div className="test-summary" style={{ marginTop: 14 }}>
          <span className="test-badge">{trf('запросов: {n}', { n: summary.reqs })}</span>
          <span className="test-badge pass">{trf('тестов пройдено: {n}', { n: summary.passed })}</span>
          <span className="test-badge fail">{trf('{n} провалено', { n: summary.failed })}</span>
          {summary.errors > 0 && <span className="test-badge fail">{trf('ошибок запросов: {n}', { n: summary.errors })}</span>}
          <span className="test-badge">{summary.timeMs} ms</span>
          {!running && (
            <button className="btn ghost run-again" onClick={() => useRunner.getState().setTarget(useRunner.getState().targetId)}>
              <Icon name="refresh" size={12} /> {tr('К списку запросов')}
            </button>
          )}
        </div>
      )}

      <div className="run-results">
        {results.map((it) => (
          <div key={it.index} className="run-iteration">
            {results.length > 1 && <div className="run-iteration-head">{trf('Итерация {n}', { n: it.index + 1 })}</div>}
            {it.requests.map((r) => {
              const sc = statusColor(r.status)
              const failed = r.tests.filter((t) => !t.passed).length
              return (
                <div key={r.id} className="run-result">
                  <span className={`method-tag m-${r.method}`}>{r.method === 'DELETE' ? 'DEL' : r.method}</span>
                  <span className="run-result-name">{tr(r.name)}</span>
                  {r.error ? (
                    <span className="run-result-err">{r.error}</span>
                  ) : (
                    <>
                      {r.tests.length > 0 && (
                        <span className={failed ? 'run-result-err' : 'run-result-ok'}>
                          {trf('{passed}/{total} тестов', { passed: r.tests.length - failed, total: r.tests.length })}
                        </span>
                      )}
                      <span className="run-result-time">{r.timeMs} ms</span>
                      <span className="mono run-result-status" style={{ color: sc }}>
                        {r.status || '—'}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}

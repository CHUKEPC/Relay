/**
 * pm.* script runner.
 *
 * Pre-request / test scripts can come from an imported (untrusted) collection and
 * run on every send, and `node:vm` is not a security boundary on its own (host
 * objects leak the host `Function`). So each run is executed in its OWN ISOLATED
 * CHILD PROCESS: the app re-forks its own bundle with `RELAY_SCRIPT_SANDBOX=1`
 * (routed to `startSandboxHost`, NOT the Electron app), `ELECTRON_RUN_AS_NODE=1`
 * (run the Electron binary as plain Node), and
 * `--disallow-code-generation-from-strings` (blocks eval/`new Function` — the only
 * vm escape vector). The script is confined to the `pm.*`/`console` surface,
 * cannot reach the main process or its decrypted secrets, and a CPU-bound runaway
 * is killed by the parent.
 *
 * IMPORTANT: there is intentionally NO in-process fallback. Running a script in
 * the main process (which is NOT launched with the flag) would re-open the exact
 * vm escape this exists to close, so when a child can't be forked we FAIL CLOSED
 * (return an error) rather than execute the script unsandboxed.
 *
 * One child per run: each call owns its child and listeners, so a timeout/crash
 * only affects that one run — never a concurrent one.
 */
import { fork, type ChildProcess } from 'node:child_process'
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ScriptRunRequest, ScriptRunResult } from '@shared/types'
import { runSandbox } from './sandbox'

/**
 * Outer wall-clock bound. The sandbox has its own 3s sync vm timeout + 3s
 * async-test bound, so a well-behaved script finishes well within this. This only
 * fires when a script blocks the child's event loop (CPU-bound after an `await`),
 * which the in-sandbox timers can't interrupt — then we kill the child.
 */
const HARD_TIMEOUT_MS = 8000

function errorResult(error: string): ScriptRunResult {
  return { logs: [], tests: [], environmentUpdates: {}, globalUpdates: {}, error }
}

/* ============================================================
 * Child side — runs inside the forked sandbox process.
 * ============================================================ */

/** Wire the forked child's message loop. Called from main/index.ts when the
 *  process was re-forked with RELAY_SCRIPT_SANDBOX=1. */
export function startSandboxHost(): void {
  // Self-test: confirm eval/new Function are actually disabled here (i.e. the
  // --disallow-code-generation-from-strings flag took effect). If they are NOT,
  // the only barrier left is the in-vm codeGeneration option, which the threat
  // model treats as insufficient (host objects leak the host Function) — so we
  // FAIL CLOSED and refuse to execute the script at all rather than run it under
  // weak isolation.
  let codegenBlocked = false
  try {
    // eslint-disable-next-line no-new-func
    Function('return 1')()
  } catch {
    codegenBlocked = true
  }
  process.on('message', async (msg: { payload: ScriptRunRequest }) => {
    let result: ScriptRunResult
    if (!codegenBlocked) {
      result = errorResult('Script sandbox isolation is unavailable on this platform')
    } else {
      try {
        result = await runSandbox(msg.payload)
      } catch (err) {
        result = errorResult(err instanceof Error ? err.message : String(err))
      }
    }
    try {
      process.send?.({ result, codegenBlocked })
    } catch {
      /* parent went away — nothing to do */
    }
  })
}

/* ============================================================
 * App side — one isolated child per run; fail closed.
 * ============================================================ */

/** Live sandbox children, so they can all be reaped on app shutdown. */
const liveChildren = new Set<ChildProcess>()
let warnedNoFlag = false

// Cap concurrent sandbox children so a collection run / rapid sends can't spawn
// dozens of heavyweight Electron-as-Node processes at once.
const MAX_CONCURRENT_SANDBOXES = 4
let activeCount = 0
const slotWaiters: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_SANDBOXES) {
    activeCount++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => slotWaiters.push(resolve))
}

function releaseSlot(): void {
  const next = slotWaiters.shift()
  if (next) next() // hand our slot to the next waiter (activeCount unchanged)
  else activeCount--
}

/** Kill all sandbox children (call on app shutdown). */
export function stopScriptSandbox(): void {
  for (const c of liveChildren) {
    try {
      c.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  liveChildren.clear()
}

function runOne(payload: ScriptRunRequest): Promise<ScriptRunResult> {
  return new Promise<ScriptRunResult>((resolve) => {
    let proc: ChildProcess
    try {
      proc = fork(__filename, [], {
        env: { ...process.env, RELAY_SCRIPT_SANDBOX: '1', ELECTRON_RUN_AS_NODE: '1' },
        execArgv: ['--disallow-code-generation-from-strings']
      })
    } catch {
      // Fail closed — never run a script in-process (that re-opens the vm escape).
      resolve(errorResult('Script sandbox unavailable'))
      return
    }
    liveChildren.add(proc)

    let settled = false
    const finish = (r: ScriptRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveChildren.delete(proc)
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve(r)
    }
    const timer = setTimeout(() => finish(errorResult('Script execution timed out')), HARD_TIMEOUT_MS)

    proc.once('message', (msg: { result?: ScriptRunResult; codegenBlocked?: boolean }) => {
      if (msg?.codegenBlocked === false && !warnedNoFlag) {
        warnedNoFlag = true
        console.warn('[scripting] sandbox child is NOT enforcing code-generation restrictions')
      }
      finish(msg?.result ?? errorResult('Script sandbox returned no result'))
    })
    proc.once('error', () => finish(errorResult('Script sandbox unavailable')))
    proc.once('exit', () => finish(errorResult('Script sandbox stopped')))

    try {
      proc.send({ payload })
    } catch {
      finish(errorResult('Script sandbox unavailable'))
    }
  })
}

export async function runScript(payload: ScriptRunRequest): Promise<ScriptRunResult> {
  await acquireSlot()
  try {
    return await runOne(payload)
  } finally {
    releaseSlot()
  }
}

export function registerScriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.script.run, async (_e, payload: ScriptRunRequest) => runScript(payload))
}

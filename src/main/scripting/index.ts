/**
 * pm.* script runner.
 *
 * Pre-request / test scripts can come from an imported (untrusted) collection and
 * run on every send, and `node:vm` is not a security boundary on its own (host
 * objects leak the host `Function`). So each run is executed in an ISOLATED CHILD
 * PROCESS: the app re-forks its own bundle with `RELAY_SCRIPT_SANDBOX=1` (routed
 * to `startSandboxHost`, NOT the Electron app), `ELECTRON_RUN_AS_NODE=1` (run the
 * Electron binary as plain Node), and `--disallow-code-generation-from-strings`
 * (blocks eval/`new Function` — the only vm escape vector). The script is thus
 * confined to the `pm.*`/`console` surface, cannot reach the main process or its
 * decrypted secrets, and a CPU-bound runaway is killed by the parent.
 *
 * A single long-lived child is reused (correlated by id) for speed and re-forked
 * if it hangs/crashes. If this environment can't run the child at all, runs fall
 * back to the hardened in-process vm so scripting still works.
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
  process.on('message', async (msg: { id: number; payload: ScriptRunRequest }) => {
    let result: ScriptRunResult
    try {
      result = await runSandbox(msg.payload)
    } catch (err) {
      result = errorResult(err instanceof Error ? err.message : String(err))
    }
    process.send?.({ id: msg.id, result })
  })
}

/* ============================================================
 * App side — manage the isolated child process.
 * ============================================================ */

let child: ChildProcess | null = null
let childUsable = true
let seq = 0
const pending = new Map<number, { resolve: (r: ScriptRunResult) => void; payload: ScriptRunRequest }>()

function ensureChild(): ChildProcess | null {
  if (!childUsable) return null
  if (child && child.connected) return child
  try {
    child = fork(__filename, [], {
      env: { ...process.env, RELAY_SCRIPT_SANDBOX: '1', ELECTRON_RUN_AS_NODE: '1' },
      execArgv: ['--disallow-code-generation-from-strings']
    })
  } catch {
    childUsable = false
    child = null
    return null
  }
  let proven = false
  child.on('message', (msg: { id: number; result: ScriptRunResult }) => {
    proven = true
    const entry = pending.get(msg.id)
    if (entry) {
      pending.delete(msg.id)
      entry.resolve(msg.result)
    }
  })
  const onGone = (): void => {
    child = null
    const stranded = [...pending.values()]
    pending.clear()
    if (!proven) {
      // The child never returned a result → this environment can't run it.
      // Degrade to the hardened in-process vm for these and all future runs.
      childUsable = false
      for (const e of stranded) void runSandbox(e.payload).then(e.resolve, () => e.resolve(errorResult('Script failed')))
    } else {
      // A proven child died (crash or timeout-kill): do NOT re-run in-process
      // (it may be a hung/hostile script that would freeze main). Surface an
      // error; the next call re-forks a fresh child.
      for (const e of stranded) e.resolve(errorResult('Script sandbox stopped'))
    }
  }
  child.once('exit', onGone)
  child.once('error', onGone)
  return child
}

/** Kill the sandbox child (call on app shutdown, or when a script hangs). */
export function stopScriptSandbox(): void {
  if (child) child.kill('SIGKILL')
}

export function runScript(payload: ScriptRunRequest): Promise<ScriptRunResult> {
  const proc = ensureChild()
  if (!proc) return runSandbox(payload) // no isolated child available → hardened in-process vm
  const id = ++seq
  return new Promise<ScriptRunResult>((resolve) => {
    let settled = false
    const finish = (r: ScriptRunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pending.delete(id)
      resolve(r)
    }
    const timer = setTimeout(() => {
      finish(errorResult('Script execution timed out'))
      stopScriptSandbox() // a CPU-blocked child can't be unstuck; it re-forks next call
    }, HARD_TIMEOUT_MS)
    pending.set(id, { resolve: finish, payload })
    try {
      proc.send({ id, payload })
    } catch {
      // Couldn't hand off → run in-process so the script still executes.
      void runSandbox(payload).then(finish, () => finish(errorResult('Script failed')))
    }
  })
}

export function registerScriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.script.run, async (_e, payload: ScriptRunRequest) => runScript(payload))
}

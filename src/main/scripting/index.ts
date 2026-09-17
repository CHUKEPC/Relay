/**
 * pm.* script runner.
 *
 * Pre-request / test scripts can come from an imported (untrusted) collection and
 * run on every send, and `node:vm` is not a security boundary on its own (host
 * objects leak the host `Function`). So each run is executed in its OWN ISOLATED
 * CHILD PROCESS: the app forks `out/main/sandbox.js` (an electron-free bundle
 * whose entry is `src/main/sandbox-entry.ts`, routed to `startSandboxHost`) with
 * `RELAY_SCRIPT_SANDBOX=1`, `ELECTRON_RUN_AS_NODE=1`
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
 * One child per run at a time: each call owns its child and listeners, so a
 * timeout/crash only affects that one run — never a concurrent one. A child that
 * finished cleanly is kept warm and handed to the NEXT script instead of being
 * killed (see `keepWarm`), which is what keeps a collection run from paying half
 * a second of process startup per script.
 */
import { fork, type ChildProcess } from 'node:child_process'
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ScriptRunRequest, ScriptRunResult } from '@shared/types'
import { sandboxEntryPath } from '../sandbox-path'
import { recordAsyncScriptError, runSandbox, sandboxLeftPendingWork } from './sandbox'

/**
 * Outer wall-clock bound: only fires when a script blocks the child's event loop
 * (CPU-bound after an `await`), which the in-sandbox timers cannot interrupt —
 * then we kill the child.
 *
 * It has to stay clear of the sandbox's own budget, which follows the request
 * timeout when the script has a pm.sendRequest in flight; otherwise a slow token
 * endpoint gets the child killed instead of reporting a result.
 */
const MIN_HARD_TIMEOUT_MS = 8000
const MAX_HARD_TIMEOUT_MS = 30000

function hardTimeoutFor(payload: ScriptRunRequest): number {
  const requestBudget = (payload.settings?.timeoutMs ?? 30000) + 6000
  return Math.min(Math.max(MIN_HARD_TIMEOUT_MS, requestBudget), MAX_HARD_TIMEOUT_MS)
}

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

  // Node exits the process on an unhandled rejection or an uncaught exception.
  // In a one-run-per-child sandbox that means a script which ignores a rejected
  // pm.sendRequest promise loses its whole run («Script sandbox stopped») —
  // including the requests that did succeed. Route both into the run's result
  // and keep the child alive; a failure that arrives after the run is over has
  // nowhere to go but stderr.
  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (!recordAsyncScriptError(message)) console.error('[scripting] unhandled rejection after the run:', message)
  })
  process.on('uncaughtException', (err: Error) => {
    if (!recordAsyncScriptError(err.message)) console.error('[scripting] uncaught exception after the run:', err.message)
  })
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
      // `pending` tells the parent whether this child is safe to reuse.
      process.send?.({ result, codegenBlocked, pending: sandboxLeftPendingWork() })
    } catch {
      /* parent went away — nothing to do */
    }
  })
}

/* ============================================================
 * App side — a pool of warm isolated children; fail closed.
 * ============================================================ */

/** Live sandbox children (busy and warm), so they can all be reaped on shutdown. */
const liveChildren = new Set<ChildProcess>()
let warnedNoFlag = false

/**
 * Children kept alive for the NEXT script.
 *
 * Forking the Electron binary as Node and loading this bundle costs ~500 ms of
 * pure CPU, and a collection run pays it TWICE PER REQUEST (pre-request script,
 * test script). That startup — not the scripts — is what pinned a core near
 * 100 % during a run and added half a second to every request. A child that
 * finished a run with nothing left in flight goes back in this pool, and the
 * next script starts in single-digit milliseconds.
 *
 * Isolation is unchanged where it matters: every run still executes in a
 * brand-new `vm` context inside a process launched with
 * `--disallow-code-generation-from-strings`, and a child is RETIRED (killed,
 * never reused) whenever its run timed out, crashed, or left async work in
 * flight — the only ways a previous script could still be running when the next
 * one starts.
 */
const warmChildren: { proc: ChildProcess; since: number }[] = []
const MAX_WARM = 2
const WARM_TTL_MS = 120_000
let reaper: ReturnType<typeof setInterval> | null = null

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

/**
 * The child runs its OWN bundle, which has no `require('electron')` anywhere in
 * it (see ../sandbox-entry.ts). Forking the app's main bundle instead worked
 * only in development, where the `electron` npm package is on disk; in a
 * packaged app that require throws, the child dies before reading its message,
 * and every script fails with «Script sandbox stopped».
 */
function forkSandbox(): ChildProcess | null {
  try {
    const proc = fork(sandboxEntryPath(), [], {
      env: { ...process.env, RELAY_SCRIPT_SANDBOX: '1', ELECTRON_RUN_AS_NODE: '1' },
      execArgv: ['--disallow-code-generation-from-strings']
    })
    liveChildren.add(proc)
    return proc
  } catch {
    // Fail closed — never run a script in-process (that re-opens the vm escape).
    return null
  }
}

function retire(proc: ChildProcess): void {
  liveChildren.delete(proc)
  try {
    proc.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

/** Let go of warm children nobody came back for. */
function reapWarm(): void {
  const cutoff = Date.now() - WARM_TTL_MS
  for (let i = warmChildren.length - 1; i >= 0; i--) {
    if (warmChildren[i].since <= cutoff) retire(warmChildren.splice(i, 1)[0].proc)
  }
  if (!warmChildren.length && reaper) {
    clearInterval(reaper)
    reaper = null
  }
}

function takeWarm(): ChildProcess | null {
  while (warmChildren.length) {
    const { proc } = warmChildren.pop()!
    if (proc.connected && !proc.killed) return proc
    retire(proc)
  }
  return null
}

function keepWarm(proc: ChildProcess): void {
  if (!proc.connected || proc.killed || warmChildren.length >= MAX_WARM) {
    retire(proc)
    return
  }
  warmChildren.push({ proc, since: Date.now() })
  if (!reaper) {
    reaper = setInterval(reapWarm, WARM_TTL_MS)
    reaper.unref?.()
  }
}

/** Kill all sandbox children (call on app shutdown). */
export function stopScriptSandbox(): void {
  warmChildren.length = 0
  if (reaper) {
    clearInterval(reaper)
    reaper = null
  }
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
  const proc = takeWarm() ?? forkSandbox()
  if (!proc) return Promise.resolve(errorResult('Script sandbox unavailable'))

  return new Promise<ScriptRunResult>((resolve) => {
    let settled = false
    /** `reuse`: this child is idle and clean, so the next script can have it. */
    const finish = (r: ScriptRunResult, reuse: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.off('message', onMessage)
      proc.off('error', onError)
      proc.off('exit', onExit)
      if (reuse) keepWarm(proc)
      else retire(proc)
      resolve(r)
    }
    const onMessage = (msg: { result?: ScriptRunResult; codegenBlocked?: boolean; pending?: boolean }): void => {
      if (msg?.codegenBlocked === false && !warnedNoFlag) {
        warnedNoFlag = true
        console.warn('[scripting] sandbox child is NOT enforcing code-generation restrictions')
      }
      finish(msg?.result ?? errorResult('Script sandbox returned no result'), msg?.pending === false)
    }
    const onError = (): void => finish(errorResult('Script sandbox unavailable'), false)
    const onExit = (): void => finish(errorResult('Script sandbox stopped'), false)
    // Only fires when a script blocks the child's event loop, which the
    // in-sandbox timers cannot interrupt: that child is unusable afterwards.
    const timer = setTimeout(() => finish(errorResult('Script execution timed out'), false), hardTimeoutFor(payload))

    proc.on('message', onMessage)
    proc.on('error', onError)
    proc.on('exit', onExit)

    try {
      proc.send({ payload })
    } catch {
      finish(errorResult('Script sandbox unavailable'), false)
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

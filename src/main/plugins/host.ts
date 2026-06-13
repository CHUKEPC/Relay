/**
 * Plugin sandbox host — fork orchestration, mirroring the `pm.*` script host
 * (`src/main/scripting/index.ts`) and inheriting its threat model:
 *
 * Plugin code is untrusted third-party JavaScript, so every event dispatch runs
 * in its OWN ISOLATED CHILD PROCESS: the app re-forks its own bundle with
 * `RELAY_PLUGIN_SANDBOX=1` (routed to `startPluginSandboxHost`, NOT the Electron
 * app), `ELECTRON_RUN_AS_NODE=1`, and `--disallow-code-generation-from-strings`
 * (blocks eval/`new Function` — the only vm escape vector).
 *
 * IMPORTANT: there is intentionally NO in-process fallback. If a child can't be
 * forked, or the codegen flag is not in effect inside the child, we FAIL CLOSED
 * and return an error rather than execute plugin code with weaker isolation.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { createContext, runInContext } from 'node:vm'
import type { PluginRunRequest, PluginRunResult } from '@shared/types'
import { runPluginEvent } from './sandbox'

/**
 * Outer wall-clock bound. The sandbox's own budget is 3s sync vm timeout +
 * 10s async handler bound = 13s, plus fork/startup overhead — so a plugin
 * staying inside both in-sandbox bounds is never killed by this. It only
 * fires when plugin code blocks the child's event loop (CPU-bound after an
 * `await`), which the in-sandbox timers can't interrupt — then we kill the child.
 */
const HARD_TIMEOUT_MS = 15_000

/** Cap concurrent plugin sandboxes (a response hook can fan out to N plugins). */
const MAX_CONCURRENT_PLUGIN_SANDBOXES = 2

function errorResult(error: string): PluginRunResult {
  return { logs: [], error }
}

/* ============================================================
 * Child side — runs inside the forked sandbox process.
 * ============================================================ */

/** Wire the forked child's message loop. Called from main/index.ts when the
 *  process was re-forked with RELAY_PLUGIN_SANDBOX=1. */
export function startPluginSandboxHost(): void {
  // Self-test (FAIL CLOSED): confirm code-generation is actually disabled in
  // BOTH realms that matter —
  //   (1) the child's top-level realm (proves the process-level
  //       --disallow-code-generation-from-strings flag is in effect), and
  //   (2) a node:vm context built exactly like the one plugin code runs in
  //       (proves the per-context codeGeneration:{strings:false} option bites).
  // If either can still synthesize code, we refuse to run plugin code at all.
  let topLevelBlocked = false
  try {
    // eslint-disable-next-line no-new-func
    Function('return 1')()
  } catch {
    topLevelBlocked = true
  }
  let vmBlocked = false
  try {
    const probe = createContext({}, { codeGeneration: { strings: false, wasm: false } })
    runInContext('Function("return 1")()', probe)
  } catch {
    vmBlocked = true
  }
  const codegenBlocked = topLevelBlocked && vmBlocked
  process.on('message', async (msg: { payload: PluginRunRequest }) => {
    let result: PluginRunResult
    if (!codegenBlocked) {
      result = errorResult('Plugin sandbox isolation is unavailable on this platform')
    } else {
      try {
        result = await runPluginEvent(msg.payload)
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
 * App side — one isolated child per event; fail closed.
 * ============================================================ */

/** Live sandbox children, so they can all be reaped on app shutdown. */
const liveChildren = new Set<ChildProcess>()
let warnedNoFlag = false

let activeCount = 0
const slotWaiters: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_PLUGIN_SANDBOXES) {
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

/** Kill all plugin sandbox children (call on app shutdown). */
export function stopPluginSandbox(): void {
  for (const c of liveChildren) {
    try {
      c.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  liveChildren.clear()
}

function runOne(payload: PluginRunRequest, timeoutMs: number): Promise<PluginRunResult> {
  return new Promise<PluginRunResult>((resolve) => {
    let proc: ChildProcess
    try {
      proc = fork(__filename, [], {
        env: { ...process.env, RELAY_PLUGIN_SANDBOX: '1', ELECTRON_RUN_AS_NODE: '1' },
        execArgv: ['--disallow-code-generation-from-strings']
      })
    } catch {
      // Fail closed — never run plugin code in-process.
      resolve(errorResult('Plugin sandbox unavailable'))
      return
    }
    liveChildren.add(proc)

    let settled = false
    const finish = (r: PluginRunResult): void => {
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
    const timer = setTimeout(() => finish(errorResult('Plugin handler timed out')), timeoutMs)

    proc.once('message', (msg: { result?: PluginRunResult; codegenBlocked?: boolean }) => {
      if (msg?.codegenBlocked === false && !warnedNoFlag) {
        warnedNoFlag = true
        console.warn('[plugins] sandbox child is NOT enforcing code-generation restrictions')
      }
      finish(msg?.result ?? errorResult('Plugin sandbox returned no result'))
    })
    proc.once('error', () => finish(errorResult('Plugin sandbox unavailable')))
    proc.once('exit', () => finish(errorResult('Plugin sandbox stopped')))

    try {
      proc.send({ payload })
    } catch {
      finish(errorResult('Plugin sandbox unavailable'))
    }
  })
}

/**
 * Run a plugin event in the sandbox. `timeoutMs` overrides the default hard
 * wall-clock — the pre-request hook passes a shorter bound so a slow plugin
 * can't stall the user's send for the full 15 s.
 */
export async function runPluginInSandbox(
  payload: PluginRunRequest,
  timeoutMs: number = HARD_TIMEOUT_MS
): Promise<PluginRunResult> {
  await acquireSlot()
  try {
    return await runOne(payload, timeoutMs)
  } finally {
    releaseSlot()
  }
}

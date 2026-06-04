import type { KV, ToolSpec } from '@shared/types'
import { useTabs } from '../store/tabs'
import { useEnvironments } from '../store/environments'
import { useResponse } from '../store/response'
import { sendActiveRequest, currentSecretValues } from './request-runner'
import { redactSecrets, maskHeaderValue } from './ai-context'
import { splitUrl } from './url'

/** Tools the assistant may call. Mutating/sending tools require confirmation. */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_current_request',
    description: 'Read the currently open request (method, url, headers, body, auth type). Secret values are masked.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'get_last_response',
    description: 'Read a summary of the last response for the open request (status, time, size, truncated body).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'update_current_request',
    description: 'Modify the currently open request. Only provided fields are changed.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string' },
        url: { type: 'string' },
        headers: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } } },
        body: { type: 'string', description: 'raw request body' },
        bodyLanguage: { type: 'string', enum: ['json', 'text', 'xml', 'html', 'javascript'] }
      }
    }
  },
  {
    name: 'set_variable',
    description: 'Set an environment or global variable.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['environment', 'global'] },
        key: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['scope', 'key', 'value']
    }
  },
  {
    name: 'send_request',
    description: 'Send the currently open request and return the response status.',
    parameters: { type: 'object', properties: {} }
  }
]

const MUTATING = new Set(['update_current_request', 'set_variable', 'send_request'])

export function isMutating(name: string): boolean {
  return MUTATING.has(name)
}

export function describeToolCall(name: string, args: any): { title: string; detail: string } {
  switch (name) {
    case 'update_current_request':
      return { title: 'Изменить текущий запрос', detail: JSON.stringify(args, null, 2) }
    case 'set_variable':
      return { title: `Установить переменную (${args.scope})`, detail: `${args.key} = ${args.value}` }
    case 'send_request':
      return { title: 'Отправить текущий запрос', detail: 'Запрос будет выполнен.' }
    default:
      return { title: name, detail: JSON.stringify(args, null, 2) }
  }
}

export async function executeTool(name: string, rawArgs: string): Promise<string> {
  let args: any = {}
  try {
    args = JSON.parse(rawArgs || '{}')
  } catch {
    /* ignore */
  }
  const tabs = useTabs.getState()
  const tab = tabs.activeTab()

  switch (name) {
    case 'get_current_request': {
      if (!tab) return 'No request open.'
      const r = tab.request
      const secrets = currentSecretValues()
      return JSON.stringify({
        method: r.method,
        url: redactSecrets(r.url, secrets),
        headers: r.headers
          .filter((h) => h.enabled)
          .map((h) => ({ key: h.key, value: redactSecrets(maskHeaderValue(h.key, h.value), secrets) })),
        bodyType: r.body.type,
        authType: r.auth.type
      })
    }
    case 'get_last_response': {
      if (!tab) return 'No request open.'
      const res = useResponse.getState().get(tab.id).result
      if (!res) return 'No response yet.'
      const secrets = currentSecretValues()
      return JSON.stringify({
        status: res.status,
        timeMs: res.timings.totalMs,
        sizeBytes: res.body.sizeBytes,
        bodyPreview: redactSecrets((res.body.text ?? '').slice(0, 2000), secrets)
      })
    }
    case 'update_current_request': {
      const patch: any = {}
      if (typeof args.method === 'string' && args.method) patch.method = args.method.toUpperCase()
      if (typeof args.url === 'string' && args.url) {
        // Split any query string out of the URL so it isn't sent twice (the model
        // tends to provide a full URL while request.query is kept separately).
        const { base, query } = splitUrl(args.url)
        patch.url = base
        if (query.length) patch.query = query
      }
      if (Array.isArray(args.headers))
        patch.headers = args.headers
          .filter((h: any) => h && h.key)
          .map((h: KV) => ({ key: h.key, value: h.value ?? '', enabled: true }))
      if (typeof args.body === 'string') patch.body = { type: 'raw', language: args.bodyLanguage ?? 'json', text: args.body }
      tabs.patchActive(patch)
      return 'Request updated.'
    }
    case 'set_variable': {
      const envStore = useEnvironments.getState()
      if (args.scope === 'global') {
        const vars = [...envStore.globals.variables]
        const i = vars.findIndex((v) => v.key === args.key)
        if (i >= 0) vars[i] = { ...vars[i], value: args.value }
        else vars.push({ key: args.key, value: args.value, enabled: true })
        envStore.setGlobalVars(vars)
      } else {
        const active = envStore.activeEnv()
        if (!active) return 'No active environment to set the variable in.'
        const vars = [...active.variables]
        const i = vars.findIndex((v) => v.key === args.key)
        if (i >= 0) vars[i] = { ...vars[i], value: args.value }
        else vars.push({ key: args.key, value: args.value, enabled: true })
        envStore.setEnvVars(active.id, vars)
      }
      return `Variable ${args.key} set.`
    }
    case 'send_request': {
      await sendActiveRequest()
      const res = tab ? useResponse.getState().get(tab.id).result : undefined
      return res ? `Sent. Status ${res.status} in ${res.timings.totalMs} ms.` : 'Sent.'
    }
    default:
      return `Unknown tool: ${name}`
  }
}

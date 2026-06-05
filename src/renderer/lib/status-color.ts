/** Pick the status-family color CSS variable for an HTTP status code.
 *  `status <= 0` is a network/transport error (no response). */
export function statusColor(status: number): string {
  if (status <= 0 || status >= 500) return 'var(--s-5xx)'
  if (status >= 400) return 'var(--s-4xx)'
  if (status >= 300) return 'var(--s-3xx)'
  return 'var(--s-2xx)'
}

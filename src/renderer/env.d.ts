/// <reference types="vite/client" />
import type { RelayApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api: RelayApi
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MonacoEnvironment?: any
  }
}

export {}

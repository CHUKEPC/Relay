import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Network-dependent suites are opt-in via RELAY_NET_TESTS=1 to keep CI offline-safe.
    testTimeout: 20000
  }
})

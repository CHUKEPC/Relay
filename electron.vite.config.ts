import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer'),
  '@main': resolve('src/main')
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    // Node 17+ binds "localhost" to ::1 on Windows while Electron dials
    // 127.0.0.1, so the window got ERR_CONNECTION_REFUSED. Pin the address.
    server: { host: '127.0.0.1' },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    },
    worker: {
      format: 'es'
    }
  }
})

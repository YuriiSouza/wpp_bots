import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Google service-account key is kept out of git and embedded at build time.
const KEY_FILE = resolve(__dirname, 'service-account.local.json')
const SERVICE_ACCOUNT_KEY = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8') : ''

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    define: {
      __SERVICE_ACCOUNT_KEY__: JSON.stringify(SERVICE_ACCOUNT_KEY),
    },
  },
})

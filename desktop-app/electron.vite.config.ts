import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Credenciais do OAuth client (tipo "Desktop") — não são confidenciais, mas ficam
// fora do git (arquivo gitignored) e são embutidas no processo main em build time.
const OAUTH_FILE = resolve(__dirname, 'google-oauth.local.json')
const GOOGLE_OAUTH = existsSync(OAUTH_FILE)
  ? JSON.parse(readFileSync(OAUTH_FILE, 'utf8'))
  : { clientId: '', clientSecret: '' }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __GOOGLE_OAUTH__: JSON.stringify(GOOGLE_OAUTH),
    },
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
  },
})

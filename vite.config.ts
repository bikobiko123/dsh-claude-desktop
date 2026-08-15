import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { dshDevelopmentProxyPlugin, normalizeDshDevOrigin } from './src/dev/dsh-dev-proxy.js'

export default defineConfig(() => {
  const dshOrigin = normalizeDshDevOrigin(process.env.DSH_DEV_ORIGIN)

  return {
    plugins: [react(), dshDevelopmentProxyPlugin(dshOrigin)],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: false,
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: dshOrigin,
          changeOrigin: true,
          headers: { origin: dshOrigin },
          ws: true,
          configure(proxy) {
            proxy.on('proxyReqWs', (request) => {
              request.setHeader('origin', dshOrigin)
            })
          },
        },
        '/plugins': {
          target: dshOrigin,
          changeOrigin: true,
        },
      },
    },
  }
})

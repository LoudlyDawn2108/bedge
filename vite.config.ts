import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    solid(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      devOptions: {
        enabled: true,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  worker: {
    format: 'es'
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    exclude: ['mupdf']
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    fs: {
      // Allow serving files from node_modules/mupdf
      allow: ['..']
    }
  }
})

import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [solid(), basicSsl()],
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

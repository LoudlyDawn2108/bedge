import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
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

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dependencies reached only through lazy chunks (music downloads, the canvas, the map, photo
  // import...). Pre-bundle them so the dev server doesn't discover them on first use and force a
  // full page reload (which drops you back on the home screen).
  optimizeDeps: {
    include: [
      'wasm-media-encoders',
      'histropediajs', 'gifuct-js', 'katex',
      'react-markdown', 'rehype-katex', 'remark-math',
      'leaflet', 'heic-to/csp',
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  }
})

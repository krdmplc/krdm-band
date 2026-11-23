import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    // One bundle on purpose: the service worker (public/sw.js) caches what
    // index.html links, so the whole app opens offline at a venue. ~300 kB gzipped.
    chunkSizeWarningLimit: 1200
  }
})

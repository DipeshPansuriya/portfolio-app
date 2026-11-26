import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Runtime secrets (database, generated password). Anchored to this folder
// because a bare `data/**` rule would also block the source files in `src/data/`.
const dataDir = normalizePath(fileURLToPath(new URL('./data', import.meta.url))).replace(/[()[\]{}*?!+@|\\]/g, '\\$&')

// The admin API is a separate Node process (`npm run admin`).
const api = { target: process.env.ADMIN_ORIGIN || 'http://127.0.0.1:4319', changeOrigin: false }

export default defineConfig(({ isSsrBuild }) => ({
  // The hero shell bundle (ADR 0003) carries React itself: the runtime needs only `pg`.
  ssr: isSsrBuild ? { noExternal: true } : {},
  define: isSsrBuild ? { 'process.env.NODE_ENV': '"production"' } : {},
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // Replaces Vite's default list, so its entries are repeated here.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', `${dataDir}/**`, '*.{db,db-wal,db-shm}'],
    },
    proxy: {
      '/api': api,
      // The live content is held by the API, not by a file (ADR 0002).
      '/content/site.json': api,
    },
  },
  build: {
    target: 'es2022',
    copyPublicDir: !isSsrBuild,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) return 'motion'
        },
      },
    },
  },
}))

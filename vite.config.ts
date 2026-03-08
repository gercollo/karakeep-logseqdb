import { defineConfig } from 'vite'
import logseqPlugin from 'vite-plugin-logseq'

export default defineConfig({
  plugins: [logseqPlugin()],
  server: {
    port: 3003,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})

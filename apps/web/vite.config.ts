import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // When port 8000 is taken locally, override it with XUNJI_API_TARGET=http://127.0.0.1:8010
        target: process.env.XUNJI_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
})

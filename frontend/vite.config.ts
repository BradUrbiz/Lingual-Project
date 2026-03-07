import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cubism': path.resolve(__dirname, '../CubismSdkForWeb-5-r.4/Framework/dist'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        ws: true,
      },
    },
    headers: {
      // Allow Google OAuth popup to work properly
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})

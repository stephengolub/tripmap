/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The hosted build is served from GitHub Pages under /tripmap/.
  base: process.env.VITE_MODE === 'hosted' ? '/tripmap/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser only ever talks to the dev server; /api goes to `tripmap serve`.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ is Playwright's (npx playwright test), not Vitest's.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})

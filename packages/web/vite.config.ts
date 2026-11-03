/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// The hosted page pins the npx command to the CLI version it was built with.
const cliPackage = JSON.parse(
  readFileSync(new URL('../cli/package.json', import.meta.url), 'utf8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // The hosted build is served from GitHub Pages under /tripmap/.
  base: process.env.VITE_MODE === 'hosted' ? '/tripmap/' : '/',
  plugins: [react()],
  define: {
    __TRIPMAP_VERSION__: JSON.stringify(cliPackage.version),
  },
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

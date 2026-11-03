import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive the real app: the FastAPI backend on 127.0.0.1:8000
// and the Vite dev server on :5173, which proxies /api to it.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run --project ../.. tripmap-api',
      url: 'http://127.0.0.1:8000/openapi.json',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})

import { defineConfig } from '@playwright/test'

// Two-browser end-to-end tests: a fresh in-memory relay and the production build
// (served with production security headers). Run with `npm run e2e`.
const testEnv = {
  VITE_RELAYS: 'ws://localhost:7777',
  VITE_BLOCK_SOURCES: 'http://localhost:7777/api/blocks/tip/height',
  VITE_PUSH_URL: 'http://localhost:8787',
  VITE_BLOSSOM_SERVER: 'http://localhost:7777',
}

/** The same build with wagers switched on (FEATURES.wagers), for the wager tests. */
export const WAGERS_URL = 'http://localhost:4175'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    viewport: { width: 430, height: 900 },
    // Uses the system Chromium; set CHROMIUM_PATH if yours lives elsewhere.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' },
    permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node scripts/dev-relay.mjs', port: 7777, reuseExistingServer: false },
    {
      command: 'vite build --outDir dist-e2e --emptyOutDir && vite preview --outDir dist-e2e --port 4174 --strictPort',
      port: 4174,
      env: testEnv,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'vite build --outDir dist-e2e-wagers --emptyOutDir && vite preview --outDir dist-e2e-wagers --port 4175 --strictPort',
      port: 4175,
      env: { ...testEnv, VITE_ENABLE_WAGERS: 'true' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // The push service (push/), fresh data each run.
      command: 'rm -rf push-data-e2e && vite build -c push/vite.config.ts && node push/dist/server.mjs',
      url: 'http://localhost:8787/health',
      env: {
        PORT: '8787',
        PUBLIC_URL: 'http://localhost:8787',
        APP_URL: 'http://localhost:4174',
        ALLOWED_ORIGINS: 'http://localhost:4174',
        RELAYS: 'ws://localhost:7777',
        BLOCK_SOURCES: 'http://localhost:7777/api/blocks/tip/height',
        DATA_DIR: 'push-data-e2e',
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})

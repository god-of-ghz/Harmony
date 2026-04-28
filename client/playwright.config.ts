import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Harmony Client E2E system tests.
 *
 * Prerequisites:
 *   1. The Harmony server must be running in --mock mode on port 3001
 *      (cd server && npm run start -- --mock --port 3001)
 *   2. The Harmony client dev server must be running on port 5173
 *      (cd client && npm run dev)
 *
 * Run with:  npm run test:e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,          // run sequentially – tests share server state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1600, height: 900 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1600, height: 900 } },
    },
  ],

  webServer: [
    {
      command: 'cross-env NODE_TLS_REJECT_UNAUTHORIZED=0 npm run start -- --mock --port 3001',
      cwd: '../server',
      url: 'https://localhost:3001/api/health',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

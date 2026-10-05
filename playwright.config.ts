import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, retries: 0, workers: 1,
  testMatch: process.env.TEST_PRODUCTION ? '**/offline.spec.ts' : '**/*.spec.ts',
  use: { browserName: process.env.TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium', channel: process.env.TEST_BROWSER === 'webkit' ? undefined : 'chrome', baseURL: process.env.TEST_URL || (process.env.TEST_PRODUCTION ? 'http://127.0.0.1:8879/v2/' : 'http://127.0.0.1:5174/v2/'), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.TEST_URL ? undefined : process.env.TEST_PRODUCTION
    ? { command: 'node tests/fixtures/server.mjs', port: 8879, reuseExistingServer: false }
    : { command: 'npm run dev:web -- --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174/v2/', reuseExistingServer: true },
  reporter: [['list']],
});

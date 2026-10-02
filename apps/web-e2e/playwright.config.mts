import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

/*
 * e2e of apps/web (ADR-0009): the production build apps/web/out, served statically; /api/v1 is
 * answered by the fake API of the tests (src/support/fake-api.ts). Browsers are the installed
 * Chrome and Edge (`channel`) — nothing is downloaded from the Playwright CDN.
 */
const port = 4400;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  // IndexedDB, Service Worker and timers of the outbox: keep the load predictable
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Dushanbe',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/web-e2e/serve-out.mjs',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
    env: { PORT: String(port) },
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});

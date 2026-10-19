import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'https://asn.asn-clima.workers.dev',
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});


import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:3003', trace: 'on-first-retry' },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3003',
    reuseExistingServer: true,
    timeout: 120000
  }
});

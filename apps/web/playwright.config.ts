import { defineConfig } from '@playwright/test';

// E2E tests provide deterministic research fixtures and need the API feature enabled.
process.env.DEEP_RESEARCH_ENABLED ??= 'true';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: process.env.SNIFFO_E2E_ORIGIN ?? 'http://127.0.0.1:5173',
    channel: 'msedge',
    headless: true,
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});

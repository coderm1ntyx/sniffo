import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// E2E tests provide deterministic research fixtures and need the API feature enabled.
process.env.DEEP_RESEARCH_ENABLED ??= 'true';
const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../..',
);

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: process.env.SNIFFO_E2E_ORIGIN ?? 'http://127.0.0.1:5173',
    headless: true,
    reducedMotion: 'reduce',
  },
  webServer: [
    {
      command: 'npm run dev:api',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3001',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        DEEP_RESEARCH_ENABLED: 'true',
        DEEP_RESEARCH_SEARCH_PROVIDER: 'none',
        DEEP_RESEARCH_OPENAI_WEB_SEARCH_ENABLED: 'false',
        DEEP_RESEARCH_VISION_ENABLED: 'false',
        OPENAI_API_KEY: '',
      },
    },
    {
      command: 'npm run dev:web',
      cwd: repositoryRoot,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
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

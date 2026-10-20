// Controlled browser integration: real extraction, signing, matching and API streaming;
// only public transports and the billable OpenAI response are replaced with fixtures.
import { expect, test } from '@playwright/test';
import express from 'express';
import sharp from 'sharp';
import type { Server } from 'node:http';
import extractionRouter from '../../api/src/routes/extraction.js';
import { createAnalysisRouter } from '../../api/src/routes/analysis.js';
import { extractListingUrl } from '../../api/src/services/extraction.js';
import { attachPublicListing } from '../../api/src/services/research/publicSources.js';
import { runResearch } from '../../api/src/services/research/orchestrator.js';
import { compareImages } from '../../api/src/services/research/vision.js';
import { VisionBudget } from '../../api/src/services/research/budget.js';
import { analyzeEvidence } from '../../api/src/services/analysis.js';
import { AnalysisRequestSchema } from '@sniffo/shared';

let server: Server;
let origin: string;
let visionCalls = 0;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function fixtureHtml(url: string) {
  return `<html><head><title>Canal Residence Apartment</title><meta property="og:title" content="Canal Residence Apartment"><meta property="og:image" content="https://photos.example/${url.includes('candidate') ? 'candidate' : 'original'}.jpg"></head><body><h1>Canal Residence Apartment</h1><p>Apartment for rent. Unit A1204. Address: 195 Rama 9 Road, Bangkok. Location: Bangkok. 2 bedrooms. Monthly rent THB 20000.</p></body></html>`;
}
async function retrieve(url: string) {
  await wait(180);
  const data = attachPublicListing(
    await extractListingUrl(url, {
      fetchPage: async () => ({
        body: fixtureHtml(url),
        contentType: 'text/html',
        url: new URL(url),
      }),
    }),
  );
  return {
    source: data.source,
    digest: url.includes('candidate')
      ? 'candidate-content'
      : 'original-content',
  };
}
test.beforeAll(async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
  });
  app.use(express.json());
  app.post('/api/extract/url', async (req, res) => {
    const data = attachPublicListing(
      await extractListingUrl(req.body.url, {
        fetchPage: async () => ({
          body: fixtureHtml(req.body.url),
          contentType: 'text/html',
          url: new URL(req.body.url),
        }),
      }),
    );
    res.json({ success: true, data });
  });
  app.use('/api/extract', extractionRouter);
  app.post('/api/analyze', (req, res, next) => {
    if (req.headers['x-fixture-break'] !== '1') return next();
    const data = analyzeEvidence(AnalysisRequestSchema.parse(req.body));
    res.type('application/x-ndjson').end(
      JSON.stringify({
        type: 'standard',
        response: { success: true, data },
      }) + '\n',
    );
  });
  app.use(
    '/api/analyze',
    createAnalysisRouter({
      research: (sources, facts, progress) =>
        runResearch(sources, facts, progress, {
          search: {
            available: true,
            name: 'controlled-fixture',
            search: async (query) => {
              await wait(700);
              return [
                {
                  url: 'https://candidate.example/property/42',
                  title: 'Canal Residence Apartment',
                  snippet: 'Fixture discovery metadata',
                  query,
                  provider: 'controlled-fixture',
                  discoveredAt: new Date().toISOString(),
                },
              ];
            },
          },
          retrieve,
          vision: (a, b, signal, stage) =>
            compareImages(a, b, signal, stage, {
              enabled: true,
              configured: true,
              budget: new VisionBudget(),
              download: async (url) =>
                sharp({
                  create: {
                    width: 256,
                    height: 256,
                    channels: 3,
                    background: url.includes('candidate')
                      ? '#aa5533'
                      : '#3355aa',
                  },
                })
                  .jpeg()
                  .toBuffer(),
              request: async () => {
                visionCalls++;
                await wait(600);
                return new Response(
                  JSON.stringify({
                    status: 'completed',
                    output: [
                      {
                        content: [
                          {
                            type: 'output_text',
                            text: JSON.stringify({
                              comparisonStatus: 'similar_interior',
                              sharedFeatures: ['Fixture interior layout'],
                              differences: [],
                              distinctiveEvidence: [],
                              limitations: [
                                'Controlled test result; visual similarity cannot verify ownership.',
                              ],
                            }),
                          },
                        ],
                      },
                    ],
                  }),
                );
              },
            }),
        }),
    }),
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string')
    throw new Error('Fixture server failed');
  origin = `http://127.0.0.1:${addr.port}`;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});
test('interrupted research retains the standard verification report', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.continue({
      url: origin + new URL(route.request().url()).pathname,
      headers: { ...route.request().headers(), 'x-fixture-break': '1' },
    }),
  );
  await page.goto('/check?new=1');
  await page
    .getByPlaceholder('Paste a property listing URL here...')
    .fill('https://original.example/property/42');
  await page.getByRole('button', { name: 'Read listing', exact: true }).click();
  await page.getByRole('switch', { name: /Deep Research/i }).check();
  await page.getByRole('button', { name: 'Continue to analysis' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your verification review' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Other advertisements discovered' }),
  ).toBeVisible();
  await expect(page.getByText('Research unavailable')).toBeVisible();
});
test('completed research retains the standard report and never verifies the property', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.continue({ url: origin + new URL(route.request().url()).pathname }),
  );
  await page.goto('/check?new=1');
  await page
    .getByPlaceholder('Paste a property listing URL here...')
    .fill('https://original.example/property/42');
  await page.getByRole('button', { name: 'Read listing', exact: true }).click();
  await page.getByRole('switch', { name: /Deep Research/i }).check();
  await page.getByRole('button', { name: 'Continue to analysis' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your verification review' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Other advertisements discovered' }),
  ).toBeVisible();
  await expect(page.getByText('Research completed')).toBeVisible();
  expect(visionCalls).toBeLessThanOrEqual(1); // A repeat may legitimately reuse the shared image-content cache.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByText('Property verified', { exact: true }),
  ).toHaveCount(0);
});

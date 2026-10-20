import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { request as HttpRequest } from 'node:http';
import {
  VisualComparisonSchema,
  ResearchResultSchema,
  AnalysisResponseSchema,
  type EvidenceSource,
} from '@sniffo/shared';
import {
  extractListingUrl,
  extractPastedText,
  readPage,
  resolvePublicIPv4,
} from '../src/services/extraction.js';
import {
  sealEvidenceSource,
  verifyEvidenceSource,
} from '../src/services/sourceSignature.js';
import { validateAnalysisEvidence } from '../src/services/evidenceIntegrity.js';
import { analyzeEvidence } from '../src/services/analysis.js';
import {
  profile,
  matchProperty,
  buildQueries,
} from '../src/services/research/profile.js';
import {
  ResearchCache,
  canonicalKey,
  fingerprint,
} from '../src/services/research/cache.js';
import {
  attachPublicListing,
  configuredSearch,
  normalizeSearchResults,
  robotsAllowed,
  type SearchProvider,
} from '../src/services/research/publicSources.js';
import {
  classifyCandidateFetchFailure,
  runResearch,
} from '../src/services/research/orchestrator.js';
import { compareProfiles } from '../src/services/research/comparator.js';
import { VisionBudget } from '../src/services/research/budget.js';
import {
  compareImages,
  sanitizePublicImage,
} from '../src/services/research/vision.js';
import app from '../src/app.js';
import express from 'express';
import { createAnalysisRouter } from '../src/routes/analysis.js';

test('safe transport revalidates an unsafe redirect before the second HTTP request', async () => {
  let requests = 0;
  const request = ((
    _url: unknown,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    requests++;
    const outgoing = new EventEmitter() as EventEmitter & {
      end: () => void;
      setTimeout: () => void;
      destroy: () => void;
    };
    outgoing.setTimeout = () => {};
    outgoing.destroy = () => {};
    outgoing.end = () => {
      const response = new PassThrough();
      Object.assign(response, {
        statusCode: 302,
        headers: { location: 'http://127.0.0.1/private' },
      });
      callback(response);
      response.end();
      outgoing.emit('close');
    };
    return outgoing;
  }) as unknown as typeof HttpRequest;
  await assert.rejects(
    readPage(
      new URL('https://controlled.fixture/listing'),
      0,
      undefined,
      performance.now() + 1000,
      undefined,
      undefined,
      {
        request,
        resolve: async (host, ...rest) =>
          host === 'controlled.fixture'
            ? '8.8.8.8'
            : resolvePublicIPv4(host, ...rest),
      },
    ),
    /public/,
  );
  assert.equal(requests, 1);
});
test('public photos undergo actual decode, size limits, MIME validation and metadata-free resizing', async () => {
  const png = await sharp({
    create: { width: 900, height: 600, channels: 3, background: '#445566' },
  })
    .png()
    .toBuffer();
  const clean = await sanitizePublicImage(png, 'image/png');
  const metadata = await sharp(clean).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 512);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(sanitizePublicImage(png, 'image/jpeg'));
  await assert.rejects(
    sanitizePublicImage(Buffer.from('<svg><script>bad</script></svg>')),
  );
  const huge = await sharp({
    create: { width: 3000, height: 200, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  await assert.rejects(sanitizePublicImage(huge), /dimensions/);
});

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/research.json', import.meta.url), 'utf8'),
) as Array<{
  name: string;
  title: string;
  description: string;
  category: string;
}>;
function manual(
  text: string,
  title = 'Canal Residence Apartment',
  url: string | null = 'https://original.example/listing/42',
): EvidenceSource {
  const extracted = extractPastedText(
    `${title}\n${text}`,
    'listing_text',
    title,
  );
  return sealEvidenceSource({
    ...extracted.source,
    type: url ? 'listing_url' : 'listing_text',
    originalUrl: url,
    evidenceKind: url ? 'server_extracted' : 'user_assertion',
    normalizedFacts: extracted.facts,
    publicListing: {
      canonicalUrl: url,
      listingId: null,
      images: [],
      retrievedAt: '2026-10-16T00:00:00Z',
    },
  });
}
const original = () => manual(fixtures[0]!.description);
test('configured SearXNG adapter requests bounded JSON, normalizes results, caches and rejects invalid output', async () => {
  let calls = 0;
  const provider = configuredSearch(
    { provider: 'searxng', endpoint: 'https://configured-search.example' },
    async (url, _r, _t, _d, _s, resource) => {
      calls++;
      assert.equal(url.pathname, '/search');
      assert.equal(url.searchParams.get('format'), 'json');
      assert.equal(resource!.maxBytes, 200000);
      return {
        body: JSON.stringify({
          results: [
            {
              url: 'https://public.example/property?utm_source=fixture',
              title: 'Public property',
              content: 'Discovery hint only',
            },
          ],
        }),
        contentType: 'application/json',
        url,
      };
    },
  );
  const first = await provider.search(
    'adapter recorded fixture',
    new AbortController().signal,
  );
  assert.equal(first[0]!.url, 'https://public.example/property');
  assert.equal(first[0]!.snippet, 'Discovery hint only');
  await provider.search(
    'adapter recorded fixture',
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  const invalid = configuredSearch(
    { provider: 'searxng', endpoint: 'https://invalid-search.example' },
    async (url) => ({
      body: '{"results":"invented"}',
      url,
      contentType: 'application/json',
    }),
  );
  await assert.rejects(
    invalid.search('invalid fixture', new AbortController().signal),
  );
});
test('OpenAI web search accepts cited URLs only and enforces one bounded Responses call', async () => {
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  const provider = configuredSearch(
    {
      provider: 'openai',
      openaiEnabled: true,
      apiKey: 'fixture-key',
      model: 'gpt-4.1-mini',
    },
    undefined,
    async (_input, init) => {
      calls++;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: {
                type: 'search',
                sources: [
                  {
                    url: 'https://listing.example/property?utm_source=test',
                    title: 'Cited listing',
                    snippet: 'Distinctive listing details',
                  },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'A result and an invented https://fake.example URL.',
                  annotations: [
                    {
                      type: 'url_citation',
                      url_citation: {
                        url: 'https://listing.example/property?utm_source=test',
                        title: 'Cited listing',
                        start_index: 0,
                        end_index: 8,
                      },
                    },
                    {
                      type: 'url_citation',
                      url_citation: {
                        url: 'https://listing.example/property?utm_source=other',
                        title: 'Same listing',
                        start_index: 0,
                        end_index: 8,
                      },
                    },
                  ],
                },
              ],
            },
          ],
          usage: { input_tokens: 8100, output_tokens: 40, total_tokens: 8140 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  );
  assert.equal(provider.available, true);
  const signal = new AbortController().signal;
  const hits = await provider.search('distinctive title Pattaya', signal);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.url, 'https://listing.example/property');
  assert.equal(hits[0]!.title, 'Cited listing');
  assert.equal(hits[0]!.query, 'distinctive title Pattaya');
  assert.equal(provider.resultCounts?.referencesReturned, 3);
  assert.equal(provider.resultCounts?.uniqueUrlsReturned, 1);
  assert.deepEqual(requestBody?.tools, [{ type: 'web_search' }]);
  assert.deepEqual(requestBody?.include, [
    'web_search_call.action.sources',
    'web_search_call.results',
  ]);
  assert.equal(requestBody?.tool_choice, 'required');
  assert.equal(requestBody?.max_output_tokens, 300);
  assert.equal(provider.usage?.tool, 'web_search');
  assert.equal(provider.usage?.totalTokens, 8140);
  await assert.rejects(
    provider.search('another query', signal),
    /limit reached/,
  );
  assert.equal(calls, 1);

  const uncited = configuredSearch(
    {
      provider: 'openai',
      openaiEnabled: true,
      apiKey: 'fixture-key',
      model: 'gpt-4.1-mini',
    },
    undefined,
    async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { type: 'search', sources: [] },
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'An uncited answer.' }],
            },
          ],
          usage: { input_tokens: 8100, output_tokens: 12, total_tokens: 8112 },
        }),
        { status: 200 },
      ),
  );
  assert.deepEqual(await uncited.search('uncited query', signal), []);
  assert.equal(uncited.resultCounts?.uniqueUrlsReturned, 0);
});
test('OpenAI web search keeps three structured source URLs distinct without using generated prose URLs', async () => {
  const provider = configuredSearch(
    {
      provider: 'openai',
      openaiEnabled: true,
      apiKey: 'fixture-key',
      model: 'gpt-4.1-mini',
    },
    undefined,
    async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'web_search_call',
              status: 'completed',
              action: {
                type: 'search',
                sources: [
                  { url: 'https://one.example/a', title: 'One' },
                  { url: 'https://two.example/b', title: 'Two' },
                  { url: 'https://three.example/c', title: 'Three' },
                ],
              },
            },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Invented https://not-a-source.example',
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 8100, output_tokens: 40, total_tokens: 8140 },
        }),
        { status: 200 },
      ),
  );
  const hits = await provider.search(
    'three public listing sources',
    new AbortController().signal,
  );
  assert.deepEqual(
    hits.map((hit) => hit.url),
    [
      'https://one.example/a',
      'https://two.example/b',
      'https://three.example/c',
    ],
  );
  assert.equal(provider.resultCounts?.referencesReturned, 3);
  assert.equal(provider.resultCounts?.uniqueUrlsReturned, 3);
});
test('invalid Vision output degrades without accepting fabricated evidence', async () => {
  const a = profile(original()),
    b = profile(
      manual(
        'Apartment for rent',
        'Invalid output',
        'https://candidate.example/invalid-vision',
      ),
    );
  a.images = ['https://images.example/invalid-a.jpg'];
  b.images = ['https://images.example/invalid-b.jpg'];
  const result = await compareImages(
    a,
    b,
    new AbortController().signal,
    () => {},
    {
      enabled: true,
      configured: true,
      budget: new VisionBudget(),
      download: async (url) => Buffer.from(url),
      request: async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: '{"comparisonStatus":"verified", "fabricatedSource":"fake"}',
                  },
                ],
              },
            ],
          }),
        ),
    },
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.result, undefined);
});
test('Vision cache separates booking, currency and unit contexts', async () => {
  const a = profile(original()),
    b = profile(
      manual(
        'Apartment for rent',
        'Context',
        'https://candidate.example/context',
      ),
    );
  a.images = ['https://images.example/context-a.jpg'];
  b.images = ['https://images.example/context-b.jpg'];
  let calls = 0;
  const budget = new VisionBudget();
  const deps = {
    enabled: true,
    configured: true,
    budget,
    download: async (url: string) => Buffer.from(url),
    request: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    comparisonStatus: 'indeterminate',
                    sharedFeatures: [],
                    differences: [],
                    distinctiveEvidence: [],
                    limitations: ['Not enough visual information.'],
                  }),
                },
              ],
            },
          ],
        }),
      );
    },
  };
  await compareImages(a, b, new AbortController().signal, () => {}, deps);
  const changed = {
    ...a,
    unit: 'A1205',
    prices: a.prices.map((p) => ({
      ...p,
      currency: 'USD',
      checkIn: '2026-11-03',
      checkOut: '2026-11-05',
      guestCount: 4,
    })),
  };
  const result = await compareImages(
    changed,
    b,
    new AbortController().signal,
    () => {},
    deps,
  );
  assert.equal(result.cached, false);
  assert.equal(calls, 2);
});
test('a cross-domain canonical claim cannot manufacture an exact listing identity', async () => {
  const url = 'https://candidate.example/page';
  const data = attachPublicListing(
    await extractListingUrl(url, {
      fetchPage: async () => ({
        body: `<html><head><title>Rental apartment</title><link rel="canonical" href="https://original.example/listing/42"></head><body><p>Apartment for rent. 2 bedrooms in Bangkok. Monthly rent THB 20000.</p></body></html>`,
        contentType: 'text/html',
        url: new URL(url),
      }),
    }),
  );
  assert.equal(data.source.publicListing!.canonicalUrl, url);
  assert.notEqual(
    matchProperty(profile(original()), profile(data.source)).identity,
    'exact_listing',
  );
});
test('byte-identical photos skip the billable request', async () => {
  const a = profile(original()),
    b = profile(
      manual(
        'Apartment for rent',
        'Photo copy',
        'https://candidate.example/identical',
      ),
    );
  a.images = ['https://images.example/same-a.jpg'];
  b.images = ['https://images.example/same-b.jpg'];
  let calls = 0;
  const result = await compareImages(
    a,
    b,
    new AbortController().signal,
    () => {},
    {
      enabled: true,
      configured: true,
      budget: new VisionBudget(),
      download: async () => Buffer.from('same public photo'),
      request: async () => {
        calls++;
        throw new Error('must skip');
      },
    },
  );
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /byte-identical/);
  assert.equal(calls, 0);
});
test('field-only research cannot turn incidental quoted webpage prose into a payment warning', () => {
  const source = original();
  const candidate = manual(
    'Apartment for rent. Unit A1204. Address: 195 Rama 9 Road, Bangkok. 3 bedrooms. Transfer the deposit before viewing.',
    source.name,
    'https://candidate.example/field-only',
  );
  const selected = candidate.normalizedFacts!.filter((f) =>
    ['bedroomCount', 'address', 'propertyType'].includes(f.fieldName),
  );
  const fieldOnly = sealEvidenceSource({
    ...candidate,
    normalizedFacts: selected,
    publicListing: { ...candidate.publicListing!, fieldComparisonOnly: true },
  });
  const result = analyzeEvidence({ sources: [source, fieldOnly], facts: [] });
  assert.ok(
    result.findings.some((f) => f.category === 'confirmed_inconsistency'),
  );
  assert.equal(
    result.findings.some((f) =>
      /before viewing|payment pressure/i.test(f.title),
    ),
    false,
  );
});
test('missing search provider returns promptly without implying a search or re-fetching the source', async () => {
  const source = original();
  let reads = 0;
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: false,
        name: 'none',
        search: async () => {
          throw new Error('disabled');
        },
      },
      retrieve: async () => {
        reads++;
        return { source, digest: 'direct' };
      },
    },
  );
  assert.equal(reads, 0);
  assert.equal(result.status, 'search_unavailable');
  assert.match(result.summary, /No external listings were searched/);
  assert.equal(result.sourceSummaries[0]?.discoveryMethod, 'direct');
  assert.equal(result.queriesAttempted, 0);
  assert.equal(result.searchProvider, 'none');
  assert.deepEqual(result.searchQueries, []);
  assert.equal(result.independentSources, 0);
});
test('search provider rate limits are reported separately from timeouts', async () => {
  const source = original();
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: true,
        name: 'fixture',
        search: async () => {
          throw new Error('HTTP 429 rate limit');
        },
      },
      retrieve: async () => ({ source, digest: 'source' }),
    },
  );
  assert.equal(result.status, 'rate_limited');
  assert.equal(result.queriesAttempted, 1);
  assert.equal(result.searchQueries?.[0]?.status, 'failed');
  assert.equal(result.searchQueries?.[0]?.error, 'Provider rate limit');
  assert.match(result.limitations.join(' '), /rate-limited/);
});
test('a discovered mirror whose canonical URL is the supplied listing is not counted as a candidate source', async () => {
  const source = original();
  const external = manual(
    fixtures[0]!.description,
    source.name,
    'https://mirror.example/copied-listing',
  );
  const mirror = sealEvidenceSource({
    ...external,
    publicListing: {
      ...external.publicListing!,
      canonicalUrl: source.publicListing!.canonicalUrl,
    },
  });
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: true,
        name: 'fixture',
        search: async (query) => [
          {
            url: 'https://mirror.example/copied-listing',
            title: source.name,
            snippet: 'Unverified lead',
            query,
            provider: 'fixture',
            discoveredAt: new Date().toISOString(),
          },
        ],
      },
      retrieve: async () => ({ source: mirror, digest: 'mirror' }),
    },
  );
  assert.equal(result.candidatesDiscovered, 1);
  assert.equal(result.candidatesReviewed, 0);
  assert.equal(result.independentSources, 0);
  assert.equal(
    result.sourceSummaries.some((item) => item.domain === 'mirror.example'),
    false,
  );
});
test('search results retain the original URL as rejected and never re-fetch it', async () => {
  const source = original();
  let fetches = 0;
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: true,
        name: 'openai',
        resultCounts: {
          referencesReturned: 3,
          uniqueUrlsReturned: 1,
          cacheHit: false,
        },
        search: async (query) => [
          {
            url: source.originalUrl!,
            title: source.name,
            snippet: 'Original listing citation',
            query,
            provider: 'openai',
            discoveredAt: new Date().toISOString(),
          },
        ],
      },
      retrieve: async () => {
        fetches++;
        throw new Error('must not fetch original');
      },
    },
  );
  assert.equal(fetches, 0);
  assert.equal(result.candidatesDiscovered, 0);
  assert.equal(result.candidatesReviewed, 0);
  assert.equal(result.searchQueries?.[0]?.referencesReturned, 3);
  assert.equal(result.searchResults?.[0]?.classification, 'original_listing');
  assert.equal(result.searchResults?.[0]?.status, 'rejected');
  assert.equal(result.status, 'partial');
});
test('successful search with candidate fetch failure or timeout is partial and preserves source status', async () => {
  const source = original();
  const buildSearch = (): SearchProvider => ({
    available: true,
    name: 'openai',
    search: async (query) => [
      {
        url: 'https://candidate.example/slow',
        title: 'Possible property',
        snippet: 'Unverified search hint',
        query,
        provider: 'openai',
        discoveredAt: new Date().toISOString(),
      },
    ],
  });
  const failed = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: buildSearch(),
      retrieve: async () => {
        throw new Error('HTTP 403');
      },
    },
  );
  assert.equal(failed.status, 'partial');
  assert.equal(failed.candidatesDiscovered, 1);
  assert.equal(failed.candidatesReviewed, 0);
  assert.equal(failed.searchResults?.[0]?.status, 'fetch_failed');
  assert.equal(failed.comparisons.length, 0);
  assert.equal(failed.evidenceSources.length, 0);

  const timedOut = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      candidateTimeoutMs: 10,
      search: buildSearch(),
      retrieve: async (_url, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'TimeoutError')),
            { once: true },
          );
        }),
    },
  );
  assert.equal(timedOut.status, 'partial');
  assert.equal(timedOut.searchResults?.[0]?.status, 'timed_out');
  assert.match(timedOut.searchResults?.[0]?.rejectionReason ?? '', /timed out/);
});

test('candidate fetch diagnostics classify restriction, network, safe access, timeout, and content failures', () => {
  assert.equal(
    classifyCandidateFetchFailure(
      Object.assign(new Error('blocked'), { code: 'LISTING_ACCESS_BLOCKED' }),
    ).reason,
    'Website blocked or rate-limited automated access.',
  );
  assert.equal(
    classifyCandidateFetchFailure(
      Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' }),
    ).reason,
    'Network or DNS failure.',
  );
  assert.equal(
    classifyCandidateFetchFailure(
      new Error('This page disallows automated research.'),
    ).reason,
    'Safe-access restriction prevented retrieval.',
  );
  assert.equal(
    classifyCandidateFetchFailure(new DOMException('Timed out', 'TimeoutError'))
      .reason,
    'Request timed out while fetching the candidate page.',
  );
  assert.equal(
    classifyCandidateFetchFailure(
      Object.assign(new Error('unsupported'), {
        code: 'UNSUPPORTED_CONTENT_TYPE',
      }),
    ).reason,
    'Unsupported content type.',
  );
  assert.equal(
    classifyCandidateFetchFailure(new Error('aborted'), true).reason,
    'Candidate-processing deadline reached.',
  );
});
test('HTTP deep OFF never invokes research; research timeout retains the same standard score', async () => {
  const local = express();
  local.use(express.json());
  let runs = 0;
  local.use(
    '/api/analyze',
    createAnalysisRouter({
      research: (sources, facts, progress) => {
        runs++;
        return runResearch(sources, facts, progress, {
          timeoutMs: 10,
          search: {
            available: true,
            name: 'fixture',
            search: async () => {
              await new Promise((resolve) => setTimeout(resolve, 30));
              return [];
            },
          },
          retrieve: async () => {
            await new Promise((r) => setTimeout(r, 30));
            throw new Error('unavailable');
          },
        });
      },
    }),
  );
  const server = local.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const source = original();
  const post = async (deepResearch?: boolean) =>
    AnalysisResponseSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${addr.port}/api/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sources: [source], deepResearch }),
        })
      ).json(),
    ).data;
  try {
    const standard = await post();
    assert.equal(runs, 0);
    assert.equal(standard.research, undefined);
    const deep = await post(true);
    assert.equal(runs, 1);
    assert.equal(deep.research!.status, 'timed_out');
    assert.deepEqual(deep.redFlagScore, standard.redFlagScore);
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
for (const fixture of fixtures)
  test(`research profile and query fixture: ${fixture.name}`, () => {
    const p = profile(
      manual(
        fixture.description,
        fixture.title,
        fixture.name.startsWith('Manual') ? null : undefined,
      ),
    );
    assert.equal(p.category, fixture.category);
    assert.ok(buildQueries(p).length <= 3);
    assert.ok(buildQueries(p).every((q) => q !== 'Bangkok apartment'));
    if (fixture.name === 'Thai property')
      assert.ok(buildQueries(p).some((q) => q.includes('คอนโด')));
  });
test('same building, hotel and room identifiers cannot become same-property matches', () => {
  const a = profile(original());
  assert.equal(
    matchProperty(
      a,
      profile(
        manual(
          fixtures[8]!.description,
          fixtures[8]!.title,
          'https://candidate.example/a',
        ),
      ),
    ).identity,
    'same_building_or_development',
  );
  const hotel = profile(manual(fixtures[1]!.description, fixtures[1]!.title));
  assert.notEqual(
    matchProperty(
      hotel,
      profile(
        manual(
          fixtures[1]!.description.replace('704', '705'),
          fixtures[1]!.title,
          'https://candidate.example/hotel',
        ),
      ),
    ).identity,
    'likely_same_property',
  );
  const wrongLocation = profile(
    manual(
      fixtures[11]!.description,
      fixtures[11]!.title,
      'https://candidate.example/wrong',
    ),
  );
  assert.notEqual(
    matchProperty(a, wrongLocation).identity,
    'likely_same_property',
  );
  assert.notEqual(
    matchProperty(
      a,
      profile(
        manual(
          fixtures[0]!.description.replace('for rent', 'for sale'),
          fixtures[0]!.title,
          'https://candidate.example/sale',
        ),
      ),
    ).identity,
    'likely_same_property',
  );
});
test('explicitly different units in the same building are labeled conservatively', async () => {
  const source = manual(fixtures[0]!.description, fixtures[0]!.title);
  const candidate = manual(
    fixtures[8]!.description,
    fixtures[8]!.title,
    'https://candidate.example/different-unit',
  );
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: true,
        name: 'fixture',
        search: async (query) => [
          {
            url: candidate.originalUrl!,
            title: candidate.name,
            snippet: 'Unit A1205 in the same building',
            query,
            provider: 'fixture',
            discoveredAt: new Date().toISOString(),
          },
        ],
      },
      retrieve: async () => ({ source: candidate, digest: 'different-unit' }),
    },
  );
  assert.equal(
    result.searchResults?.[0]?.classification,
    'same_building_different_unit',
  );
  assert.equal(
    result.comparisons.some((comparison) =>
      ['confirmed_inconsistency', 'potential_inconsistency'].includes(
        comparison.status,
      ),
    ),
    false,
  );
  assert.equal(result.evidenceSources.length, 0);
});
test('search normalization deduplicates trackers, preserves booking context and rejects unsafe schemes', async () => {
  assert.equal(configuredSearch().available, false);
  assert.deepEqual(
    await configuredSearch().search('ignored', new AbortController().signal),
    [],
  );
  const hits = normalizeSearchResults(
    [
      { url: 'https://example.com/a?utm_source=x', title: 'A' },
      { url: 'https://example.com/a', title: 'B' },
      { url: 'javascript:alert(1)', title: 'Bad' },
    ],
    'public title',
    'fixture',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.provider, 'fixture');
  assert.notEqual(
    canonicalKey('https://example.com/a?check_in=2026-10-16'),
    canonicalKey('https://example.com/a?check_in=2026-10-17'),
  );
});
test('robots restrictions and longest allow paths are enforced', () => {
  assert.equal(
    robotsAllowed(
      'User-agent: *\nDisallow: /private\nAllow: /private/public',
      '/private/x',
    ),
    false,
  );
  assert.equal(
    robotsAllowed(
      'User-agent: *\nDisallow: /private\nAllow: /private/public',
      '/private/public/a',
    ),
    true,
  );
  assert.equal(
    robotsAllowed(
      'User-agent: SniffoRentalCheck\nDisallow: /\nUser-agent: *\nAllow: /',
      '/a',
    ),
    false,
  );
});
test('research transport rejects SSRF targets before a connection', async () => {
  for (const url of [
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/',
    'file:///secret',
    'http://10.0.0.1/',
    'http://[::1]/',
  ])
    await assert.rejects(readPage(new URL(url)), /public|supported/);
});
test('source public metadata cannot be modified without invalidating its signature', () => {
  const source = original();
  assert.equal(verifyEvidenceSource(source), true);
  assert.equal(
    verifyEvidenceSource({
      ...source,
      publicListing: {
        ...source.publicListing!,
        images: ['http://localhost/private.png'],
      },
    }),
    false,
  );
  assert.throws(() =>
    validateAnalysisEvidence({
      sources: [
        {
          ...source,
          publicListing: { ...source.publicListing!, listingId: 'forged' },
        },
      ],
      facts: [],
    }),
  );
});
test('cache expiry, independent values and context fingerprints', async () => {
  const c = new ResearchCache<{ value: string }>(5, 2);
  c.set('x', { value: 'public' });
  const v = c.get('x')!;
  v.value = 'edited';
  assert.equal(c.get('x')!.value, 'public');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.get('x'), undefined);
  assert.notEqual(
    fingerprint({ currency: 'THB', guests: 2 }),
    fingerprint({ currency: 'USD', guests: 2 }),
  );
  assert.notEqual(
    fingerprint({ dates: '2026-10-16', basis: 'nightly' }),
    fingerprint({ dates: '2026-10-16', basis: 'stay_total' }),
  );
});
test('prices with nightly/stay-total, discounts or missing fee contexts are not contradictions', () => {
  const a = profile(
    manual('Apartment for rent in Bangkok. THB 1500 per night.'),
  );
  const b = profile(
    manual(
      'Apartment for rent in Bangkok. THB 7500 total for 5 nights.',
      'Offer',
      'https://candidate.example/b',
    ),
  );
  assert.ok(
    compareProfiles(a, b, 'likely_same_property')
      .filter((c) => c.field === 'price')
      .every((c) => c.status === 'not_comparable'),
  );
});
test('no-key manual research is honest and does not call Vision or change the score', async () => {
  const source = manual(fixtures[7]!.description, fixtures[7]!.title, null);
  const before = JSON.stringify(source);
  const report = analyzeEvidence({ sources: [source], facts: [] });
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      vision: async () => {
        throw new Error('Vision must not run');
      },
    },
  );
  ResearchResultSchema.parse(result);
  assert.equal(result.queriesAttempted, 0);
  assert.equal(result.visualAnalysis.status, 'skipped');
  assert.equal(result.evidenceSources.length, 0);
  assert.equal(result.status, 'search_unavailable');
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(
    analyzeEvidence({ sources: [source], facts: [] }).redFlagScore,
    report.redFlagScore,
  );
});
test('fixture discovery uses real HTML extraction and preserves exact source citations', async () => {
  const source = original();
  const search: SearchProvider = {
    available: true,
    name: 'controlled-fixture',
    search: async (query) => [
      {
        url: 'https://candidate.example/property',
        title: source.name,
        snippet: 'Unverified hint',
        query,
        provider: 'controlled-fixture',
        discoveredAt: new Date().toISOString(),
      },
    ],
  };
  const retrieve = async (url: string) => {
    const text = url.includes('candidate')
      ? fixtures[0]!.description.replace('2 bedrooms', '3 bedrooms')
      : fixtures[0]!.description;
    const html = `<html><head><title>${source.name}</title><meta property="og:title" content="${source.name}"></head><body><h1>${source.name}</h1><p>${text}</p></body></html>`;
    const parsed = attachPublicListing(
      await extractListingUrl(url, {
        fetchPage: async () => ({
          body: html,
          contentType: 'text/html',
          url: new URL(url),
        }),
      }),
    );
    return { source: parsed.source, digest: fingerprint(html) };
  };
  const stages: string[] = [];
  const research = await runResearch(
    [source],
    source.normalizedFacts!,
    (stage) => stages.push(stage),
    { search, retrieve },
  );
  ResearchResultSchema.parse(research);
  assert.equal(research.candidatesDiscovered, 1);
  assert.equal(research.candidatesReviewed, 1);
  assert.equal(research.searchResults?.[0]?.status, 'reviewed');
  assert.equal(
    research.searchResults?.[0]?.classification,
    'possible_same_unit',
  );
  assert.ok(research.queriesAttempted > 0);
  assert.equal(research.searchProvider, 'controlled-fixture');
  assert.ok(
    research.searchQueries?.some((query) => query.status === 'attempted'),
  );
  assert.ok(
    research.comparisons.some(
      (c) =>
        c.field === 'bedroomCount' &&
        c.status === 'confirmed_inconsistency' &&
        /3 bedrooms/.test(c.candidateQuote),
    ),
  );
  assert.equal(research.evidenceSources.length, 1);
  validateAnalysisEvidence({
    sources: [source, ...research.evidenceSources],
    facts: [],
  });
  assert.ok(
    analyzeEvidence({
      sources: [source, ...research.evidenceSources],
      facts: [],
    }).findings.some((f) => f.category === 'confirmed_inconsistency'),
  );
  assert.ok(stages.includes('searching'));
  assert.equal(stages.includes('photos'), false);
});
test('inaccessible snippets cannot drive comparisons, scores or Vision', async () => {
  const source = original();
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      search: {
        available: true,
        name: 'fixture',
        search: async (query) => [
          {
            url: 'https://candidate.example/unreadable',
            title: source.name,
            snippet: '999 bedrooms in Phuket',
            query,
            provider: 'fixture',
            discoveredAt: '',
          },
        ],
      },
      retrieve: async () => {
        throw new Error('HTTP 403');
      },
      vision: async () => {
        throw new Error('must not run');
      },
    },
  );
  assert.equal(result.evidenceSources.length, 0);
  assert.equal(result.comparisons.length, 0);
  assert.equal(result.visualAnalysis.status, 'skipped');
});
test('research deadline returns a standard-compatible partial report', async () => {
  const source = original();
  const result = await runResearch(
    [source],
    source.normalizedFacts!,
    undefined,
    {
      timeoutMs: 15,
      search: {
        available: true,
        name: 'fixture',
        search: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [];
        },
      },
      retrieve: async () => {
        await new Promise((r) => setTimeout(r, 50));
        throw new Error('slow');
      },
    },
  );
  assert.equal(result.status, 'timed_out');
  assert.match(
    result.summary,
    /Results collected before the timeout are shown/,
  );
  assert.ok(result.elapsedMs < 200);
  AnalysisResponseSchema.parse({
    success: true,
    data: {
      ...analyzeEvidence({ sources: [source], facts: [] }),
      research: result,
    },
  });
  await new Promise((r) => setTimeout(r, 60));
});
test('Vision schema rejects fabricated source references and invalid statuses', () => {
  assert.equal(
    VisualComparisonSchema.safeParse({
      comparisonStatus: 'verified',
      sourceId: 'invented',
    }).success,
    false,
  );
});
test('atomic Vision reservations enforce concurrency and local cap even on failures', () => {
  const b = new VisionBudget();
  assert.equal(b.reserve(0.1, 0.05), true);
  assert.equal(b.reserve(0.1, 0.05), false);
  b.finish({ input_tokens: 10 });
  assert.equal(b.reserve(0.1, 0.05), true);
  b.finish();
  assert.equal(b.reserve(0.1, 0.05), false);
  assert.equal(b.inputTokens, 10);
});
test('actual Vision request construction bounds images, caches and never creates score findings', async () => {
  const a = profile(original()),
    b = profile(
      manual(
        fixtures[10]!.description,
        'Candidate',
        'https://candidate.example/vision',
      ),
    );
  a.images = [1, 2, 3].map((i) => `https://images.example/original${i}.jpg`);
  b.images = [1, 2, 3].map((i) => `https://images.example/candidate${i}.jpg`);
  const budget = new VisionBudget();
  let calls = 0;
  const result = {
    comparisonStatus: 'same_space',
    sharedFeatures: ['Window layout'],
    differences: [],
    distinctiveEvidence: [],
    limitations: ['Photos do not establish location or ownership.'],
  };
  const request = async (body: unknown) => {
    calls++;
    const serialized = JSON.stringify(body);
    assert.equal((serialized.match(/input_image/g) ?? []).length, 4);
    assert.match(serialized, /"detail":"low"/);
    const tokenLimit = Number(
      serialized.match(/"max_output_tokens":(\d+)/)?.[1],
    );
    assert.ok(tokenLimit > 0 && tokenLimit <= 500);
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          { content: [{ type: 'output_text', text: JSON.stringify(result) }] },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );
  };
  const deps = {
    enabled: true,
    configured: true,
    budget,
    request,
    download: async (url: string) => Buffer.from(url),
  };
  const [first, simultaneous] = await Promise.all([
    compareImages(a, b, new AbortController().signal, () => {}, deps),
    compareImages(a, b, new AbortController().signal, () => {}, deps),
  ]);
  assert.equal(first.status, 'completed');
  assert.equal(simultaneous.status, 'completed');
  assert.equal(calls, 1);
  const again = await compareImages(
    a,
    b,
    new AbortController().signal,
    () => {},
    deps,
  );
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
  assert.equal(budget.inputTokens, 100);
  assert.equal('finding' in again, false);
});
test('OpenAI quota failure stops subsequent paid work and preserves nonvisual availability', async () => {
  const a = profile(original()),
    b = profile(
      manual('Apartment for rent', 'Quota', 'https://candidate.example/quota'),
    );
  a.images = ['https://images.example/quotaA.jpg'];
  b.images = ['https://images.example/quotaB.jpg'];
  let calls = 0;
  const budget = new VisionBudget();
  const deps = {
    enabled: true,
    configured: true,
    budget,
    request: async () => {
      calls++;
      return new Response('{}', { status: 429 });
    },
    download: async (url: string) => Buffer.from(url),
  };
  assert.equal(
    (await compareImages(a, b, new AbortController().signal, () => {}, deps))
      .status,
    'unavailable',
  );
  await compareImages(a, b, new AbortController().signal, () => {}, deps);
  assert.equal(calls, 1);
});
test('HTTP standard and streamed no-key research preserve the original signed record', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const source = manual(fixtures[7]!.description, fixtures[7]!.title, null);
  const before = JSON.stringify(source);
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/analyze`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ sources: [source], deepResearch: true }),
      },
    );
    assert.equal(response.status, 200);
    const records = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(records.some((r) => r.type === 'standard'));
    const final = AnalysisResponseSchema.parse(
      records.find((r) => r.type === 'result').response,
    );
    assert.equal(final.data.research!.queriesAttempted, 0);
    assert.equal(JSON.stringify(source), before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchFindings } from '../src/components/report/ResearchFindings';
import { ResearchResultSchema } from '@sniffo/shared';

test('research findings are absent unless requested; real structured data has safe source links and accurate visual status', () => {
  assert.equal(renderToStaticMarkup(createElement(ResearchFindings, {})), '');
  const research = ResearchResultSchema.parse({
    enabled: true,
    status: 'search_unavailable',
    searchProvider: 'none',
    summary:
      'Broader public search is not configured. No external listings were searched.',
    queriesAttempted: 0,
    candidatesDiscovered: 0,
    candidatesReviewed: 0,
    independentSources: 0,
    sourceSummaries: [
      {
        id: 'source',
        url: 'https://public.example/listing',
        domain: 'public.example',
        title: '<unsafe> listing',
        discoveryMethod: 'direct',
        provider: 'direct',
        retrievedAt: '2026-10-16T00:00:00Z',
        availability: 'inaccessible',
        extractionMethod: 'public_html',
        contentDigest: null,
        identity: 'insufficient_evidence',
        identityReasons: [],
        independence: 'original',
        excerpt:
          '{"serverDeterminedCurrency":"THB"} https://a0.muscache.com/image.jpg',
      },
    ],
    comparisons: [],
    visualAnalysis: {
      status: 'skipped',
      reason: 'Photo comparison disabled.',
      cached: false,
      sourceImageReferences: [],
      candidateImageReferences: [],
    },
    evidenceSources: [],
    limitations: ['Search not configured.'],
    elapsedMs: 10,
    stages: ['checking'],
  });
  const html = renderToStaticMarkup(
    createElement(ResearchFindings, { research }),
  );
  assert.match(html, /Research unavailable/);
  assert.doesNotMatch(html, /Provider:|Elapsed:|Technical details/);
  assert.doesNotMatch(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /unsafe/);
  assert.doesNotMatch(html, /serverDeterminedCurrency|muscache\.com/);
  assert.doesNotMatch(html, /0 search queries/);
  assert.doesNotMatch(html, /Property verified|scam probability|<unsafe>/);
});

test('OpenAI advertisements are limited, linked, deduplicated by property ID, and diagnostics stay private', () => {
  const research = ResearchResultSchema.parse({
    enabled: true,
    status: 'partial',
    searchProvider: 'openai',
    summary: 'Search returned public references.',
    queriesAttempted: 1,
    candidatesDiscovered: 3,
    candidatesReviewed: 0,
    independentSources: 0,
    searchQueries: [
      {
        query: 'distinctive title Pattaya',
        provider: 'openai',
        status: 'attempted',
        candidatesReturned: 3,
        referencesReturned: 34,
      },
    ],
    searchUsage: {
      model: 'gpt-6-luna',
      tool: 'web_search',
      latencyMs: 6831,
      totalTokens: 12978,
    },
    searchResults: [
      {
        url: 'https://www.booking.com/hotel/th/edge.html',
        domain: 'booking.com',
        title: 'Edge Central Pattaya listing',
        snippet: 'Snippet citeturn0search1 [wordlim 20]',
        query: 'distinctive title Pattaya',
        status: 'fetch_failed',
        rejectionReason: 'Website blocked or rate-limited automated access.',
        classification: 'unverifiable',
      },
      {
        url: 'https://www.vrbo.com/en-sg/p5322423vb',
        domain: 'vrbo.com',
        title: 'Edge Central Pattaya on Vrbo',
        snippet: '',
        query: 'distinctive title Pattaya',
        status: 'not_reviewed',
        classification: 'unverifiable',
      },
      {
        url: 'https://www.vrbo.com/en-gb/p5322423vb',
        domain: 'vrbo.com',
        title: 'Regional duplicate of Edge Central Pattaya on Vrbo',
        snippet: '',
        query: 'distinctive title Pattaya',
        status: 'not_reviewed',
        classification: 'unverifiable',
      },
      {
        url: 'https://www.rentbyowner.com/edge',
        domain: 'rentbyowner.com',
        title: 'Edge Central Pattaya rental',
        snippet: '',
        query: 'distinctive title Pattaya',
        status: 'timed_out',
        classification: 'unverifiable',
      },
      {
        url: 'https://www.example.com/fourth',
        domain: 'example.com',
        title: 'Fourth result',
        snippet: '',
        query: 'distinctive title Pattaya',
        status: 'queued',
      },
      {
        url: 'https://www.airbnb.com.ro/rooms/12345',
        domain: 'airbnb.com.ro',
        title: 'Duplicate Airbnb listing',
        snippet: '',
        query: 'distinctive title Pattaya',
        status: 'fetch_failed',
        classification: 'unverifiable',
      },
    ],
    sourceSummaries: [
      {
        id: 'original',
        url: 'https://www.airbnb.com/rooms/12345',
        domain: 'airbnb.com',
        title: 'Original property',
        discoveryMethod: 'direct',
        provider: 'direct',
        retrievedAt: '2026-10-16T00:00:00Z',
        availability: 'inaccessible',
        extractionMethod: 'public_html',
        contentDigest: null,
        identity: 'insufficient_evidence',
        identityReasons: [],
        independence: 'original',
        excerpt: '',
      },
    ],
    comparisons: [],
    visualAnalysis: {
      status: 'skipped',
      reason: 'Disabled.',
      cached: false,
      sourceImageReferences: [],
      candidateImageReferences: [],
    },
    evidenceSources: [],
    limitations: [],
    elapsedMs: 7000,
    stages: ['searching'],
  });
  const html = renderToStaticMarkup(
    createElement(ResearchFindings, { research }),
  );
  assert.match(html, /Other advertisements discovered/);
  assert.equal(
    (html.match(/Search result · not independently verified/g) ?? []).length,
    3,
  );
  assert.equal((html.match(/Open source listing/g) ?? []).length, 3);
  assert.match(html, /Booking\.com/);
  assert.match(html, /Vrbo/);
  assert.doesNotMatch(html, /fourth|Duplicate Airbnb|airbnb\.com\.ro/);
  assert.doesNotMatch(html, /Regional duplicate/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(
    html,
    /cite|wordlim|Technical details|distinctive title Pattaya|tokens|Elapsed:/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ReportSections } from '../src/components/report/ReportSections';
import { mapReport } from '../src/components/report/reportPresentation';
import { scorePresentation } from '../src/components/report/reviewInsights';
import {
  sampleReport,
  sampleRequest,
} from '../src/components/report/sampleReport';

test('unscored Airbnb results render cleanly in the requested section order', () => {
  const request = {
    ...sampleRequest,
    sources: [
      {
        ...sampleRequest.sources[0]!,
        type: 'listing_url' as const,
        originalUrl: 'https://www.airbnb.com/rooms/12345',
        extractedText: 'An ordinary apartment listing on Airbnb.',
      },
    ],
    facts: [],
  };
  const raw = {
    ...sampleReport,
    redFlagScore: {
      modelVersion: 'phase2-v1' as const,
      interpretation: 'concern_index' as const,
      status: 'insufficient_evidence' as const,
      valueOutOf10: null,
      explanation:
        'There is not enough independent, relevant source content to score.',
      breakdown: [],
    },
    findings: sampleReport.findings.filter(
      (finding) => finding.category === 'unable_to_verify',
    ),
    recommendations: [],
    research: {
      enabled: true as const,
      status: 'partial' as const,
      searchProvider: 'openai',
      summary: 'Partial research results.',
      queriesAttempted: 1,
      candidatesDiscovered: 0,
      candidatesReviewed: 0,
      independentSources: 0,
      sourceSummaries: [],
      comparisons: [],
      visualAnalysis: {
        status: 'skipped' as const,
        reason: 'Not run.',
        cached: false,
        sourceImageReferences: [],
        candidateImageReferences: [],
      },
      evidenceSources: [],
      limitations: [],
      elapsedMs: 0,
      stages: [],
    },
  };
  const model = mapReport(raw, request);
  assert.ok(model);
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ReportSections, { model, isDemo: false }),
    ),
  );
  const headings = [
    'Main verification result',
    'What Sniffo found',
    'U-Bot Rental Assistant',
    'Other advertisements discovered',
    'Before you pay',
    'Check another listing when you',
  ].map((label) => html.indexOf(label));
  assert.ok(
    headings.every((position) => position >= 0),
    JSON.stringify(headings),
  );
  assert.deepEqual(
    headings,
    [...headings].sort((a, b) => a - b),
  );
  assert.match(html, /—<\/strong><span>\/10<\/span>/);
  assert.match(html, /Insufficient evidence/);
  assert.match(
    html,
    /We couldn&#x27;t assess this rental reliably from the information provided\./,
  );
  assert.match(html, /Evidence reviewed \(1\)/);
  assert.match(html, /Demo mode — live U-Bot integration planned\./);
  assert.doesNotMatch(
    html,
    /Review summary|Technical details|turn0search|tokens|Elapsed:/,
  );
  assert.match(html, /class="ubot-assistant report-panel"/);

  const scored = mapReport(
    {
      ...raw,
      redFlagScore: {
        modelVersion: 'phase2-v1' as const,
        interpretation: 'concern_index' as const,
        status: 'scored' as const,
        valueOutOf10: 4,
        explanation: 'Evidence-backed payment concerns were found.',
        breakdown: [
          {
            ruleId: 'R01',
            findingId: 'payment-warning',
            base: 4,
            contribution: 4,
            issueGroup: 'payment',
          },
        ],
      },
    },
    request,
  );
  assert.ok(scored);
  assert.equal(scored.report.research?.status, 'partial');
  assert.equal(scorePresentation(scored).status, 'scored');
  assert.equal(scorePresentation(scored).value, 4);
});

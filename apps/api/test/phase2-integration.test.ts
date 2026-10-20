import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  AnalysisResponseSchema,
  ExtractionResponseSchema,
  type ExtractedFact,
} from '@sniffo/shared';
import app from '../src/app.js';
import { analyzeEvidence } from '../src/services/analysis.js';
import { extractListingUrl } from '../src/services/extraction.js';
import { extractPastedText } from '../src/services/extraction.js';
import { buildAnalysisEvidence } from '../../web/src/components/check/reviewEvidence.js';
import { mapReport } from '../../web/src/components/report/reportPresentation.js';
import { scorePresentation } from '../../web/src/components/report/reviewInsights.js';

test('HTTP Step 2 → Step 3: real fixture extraction, edits, warnings, response and presentation', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  async function post(path: string, body: unknown) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, body: (await response.json()) as unknown };
  }
  try {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/airbnb-listing.html', import.meta.url)),
      'utf8',
    );
    const listing = await extractListingUrl(
      'https://www.airbnb.com/rooms/123456?check_in=2026-10-17&check_out=2026-10-22',
      {
        fetchPage: async () => ({
          body: fixture,
          url: new URL(
            'https://www.airbnb.com/rooms/123456?check_in=2026-10-17&check_out=2026-10-22',
          ),
          contentType: 'text/html',
        }),
      },
    );
    const before = JSON.stringify(listing.source);
    const evidence = await buildAnalysisEvidence({
      source: listing.source,
      facts: listing.facts,
      values: { monthlyRent: '50000' },
      originalValues: { monthlyRent: '28000' },
      description: listing.description ?? '',
      originalDescription: listing.description ?? '',
      messages:
        "Don't pay through Airbnb. Send ฿5,000 in crypto within one hour.",
      fieldLabels: { monthlyRent: 'Monthly rent' },
      priceLabel: 'Monthly Rent',
      priceAmount: '50000',
      originalPriceAmount: '28000',
      priceBasis: 'monthly_rent',
      originalPriceBasis: 'monthly_rent',
      currency: 'THB',
      currencyProvenance: 'user_provided',
      originalCurrencyProvenance: 'extracted',
      priceBasisProvenance: 'user_provided',
      originalPriceBasisProvenance: 'extracted',
      extractText: async (text, type, name, _signal, evidenceKind) => {
        const extracted = await post('/api/extract/text', {
          text,
          type,
          name,
          evidenceKind,
        });
        assert.equal(extracted.response.status, 200);
        return ExtractionResponseSchema.parse(extracted.body).data;
      },
    });
    assert.equal(evidence.sources[1]!.evidenceKind, 'user_assertion');
    assert.equal(JSON.stringify(listing.source), before);
    const analyzed = await post('/api/analyze', evidence);
    assert.equal(analyzed.response.status, 200);
    assert.ok(analyzed.response.headers.get('x-request-id'));
    const report = AnalysisResponseSchema.parse(analyzed.body).data;
    assert.equal(report.redFlagScore!.valueOutOf10, 4.9);
    assert.equal(
      report.findings.some((f) => f.ruleId === 'R06'),
      false,
    );
    const model = mapReport(report, evidence)!;
    assert.ok(model);
    assert.equal(scorePresentation(model).status, 'scored');
    assert.ok(
      model.findings
        .find((f) => f.ruleId === 'R01')!
        .evidence.some((e) => e.quote!.includes("Don't pay through Airbnb")),
    );
    const normal = extractPastedText(
      'Please review the booking terms and keep all payments securely on Airbnb.',
      'conversation_text',
      'Normal message',
    );
    const cleanInput = {
      sources: [listing.source, normal.source],
      facts: [...listing.facts, ...normal.facts],
    };
    const clean = await post('/api/analyze', cleanInput);
    assert.equal(clean.response.status, 200);
    const cleanReport = AnalysisResponseSchema.parse(clean.body).data;
    assert.equal(cleanReport.redFlagScore!.valueOutOf10, 0);
    const single = await post('/api/analyze', {
      sources: [listing.source],
      facts: listing.facts,
    });
    const singleReport = AnalysisResponseSchema.parse(single.body).data;
    assert.equal(
      scorePresentation(
        mapReport(singleReport, {
          sources: [listing.source],
          facts: listing.facts,
        })!,
      ).status,
      'insufficient_evidence',
    );
    const malformed = await post('/api/analyze', { sources: [], facts: [] });
    assert.equal(malformed.response.status, 400);
    const tampered = await post('/api/analyze', {
      sources: [{ ...listing.source, name: 'Modified' }],
      facts: [],
    });
    assert.equal(tampered.response.status, 400);
    const forged: ExtractedFact = {
      id: 'forged',
      sourceId: listing.source.id,
      fieldName: 'monthlyRent',
      normalizedValue: 90000,
      quotedEvidence: 'Rent is THB 90000/month',
    };
    const partial = await post('/api/analyze', {
      sources: [listing.source, normal.source],
      facts: [forged],
    });
    assert.equal(partial.response.status, 200);
    const partialReport = AnalysisResponseSchema.parse(partial.body).data;
    assert.equal(
      partialReport.evidenceDiagnostics![0]!.code,
      'QUOTE_NOT_IN_SOURCE',
    );
    assert.equal(partialReport.redFlagScore!.valueOutOf10, 0);
    const tooLarge = await post('/api/analyze', {
      sources: [listing.source],
      padding: 'x'.repeat(1_100_000),
    });
    assert.equal(tooLarge.response.status, 413);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('manual assertions can analyze with a source-backed message without creating source contradictions', () => {
  const manual = extractPastedText(
    'Monthly rent: ฿50,000/month',
    'listing_text',
    'Manual',
    'user_assertion',
  );
  const original = JSON.stringify(manual);
  const message = extractPastedText(
    'Monthly rent: ฿28,000/month. We can arrange a viewing.',
    'conversation_text',
    'Message',
  );
  const result = analyzeEvidence({
    sources: [manual.source, message.source],
    facts: [...manual.facts, ...message.facts],
  });
  assert.equal(
    result.findings.some((f) => f.ruleId === 'R06'),
    false,
  );
  assert.equal(result.redFlagScore!.valueOutOf10, null);
  assert.equal(manual.source.evidenceKind, 'user_assertion');
  assert.equal(JSON.stringify(manual), original);
});
// The HTTP path validates the same shared schemas used by the browser; no live provider or scraper is required.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapReport,
  safeSourceUrl,
} from '../src/components/report/reportPresentation';
import {
  sampleReport,
  sampleRequest,
} from '../src/components/report/sampleReport';

test('resolves fact references to original quotations and source provenance', () => {
  const model = mapReport(sampleReport, sampleRequest)!;
  assert.deepEqual(model.counts, {
    confirmed_inconsistency: 1,
    potential_warning_sign: 1,
    unable_to_verify: 1,
  });
  assert.equal(
    model.findings[0].evidence[0].quote,
    sampleRequest.facts[0].quotedEvidence,
  );
  assert.equal(model.findings[0].evidence[0].source?.id, 'example-listing');
  assert.equal(
    model.findings[1].evidence[0].quote,
    sampleRequest.sources[1].extractedText,
  );
  assert.equal(model.recommendations.length, 3);
});
test('retains the backend category when evidence references are missing', () => {
  const model = mapReport(sampleReport, {
    ...sampleRequest,
    sources: [{ ...sampleRequest.sources[0], id: 'other-source' }],
    facts: [],
  })!;
  assert.equal(model.findings[0].category, 'confirmed_inconsistency');
  assert.equal(model.findings[0].evidence[0].quote, null);
  assert.equal(model.findings[0].evidence[0].source, undefined);
});
test('handles source-free reports honestly and rejects malformed results', () => {
  assert.equal(mapReport(sampleReport, null)?.contextAvailable, false);
  assert.equal(
    mapReport(sampleReport, null)?.findings[0].evidence[0].quote,
    null,
  );
  assert.equal(mapReport({ summary: 'Invalid' }, sampleRequest), null);
});
test('supports empty findings without adding frontend warnings or recommendations', () => {
  const model = mapReport(
    { ...sampleReport, findings: [], recommendations: [] },
    sampleRequest,
  )!;
  assert.equal(model.findings.length, 0);
  assert.deepEqual(model.counts, {
    confirmed_inconsistency: 0,
    potential_warning_sign: 0,
    unable_to_verify: 0,
  });
  assert.deepEqual(model.recommendations, []);
});
test('marks unavailable source extraction as partial without inventing analysis status', () => {
  const model = mapReport(sampleReport, {
    ...sampleRequest,
    sources: [{ ...sampleRequest.sources[0], extractionStatus: 'failed' }],
  })!;
  assert.equal(model.partial, true);
  assert.equal(model.unavailable.length, 1);
});
test('allows only web source links', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'), undefined);
  assert.equal(safeSourceUrl('data:text/html,example'), undefined);
  assert.equal(safeSourceUrl(null), undefined);
  assert.equal(
    safeSourceUrl('https://example.com/listing'),
    'https://example.com/listing',
  );
});

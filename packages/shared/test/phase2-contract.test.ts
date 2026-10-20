import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalysisRequestSchema,
  RedFlagScoreSchema,
  FindingSchema,
  TextExtractionRequestSchema,
} from '../src/index.js';
const base = {
  modelVersion: 'phase2-v1',
  interpretation: 'concern_index',
  status: 'scored',
  valueOutOf10: 4,
  explanation: 'Evidence-backed warning',
  breakdown: [
    {
      ruleId: 'R01',
      findingId: 'f1',
      base: 4,
      contribution: 4,
      issueGroup: 'payment',
    },
  ],
};
test('score contract accepts a valid breakdown', () =>
  assert.ok(RedFlagScoreSchema.safeParse(base).success));
test('score contract rejects unavailable non-null score', () =>
  assert.equal(
    RedFlagScoreSchema.safeParse({ ...base, status: 'insufficient_evidence' })
      .success,
    false,
  ));
test('score contract rejects mismatched breakdown', () =>
  assert.equal(
    RedFlagScoreSchema.safeParse({ ...base, valueOutOf10: 7 }).success,
    false,
  ));
test('score contract disallows informational risk contribution', () =>
  assert.equal(
    RedFlagScoreSchema.safeParse({
      ...base,
      breakdown: [{ ...base.breakdown[0], ruleId: 'R12' }],
    }).success,
    false,
  ));
test('findings retain legacy fields and accept stable rule references', () =>
  assert.ok(
    FindingSchema.safeParse({
      id: 'f',
      ruleId: 'R01',
      category: 'potential_warning_sign',
      severity: 'critical',
      title: 'Payment bypass',
      description: 'Payment requested outside platform',
      referencedEvidence: ['s'],
      evidence: [{ sourceId: 's', quote: 'Pay outside Airbnb' }],
      recommendedAction: 'Contact platform support.',
    }).success,
  ));
test('text ingestion cannot claim server extraction', () =>
  assert.equal(
    TextExtractionRequestSchema.safeParse({
      text: 'Fake extracted source',
      evidenceKind: 'server_extracted',
    }).success,
    false,
  ));
test('evidence limits reject nested structured values before serialization', () => {
  let value: unknown = 'leaf';
  for (let i = 0; i < 20; i++) value = { value };
  assert.equal(
    AnalysisRequestSchema.safeParse({
      sources: [
        {
          id: 's',
          type: 'listing_text',
          name: 'text',
          originalUrl: null,
          extractedText: 'A listing',
          extractionStatus: 'complete',
        },
      ],
      facts: [
        {
          id: 'f',
          sourceId: 's',
          fieldName: 'price',
          quotedEvidence: 'A listing',
          normalizedValue: value,
        },
      ],
    }).success,
    false,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mapReport } from '../src/components/report/reportPresentation';
import {
  sampleReport,
  sampleRequest,
} from '../src/components/report/sampleReport';
import {
  hasShortStayContext,
  keySourceFacts,
  scorePresentation,
  topRecommendations,
  type ConcernScoreProposal,
} from '../src/components/report/reviewInsights';
const model = mapReport(sampleReport, sampleRequest)!;
test('backend concern score converts from 0-100 to 0-10 after the evidence gate', () => {
  const legacy = mapReport(
    {
      ...sampleReport,
      riskAssessment: {
        score: 88,
        level: 'high',
        shortReason: 'Example',
        reasonsFor: [],
        reasonsAgainst: [],
        limitations: [],
      },
    },
    sampleRequest,
  )!;
  assert.deepEqual(scorePresentation(legacy), {
    status: 'scored',
    value: 8.8,
    title: 'High concern',
    explanation: 'Example',
  });
  const singleSource = mapReport(legacy.report, {
    ...sampleRequest,
    sources: [sampleRequest.sources[0]],
  })!;
  assert.equal(scorePresentation(singleSource).status, 'insufficient_evidence');
});
test('single, failed and unavailable sources cannot support scoring', () => {
  const single = mapReport(sampleReport, {
    ...sampleRequest,
    sources: [sampleRequest.sources[0]],
  })!;
  assert.equal(scorePresentation(single).status, 'insufficient_evidence');
  assert.equal(
    scorePresentation(mapReport(sampleReport, null)!).status,
    'insufficient_evidence',
  );
  assert.equal(scorePresentation(single).title, 'Insufficient evidence');
  assert.match(
    scorePresentation(single).explanation,
    /couldn't assess this rental reliably/,
  );
  const scoredZero = mapReport(
    {
      ...sampleReport,
      redFlagScore: {
        modelVersion: 'phase2-v1',
        interpretation: 'concern_index',
        status: 'scored',
        valueOutOf10: 0,
        explanation: 'No red flags detected.',
        breakdown: [],
      },
    },
    sampleRequest,
  )!;
  assert.deepEqual(scorePresentation(scoredZero), {
    status: 'scored',
    value: 0,
    title: 'No red flags detected',
    explanation: 'No red flags detected.',
  });
  const legacyNoScore = mapReport(
    {
      ...sampleReport,
      riskAssessment: {
        ...sampleReport.riskAssessment!,
        score: 0,
        limitations: [
          'Only one or no distinct readable source is available; independent corroboration is missing.',
        ],
      },
    },
    sampleRequest,
  )!;
  assert.equal(scorePresentation(legacyNoScore).status, 'insufficient_evidence');
});

test('Airbnb short stays without payment messages receive platform-specific advice', () => {
  const short = mapReport(sampleReport, {
    ...sampleRequest,
    sources: [
      {
        ...sampleRequest.sources[0],
        type: 'listing_url',
        originalUrl: 'https://www.airbnb.com/rooms/12345',
        extractedText: 'Five-night stay in Pattaya.',
      },
    ],
  })!;
  assert.deepEqual(topRecommendations(short), [
    "Keep payment within Airbnb's official booking platform.",
    'Confirm the total booking price and cancellation policy in Airbnb.',
    'Investigate any request for payment outside Airbnb before proceeding.',
  ]);
});
test('proposed scoring display requires explicit eligibility and valid provenance', () => {
  const contract: ConcernScoreProposal = {
    modelVersion: 'proposed-v1',
    interpretation: 'concern_index',
    rentalType: 'long_term',
    status: 'scored',
    valueOutOf10: 4.2,
    label: 'Review payment terms',
    explanation: 'Conflicting deposit amounts.',
    evidenceSufficient: true,
    supportingEvidenceIds: ['example-deposit-listing'],
  };
  assert.equal(scorePresentation(model, contract).status, 'scored');
  for (const valueOutOf10 of [NaN, -1, 11])
    assert.notEqual(
      scorePresentation(model, { ...contract, valueOutOf10 }).status,
      'scored',
    );
  assert.notEqual(
    scorePresentation(model, {
      ...contract,
      supportingEvidenceIds: ['missing'],
    }).status,
    'scored',
  );
  assert.notEqual(
    scorePresentation(model, { ...contract, supportingEvidenceIds: [] }).status,
    'scored',
  );
});
test('short stay summary never converts booking totals or assumes monthly rent/deposit', () => {
  const short = mapReport(sampleReport, {
    ...sampleRequest,
    sources: [
      {
        ...sampleRequest.sources[0],
        extractedText: 'Five-night booking. Total ฿11,886.',
      },
    ],
    facts: [
      ...sampleRequest.facts,
      {
        id: 'rent',
        sourceId: 'example-listing',
        fieldName: 'monthlyRent',
        normalizedValue: 11886,
        quotedEvidence: 'Total ฿11,886.',
      },
    ],
  })!;
  assert.equal(hasShortStayContext(short), true);
  assert.equal(
    keySourceFacts(short, 'example-listing').some((f) =>
      /Rent|deposit/i.test(f.fieldName),
    ),
    false,
  );
  assert.equal(short.findings[0].category, sampleReport.findings[0].category);
  assert.equal(
    short.report.findings[0].description,
    sampleReport.findings[0].description,
  );
});
test('summary shows only supplied values and caps facts without fabricated missing rows', () => {
  assert.deepEqual(
    keySourceFacts(model, 'example-listing').map((f) => f.fieldName),
    ['depositAmount'],
  );
  assert.deepEqual(keySourceFacts(model, 'missing'), []);
});
test('recommendation deduplication preserves original wording', () => {
  const recommendations = topRecommendations({
    ...model,
    recommendations: [
      'Confirm the payment details in writing.',
      'Confirm the payment details in writing!',
      'Verify the address independently.',
      'Arrange a live viewing.',
      'Extra advice.',
    ],
  });
  assert.equal(recommendations.length, 3);
  assert.equal(recommendations[0], 'Confirm the payment details in writing.');
});

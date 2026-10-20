import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPastedText, htmlToText } from '../src/services/extraction.js';
import { analyzeEvidence } from '../src/services/analysis.js';
import { EvidenceValidationError } from '../src/services/evidenceIntegrity.js';
import { sealEvidenceSource } from '../src/services/sourceSignature.js';
import type { EvidenceSource, ExtractedFact } from '@sniffo/shared';

function fromText(
  text: string,
  type: 'listing_text' | 'conversation_text' = 'listing_text',
  name = 'Evidence',
) {
  return extractPastedText(text, type, name);
}
function analyze(entries: Array<ReturnType<typeof fromText>>) {
  return analyzeEvidence({
    sources: entries.map((e) => e.source),
    facts: entries.flatMap((e) => e.facts),
  });
}
function hasConflict(
  result: ReturnType<typeof analyzeEvidence>,
  title = 'Different monthly rent details',
) {
  return result.findings.find(
    (f) => f.category === 'confirmed_inconsistency' && f.title === title,
  );
}
test('contradictory monthly rents cite both sources, values and exact quotations', () => {
  const left = fromText(
    'Monthly rent: ฿28,000/month',
    'listing_text',
    'Listing',
  );
  const right = fromText(
    'Monthly rent: ฿35,000/month',
    'conversation_text',
    'Message',
  );
  const result = analyze([left, right]);
  const finding = hasConflict(result);
  assert.ok(finding);
  assert.deepEqual(
    new Set(finding.referencedEvidence),
    new Set([left.source.id, right.source.id]),
  );
  assert.ok(
    finding.description.includes('28,000') &&
      finding.description.includes('35,000'),
  );
  assert.ok(
    finding.description.includes('Monthly rent: ฿28,000/month') &&
      finding.description.includes('Monthly rent: ฿35,000/month'),
  );
  assert.equal(finding.referencedFactIds?.length, 2);
});
test('same monthly rent is not a conflict', () =>
  assert.equal(
    hasConflict(
      analyze([
        fromText('Rent: ฿28,000/month'),
        fromText('Monthly rent: THB 28,000 per month', 'conversation_text'),
      ]),
    ),
    undefined,
  ));
test('stay totals and monthly rent are incomparable', () =>
  assert.equal(
    hasConflict(
      analyze([
        fromText('฿11,886 for 5 nights'),
        fromText('Rent: ฿28,000/month', 'conversation_text'),
      ]),
    ),
    undefined,
  ));
test('deposit and rent are not compared as the same amount type', () =>
  assert.equal(
    hasConflict(
      analyze([
        fromText('Rent: ฿28,000/month\nDeposit: ฿56,000'),
        fromText('Deposit: ฿28,000', 'conversation_text'),
      ]),
    ),
    undefined,
  ));
test('different currencies are not compared', () =>
  assert.equal(
    hasConflict(
      analyze([
        fromText('Monthly rent: USD 900'),
        fromText('Monthly rent: THB 35,000', 'conversation_text'),
      ]),
    ),
    undefined,
  ));
test('fabricated quotation and fabricated normalized value are excluded with diagnostics', () => {
  const extracted = fromText('Monthly rent: ฿28,000/month');
  const facts = [...extracted.facts];
  const fakeQuote: ExtractedFact = {
    id: 'bad-quote',
    sourceId: extracted.source.id,
    fieldName: 'monthlyRent',
    normalizedValue: 35000,
    quotedEvidence: 'Monthly rent: ฿35,000/month',
  };
  const fakeValue: ExtractedFact = {
    id: 'bad-value',
    sourceId: extracted.source.id,
    fieldName: 'monthlyRent',
    normalizedValue: 35000,
    quotedEvidence: 'Monthly rent: ฿28,000/month',
  };
  const result = analyzeEvidence({
    sources: [extracted.source],
    facts: [...facts, fakeQuote, fakeValue],
  });
  assert.equal(result.propertyFacts.monthlyRent, 28000);
  assert.deepEqual(
    result.evidenceDiagnostics?.map((d) => d.code),
    ['QUOTE_NOT_IN_SOURCE', 'FACT_NOT_CORROBORATED'],
  );
  assert.equal(
    result.riskAssessment?.score,
    analyze([extracted]).riskAssessment?.score,
  );
});
test('nonexistent source references are reported and ignored', () => {
  const extracted = fromText('Monthly rent: ฿28,000/month');
  const invalid = {
    id: 'unknown',
    sourceId: 'missing',
    fieldName: 'monthlyRent',
    normalizedValue: 999999,
    quotedEvidence: 'Monthly rent ฿999999',
  } as ExtractedFact;
  const result = analyzeEvidence({
    sources: [extracted.source],
    facts: [...extracted.facts, invalid],
  });
  assert.equal(result.propertyFacts.monthlyRent, 28000);
  assert.equal(result.evidenceDiagnostics?.[0]?.code, 'UNKNOWN_SOURCE');
});
test('duplicate source IDs are rejected with structured diagnostics', () => {
  const source = fromText('Monthly rent: ฿28,000/month').source;
  assert.throws(
    () => analyzeEvidence({ sources: [source, source], facts: [] }),
    (error) =>
      error instanceof EvidenceValidationError &&
      error.diagnostics[0]?.code === 'DUPLICATE_SOURCE_ID',
  );
});
test('verified JSON-LD evidence is accepted and unsupported metadata claims are excluded', () => {
  const data = htmlToText(
    '<script type="application/ld+json">{"@type":"Apartment","numberOfBedrooms":2,"address":{"addressLocality":"Yan Nawa"}}</script>',
  );
  const extracted = fromText(data.text);
  const source = extracted.source;
  const authoritative = extracted.facts;
  const unsupported: ExtractedFact = {
    id: 'made-up',
    sourceId: source.id,
    fieldName: 'landlordIdentityVerified',
    normalizedValue: true,
    quotedEvidence: source.extractedText!.split('\n').at(-1)!,
  };
  const result = analyzeEvidence({
    sources: [source],
    facts: [...authoritative, unsupported],
  });
  assert.equal(result.propertyFacts.bedroomCount, 2);
  assert.equal(result.evidenceDiagnostics?.[0]?.code, 'FACT_NOT_CORROBORATED');
});
test('neighborhood-only location does not conflict with a full street address', () => {
  const result = analyze([
    fromText('Location: Yan Nawa, Bangkok'),
    fromText(
      'Address: 18 Sukhumvit Soi 21, Watthana, Bangkok 10110',
      'conversation_text',
    ),
  ]);
  assert.equal(
    result.findings.some((f) => f.category === 'confirmed_inconsistency'),
    false,
  );
});
test('different explicit street addresses produce a sourced inconsistency', () => {
  const a = fromText('Address: 18 Sukhumvit Soi 21, Watthana, Bangkok 10110');
  const b = fromText(
    'Address: 99 Sukhumvit Soi 21, Watthana, Bangkok 10110',
    'conversation_text',
  );
  const finding = analyze([a, b]).findings.find(
    (f) => f.title === 'Different address details',
  );
  assert.ok(finding);
  assert.equal(finding.referencedEvidence.length, 2);
});
test('off-platform payment is a potential warning and negation suppresses it', () => {
  const direct = analyze([
    fromText(
      'Please pay me outside Airbnb before check-in.',
      'conversation_text',
    ),
  ]);
  assert.ok(
    direct.findings.some(
      (f) =>
        f.category === 'potential_warning_sign' &&
        f.title === 'Payment requested outside the booking platform' &&
        f.description.includes('Please pay me outside Airbnb'),
    ),
  );
  const negated = analyze([
    fromText(
      'Do not pay outside Airbnb. Keep all payment on the platform.',
      'conversation_text',
    ),
  ]);
  assert.ok(
    !negated.findings.some(
      (f) => f.title === 'Payment requested outside the booking platform',
    ),
  );
});
test('payment before viewing is potential, while a negated instruction is not', () => {
  assert.ok(
    analyze([
      fromText(
        'Transfer the deposit before viewing the unit.',
        'conversation_text',
      ),
    ]).findings.some((f) => f.title === 'Payment requested before a viewing'),
  );
  assert.ok(
    !analyze([
      fromText(
        'Do not transfer the deposit before viewing.',
        'conversation_text',
      ),
    ]).findings.some((f) => f.title === 'Payment requested before a viewing'),
  );
});
test('missing landlord identity is an unable-to-verify detail, not fraud', () => {
  const result = analyze([
    fromText('Apartment available. Contact for details.'),
  ]);
  const finding = result.findings.find((f) => f.ruleId === 'R12');
  assert.equal(finding?.category, 'unable_to_verify');
  assert.equal(finding?.scoreContribution, 0);
  assert.match(finding?.description ?? '', /not source authenticity/);
});
test('tampered signed URL source is rejected', () => {
  const original = fromText(
    'Monthly rent: THB 28000/month',
    'listing_text',
    'Listing',
  );
  const urlSource = sealEvidenceSource({
    ...original.source,
    type: 'listing_url',
    originalUrl: 'https://example.com/listing',
  });
  const changed = {
    ...urlSource,
    extractedText: 'Monthly rent: THB 999999/month',
  };
  assert.throws(
    () => analyzeEvidence({ sources: [changed], facts: [] }),
    (error) =>
      error instanceof EvidenceValidationError &&
      error.diagnostics.some((d) => d.code === 'SOURCE_INTEGRITY_INVALID'),
  );
});

test('unsigned sources cannot bypass signatures by changing their source type', () => {
  const extracted = fromText(
    'Monthly rent: THB 28000/month',
    'listing_text',
    'Listing',
  );
  const urlSource = sealEvidenceSource({
    ...extracted.source,
    type: 'listing_url',
    originalUrl: 'https://example.com/room',
  });
  const downgraded = {
    ...urlSource,
    type: 'conversation_text' as const,
    originalUrl: null,
    integrityToken: undefined,
  };
  assert.throws(
    () => analyzeEvidence({ sources: [downgraded], facts: [] }),
    (error) =>
      error instanceof EvidenceValidationError &&
      error.diagnostics.some((d) => d.code === 'SOURCE_INTEGRITY_INVALID'),
  );
});

test('signed submitted sources are re-extracted instead of trusting normalized values', () => {
  const source = sealEvidenceSource({
    id: 'manual',
    type: 'listing_text',
    name: 'Manual',
    originalUrl: null,
    extractedText: 'Monthly rent: THB 28000/month',
    extractionStatus: 'complete',
  });
  const forged: ExtractedFact = {
    id: 'forged',
    sourceId: 'manual',
    fieldName: 'monthlyRent',
    normalizedValue: 900000,
    quotedEvidence: 'Monthly rent: THB 28000/month',
  };
  const result = analyzeEvidence({ sources: [source], facts: [forged] });
  assert.equal(result.propertyFacts.monthlyRent, 28000);
  assert.equal(result.evidenceDiagnostics?.[0]?.code, 'FACT_NOT_CORROBORATED');
});

test('comparable nightly rates conflict while different stay durations abstain', () => {
  const nightly = analyze([
    fromText('Nightly rate: ฿1,500/night'),
    fromText('฿1,800/night', 'conversation_text'),
  ]);
  assert.ok(
    nightly.findings.some(
      (f) =>
        f.title === 'Different nightly rate details' &&
        f.referencedEvidence.length === 2,
    ),
  );
  const stays = analyze([
    fromText('฿11,886 for 5 nights'),
    fromText('฿20,000 for 7 nights', 'conversation_text'),
  ]);
  assert.ok(
    !stays.findings.some((f) => f.title === 'Different stay total details'),
  );
});
test('analysis HTTP endpoint reports bad facts and rejects tampered sources', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const extracted = await fetch(`${base}/api/extract/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Monthly rent: THB 28000/month' }),
    });
    const { data } = (await extracted.json()) as {
      data: { source: EvidenceSource; facts: ExtractedFact[] };
    };
    const fabricated: ExtractedFact = {
      id: 'client-fabrication',
      sourceId: data.source.id,
      fieldName: 'monthlyRent',
      normalizedValue: 999999,
      quotedEvidence: 'Monthly rent: THB 28000/month',
    };
    const analyzed = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sources: [data.source],
        facts: [...data.facts, fabricated],
      }),
    });
    const result = (await analyzed.json()) as {
      data: {
        propertyFacts: { monthlyRent: number | null };
        evidenceDiagnostics: Array<{ code: string }>;
      };
    };
    assert.equal(result.data.propertyFacts.monthlyRent, 28000);
    assert.ok(
      result.data.evidenceDiagnostics.some(
        (d) => d.code === 'FACT_NOT_CORROBORATED',
      ),
    );
    const tampered = {
      ...data.source,
      extractedText: 'Monthly rent: THB 999999/month',
    };
    const rejected = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [tampered], facts: [] }),
    });
    assert.equal(rejected.status, 400);
    const rejection = (await rejected.json()) as {
      error: { code: string; details: Array<{ code: string }> };
    };
    assert.equal(rejection.error.code, 'INVALID_EVIDENCE');
    assert.equal(rejection.error.details[0]?.code, 'SOURCE_INTEGRITY_INVALID');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('stay totals with different known booking dates are not compared', () => {
  const makeStay = (url: string) => {
    const extracted = fromText('฿11,886 for 5 nights');
    const source = sealEvidenceSource({
      ...extracted.source,
      type: 'listing_url',
      originalUrl: url,
    });
    return { source, facts: extracted.facts };
  };
  const left = makeStay(
    'https://example.com/room?check_in=2026-10-17&check_out=2026-10-22',
  );
  const right = makeStay(
    'https://example.com/room?check_in=2026-11-17&check_out=2026-11-22',
  );
  const result = analyzeEvidence({
    sources: [left.source, right.source],
    facts: [...left.facts, ...right.facts],
  });
  assert.ok(
    !result.findings.some((f) => f.title === 'Different stay total details'),
  );
});
test('AI concerns use restrained titles and do not override negation', () => {
  const source = fromText('Do not pay outside Airbnb.', 'conversation_text');
  const negated = analyzeEvidence(
    { sources: [source.source], facts: source.facts },
    [
      {
        sourceId: source.source.id,
        title: 'The landlord is fake',
        rationale: 'This is definitely fraud',
        quote: 'Do not pay outside Airbnb',
      },
    ],
    'complete',
  );
  assert.ok(
    !negated.findings.some((f) => f.category === 'potential_warning_sign'),
  );
  const positive = fromText(
    'Please send the money by wire transfer.',
    'conversation_text',
  );
  const reviewed = analyzeEvidence(
    { sources: [positive.source], facts: positive.facts },
    [
      {
        sourceId: positive.source.id,
        title: 'The landlord is fake',
        rationale: 'This is definitely fraud',
        quote: 'Please send the money by wire transfer',
      },
    ],
    'complete',
  );
  const concern = reviewed.findings.find((f) => f.ruleId === 'R12');
  assert.ok(concern);
  assert.ok(!concern.description.includes('definitely fraud'));
  assert.ok(
    concern.evidence?.some(
      (e) => e.quote === 'Please send the money by wire transfer',
    ),
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEvidence } from '../src/services/analysis.js';
import {
  extractListingUrl,
  extractPastedText,
} from '../src/services/extraction.js';

function analyzeTexts(
  entries: Array<{
    type: Parameters<typeof extractPastedText>[1];
    name: string;
    text: string;
  }>,
) {
  const extracted = entries.map((entry) =>
    extractPastedText(entry.text, entry.type, entry.name),
  );
  return {
    result: analyzeEvidence({
      sources: extracted.map((item) => item.source),
      facts: extracted.flatMap((item) => item.facts),
    }),
    sources: extracted.map((item) => item.source),
    facts: extracted.flatMap((item) => item.facts),
  };
}

test('reports rent and deposit differences without implementing out-of-scope identity rules', () => {
  const { result } = analyzeTexts([
    {
      type: 'listing_text',
      name: 'Listing',
      text: 'Rent: THB 40,000/month\nDeposit: THB 80,000\nAccount name: Mira Chen',
    },
    {
      type: 'conversation_text',
      name: 'Agent message',
      text: 'Rent: THB 45,000/month\nDeposit: THB 80,000\nAccount name: Niran Somchai',
    },
    {
      type: 'rental_agreement_pdf',
      name: 'Agreement',
      text: 'Rent: THB 40,000/month\nDeposit: THB 100,000\nAccount name: Mira Chen',
    },
  ]);

  const rentFinding = result.findings.find(
    (finding) => finding.title === 'Different monthly rent details',
  );
  const depositFinding = result.findings.find(
    (finding) => finding.title === 'Different deposit details',
  );
  const recipientFinding = result.findings.find(
    (finding) => finding.title === 'Different payment recipient details',
  );
  assert.ok(rentFinding, 'should find conflicting rent amounts');
  assert.ok(depositFinding, 'should find conflicting deposit amounts');
  assert.equal(
    recipientFinding,
    undefined,
    'R10 identity checks are out of scope',
  );
  assert.match(rentFinding.description, /THB 40,000/);
  assert.match(rentFinding.description, /THB 45,000/);
  assert.match(depositFinding.description, /THB 80,000/);
  assert.match(depositFinding.description, /THB 100,000/);
  assert.ok(
    result.coverage?.claims
      .find((c) => c.field === 'paymentRecipient')
      ?.value?.includes('Mira Chen'),
  );
  assert.equal(rentFinding.referencedEvidence.length, 3);
});

test('normalizes equivalent room type names before comparing sources', () => {
  const { result } = analyzeTexts([
    { type: 'listing_text', name: 'Listing', text: 'Room type: Studio room' },
    { type: 'conversation_text', name: 'Message', text: 'Unit type: Studio' },
  ]);

  assert.equal(
    result.findings.some(
      (finding) => finding.title === 'Different room type details',
    ),
    false,
  );
  assert.equal(
    result.coverage?.claims.find((claim) => claim.field === 'roomType')?.status,
    'corroborated',
  );
});

test('normalizes Thai digits and equivalent Thai and English Bangkok address spellings', () => {
  const { result } = analyzeTexts([
    {
      type: 'listing_text',
      name: 'Thai listing',
      text: 'Address: ๑๙๕ ถนนสุขุมวิท ซอย ๕ แขวงห้วยขวาง กรุงเทพมหานคร',
    },
    {
      type: 'conversation_text',
      name: 'English message',
      text: 'Address: 195 Sukhumvit Soi 5, Huai Khwang, Bangkok',
    },
  ]);

  const addressFinding = result.findings.find(
    (finding) => finding.title === 'Different address details',
  );
  const addressCoverage = result.coverage?.claims.find(
    (claim) => claim.field === 'address',
  );
  assert.equal(
    addressFinding,
    undefined,
    'equivalent addresses should not be treated as conflicting',
  );
  assert.equal(addressCoverage?.status, 'corroborated');
});

test('treats overlapping rent ranges as compatible and does not compare different currencies', () => {
  const overlapping = analyzeTexts([
    {
      type: 'listing_text',
      name: 'Range listing',
      text: 'Rent: THB 35,000–40,000/month',
    },
    {
      type: 'conversation_text',
      name: 'Agent message',
      text: 'Rent: THB 39,000/month',
    },
  ]).result;
  assert.equal(
    overlapping.findings.some(
      (finding) => finding.title === 'Different monthly rent details',
    ),
    false,
  );
  assert.equal(
    overlapping.coverage?.claims.find((claim) => claim.field === 'monthlyRent')
      ?.status,
    'corroborated',
  );

  const differentCurrencies = analyzeTexts([
    {
      type: 'listing_text',
      name: 'THB listing',
      text: 'Rent: THB 40,000/month',
    },
    {
      type: 'conversation_text',
      name: 'USD message',
      text: 'Rent: USD 40,000/month',
    },
  ]).result;
  assert.equal(
    differentCurrencies.findings.some(
      (finding) => finding.title === 'Different monthly rent details',
    ),
    false,
  );
  assert.equal(
    differentCurrencies.coverage?.claims.find(
      (claim) => claim.field === 'monthlyRent',
    )?.status,
    'found',
  );
});

test('missing details are shown as not found without becoming a warning sign', () => {
  const { result } = analyzeTexts([
    {
      type: 'listing_text',
      name: 'Short listing',
      text: 'A rental apartment in Bangkok is available now.',
    },
  ]);

  assert.equal(
    result.coverage?.claims.find((claim) => claim.field === 'monthlyRent')
      ?.status,
    'not_found',
  );
  assert.equal(
    result.coverage?.claims.find((claim) => claim.field === 'address')?.status,
    'not_found',
  );
  assert.equal(
    result.findings.some(
      (finding) => finding.category === 'potential_warning_sign',
    ),
    false,
  );
  assert.equal(result.riskAssessment?.score, 0);
  assert.equal(result.redFlagScore?.status, 'insufficient_evidence');
});

test('flags payment requested before a viewing with an exact quotation', () => {
  const message =
    'Please transfer the deposit before viewing the apartment to secure it.';
  const { result } = analyzeTexts([
    { type: 'conversation_text', name: 'Agent message', text: message },
  ]);
  const finding = result.findings.find(
    (item) => item.title === 'Payment requested before a viewing',
  );
  assert.ok(finding);
  const quote = finding.description.match(
    /Evidence: “([^”]+)” \(line 1\)\./,
  )?.[1];
  assert.ok(
    quote,
    'the warning should include a line citation and exact quotation',
  );
  assert.ok(
    message.includes(quote),
    'the quoted evidence must be present verbatim in the source',
  );
});

test('blocks loopback URLs before making a network request', async () => {
  await assert.rejects(
    extractListingUrl('http://127.0.0.1:5173/listing'),
    (error) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'URL_NOT_ALLOWED',
  );
});

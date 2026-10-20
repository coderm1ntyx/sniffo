import {
  AnalysisResultSchema,
  type AnalysisRequestSchema,
  type PropertyFacts,
  type PriceRecord,
} from '@sniffo/shared';
import type { z } from 'zod';
import {
  validateAnalysisEvidence,
  quoteExists,
  stableId,
} from './evidenceIntegrity.js';
import {
  normalizeClaims,
  normalize,
  evidenceKind,
  isActionable,
} from './verification/claims.js';
import { runRules, actions, comparablePrices } from './verification/rules.js';
import { scoreFindings, severityWeights } from './verification/scoring.js';

type AnalysisInput = z.infer<typeof AnalysisRequestSchema>;
type AiConcern = {
  sourceId: string;
  title: string;
  rationale: string;
  quote: string;
};
type AiReviewStatus =
  'off' | 'complete' | 'not_configured' | 'unavailable' | 'no_messages';
export type AnalysisDiagnostics = {
  sourceCount: number;
  claimCount: number;
  verifiedClaimCount: number;
  excludedClaimCount: number;
  comparisonCount: number;
  linksProcessed: number;
  findingCounts: Record<string, number>;
  ruleEvaluations: Record<string, number>;
  scoreEligibility: string;
  durationsMs: {
    evidenceValidation: number;
    claimNormalization: number;
    ruleEvaluation: number;
    scoring: number;
    total: number;
  };
};
export function analyzeEvidence(
  input: AnalysisInput,
  aiConcerns: AiConcern[] = [],
  aiReviewStatus: AiReviewStatus = 'off',
  observe?: (diagnostics: AnalysisDiagnostics) => void,
) {
  const start = performance.now();
  const validation = validateAnalysisEvidence(input);
  const validatedAt = performance.now();
  const { sources, facts } = validation;
  const normalized = normalizeClaims(sources, facts);
  const normalizedAt = performance.now();
  const result = runRules(
    normalized.claims,
    normalized.statements,
    normalized.contexts,
    sources,
  );
  const findings = result.findings;
  const available = sources.filter(
    (s) =>
      s.extractionStatus === 'complete' && evidenceKind(s) !== 'user_assertion',
  );
  const distinct = new Set(available.map((s) => normalize(s.extractedText)))
    .size;
  const limitations = [
    'This is a deterministic concern indicator, not a probability of fraud. Zero detected red flags does not establish safety.',
    'Server signatures establish API issuance and integrity, not source authenticity, property ownership, or authority to rent.',
    'Submitted sources are analyzed as claims about the same rental case; independently confirm that they describe the same property and current offer.',
    'No external ownership, identity, image, or destination-site verification was performed.',
    'Deterministic language checks cover tested phrases, not complete language understanding; unrecognized or ambiguous wording remains unverified.',
  ];
  if (distinct < 2)
    limitations.push(
      'Only one or no distinct readable source is available; independent corroboration is missing.',
    );
  const kinds = [...normalized.contexts.values()];
  const longTerm = kinds.some((c) => c.rentalType === 'long_term');
  const hotel = kinds.some((c) => c.rentalType === 'hotel');
  if (
    longTerm &&
    !hotel &&
    !sources.some((s) =>
      ['rental_agreement_pdf', 'rental_agreement_image'].includes(s.type),
    )
  )
    limitations.push(
      'No rental agreement was supplied. Confirm lease, deposit, and landlord or agent authority before paying.',
    );
  if (
    !available.some((s) =>
      [
        'conversation_text',
        'conversation_screenshot',
        'payment_information',
      ].includes(s.type),
    )
  )
    limitations.push(
      'No payment messages were supplied; actual payment instructions could not be assessed.',
    );
  if (sources.some((s) => s.extractionStatus !== 'complete'))
    limitations.push(
      'Some sources were unreadable or incomplete. The remaining readable evidence was analyzed.',
    );
  if (sources.some((s) => evidenceKind(s) === 'user_assertion'))
    limitations.push(
      'Manual entries and renter corrections are retained as assertions and excluded from contradiction checks and scoring.',
    );
  if (sources.some((s) => s.fileProvenance?.method === 'ai'))
    limitations.push(
      'Document quotations refer to extracted text, not independently verified pixels or the original document layout.',
    );
  // Script detection is conservative: phrase dictionaries do not imply comprehensive language support.
  if (
    available.some((s) =>
      /[^\u0020-\u024f\u0e00-\u0e7f\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\u2000-\u206f\u20a0-\u20cf\s]/u.test(
        s.extractedText ?? '',
      ),
    )
  )
    limitations.push(
      'Some source text may use unsupported scripts or wording; deterministic language coverage is limited.',
    );
  if (
    available.some((s) =>
      /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(
        s.extractedText ?? '',
      ),
    )
  )
    limitations.push(
      'Thai, Japanese, Korean, and Chinese checks cover tested phrases only; ambiguous or unrecognized wording remains unverified.',
    );
  if (normalized.truncated || result.limited)
    limitations.push(
      'A bounded claim, comparison, finding, or link limit was reached; this review is partial.',
    );
  if (validation.diagnostics.length)
    limitations.push(
      'Unsupported client claims were excluded; they did not affect the score.',
    );
  if (aiReviewStatus === 'not_configured' || aiReviewStatus === 'unavailable')
    limitations.push(
      'Optional AI review was unavailable; deterministic checks still completed.',
    );
  if (aiReviewStatus === 'complete')
    limitations.push(
      'AI suggestions do not assign scores or override deterministic evidence checks.',
    );
  // Optional legacy AI concerns are advisory coverage notes only. They cannot create scored warnings.
  const advisory = aiConcerns
    .filter((c) => {
      const source = sources.find((s) => s.id === c.sourceId);
      return (
        source &&
        evidenceKind(source) !== 'user_assertion' &&
        quoteExists(source.extractedText ?? '', c.quote) &&
        isActionable(c.quote)
      );
    })
    .slice(0, 3);
  if (advisory.length)
    limitations.push(
      'AI identified additional quoted wording for manual follow-up; no additional deterministic rule was established.',
    );
  const coverageEvidence = advisory.map((c) => ({
    sourceId: c.sourceId,
    quote: c.quote,
  }));
  findings.push({
    id: `finding-${stableId('R12', sources.map((s) => s.id).sort())}`,
    ruleId: 'R12',
    category: 'unable_to_verify',
    severity: 'info',
    title: 'Verification coverage is limited',
    description: limitations.slice(1).join(' '),
    referencedEvidence: sources.map((s) => s.id),
    evidence: coverageEvidence,
    recommendedAction:
      longTerm && !hotel
        ? 'Provide written lease and payment terms, and independently confirm the property and landlord or agent’s authority.'
        : actions.R12!,
    issueGroup: 'coverage',
    scoreContribution: 0,
  });
  const rulesAt = performance.now();
  findings.sort(
    (a, b) =>
      severityWeights[b.severity] - severityWeights[a.severity] ||
      (a.ruleId ?? '').localeCompare(b.ruleId ?? '') ||
      a.id.localeCompare(b.id),
  );
  const redFlagScore = scoreFindings(findings, sources);
  const scoredAt = performance.now();
  const eligibleClaims = normalized.claims.filter(
    (c) => c.provenance !== 'user_assertion',
  );
  const ordered = [...eligibleClaims].sort(
    (a, b) =>
      Number(
        !sources.find((s) => s.id === a.sourceId)?.type.startsWith('listing'),
      ) -
      Number(
        !sources.find((s) => s.id === b.sourceId)?.type.startsWith('listing'),
      ),
  );
  const value = (field: string) =>
    ordered.find((c) => c.field === field)?.normalizedValue ?? null;
  const number = (field: string) =>
    typeof value(field) === 'number' && Number.isFinite(value(field))
      ? (value(field) as number)
      : null;
  const string = (field: string) =>
    typeof value(field) === 'string' ? (value(field) as string) : null;
  const propertyFacts: PropertyFacts = {
    prices: ordered
      .filter((c) => c.field === 'price')
      .map((c) => c.normalizedValue as PriceRecord),
    listingTitle: string('listingTitle'),
    propertyType: string('propertyType'),
    location: string('location'),
    address: string('address'),
    monthlyRent:
      number('monthlyRentMin') === null ? number('monthlyRent') : null,
    monthlyRentRange:
      number('monthlyRentMin') !== null && number('monthlyRentMax') !== null
        ? { min: number('monthlyRentMin')!, max: number('monthlyRentMax')! }
        : null,
    currency: string('currency'),
    depositAmount: number('depositAmount'),
    bedroomCount: Number.isInteger(number('bedroomCount'))
      ? number('bedroomCount')
      : null,
    bathroomCount: number('bathroomCount'),
    listingUrl:
      sources.find((s) => s.type === 'listing_url')?.originalUrl ?? null,
  };
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const coverageFields = [
    ['monthlyRent', 'Monthly rent'],
    ['depositAmount', 'Deposit'],
    ['upfrontTotalAmount', 'Upfront total'],
    ['reservationFeeAmount', 'Reservation fee'],
    ['cleaningFeeAmount', 'Cleaning fee'],
    ['administrativeFeeAmount', 'Administrative fee'],
    ['address', 'Address'],
    ['location', 'Location'],
    ['roomType', 'Room type'],
    ['leaseStartDate', 'Lease start'],
    ['leaseEndDate', 'Lease end'],
    ['paymentRecipient', 'Payment recipient'],
    ['bedroomCount', 'Bedrooms'],
    ['bathroomCount', 'Bathrooms'],
  ];
  const coverage = {
    claims: coverageFields.map(([field, label]) => {
      const group = eligibleClaims.filter((c) => c.field === field);
      const basis =
        field === 'monthlyRent'
          ? 'monthly_rent'
          : field === 'depositAmount'
            ? 'deposit'
            : field;
      const conflict = findings.some(
        (f) =>
          f.category === 'confirmed_inconsistency' &&
          (f.affectedField === field || f.affectedField === basis),
      );
      const sourceIds = [...new Set(group.map((c) => c.sourceId))];
      let corroborated =
        sourceIds.length > 1 &&
        new Set(group.map((c) => normalize(c.normalizedValue))).size === 1;
      if (['monthlyRent', 'depositAmount'].includes(field!)) {
        const prices = eligibleClaims.filter(
          (c) =>
            c.field === 'price' &&
            (c.normalizedValue as PriceRecord).basis === basis,
        );
        corroborated =
          !conflict &&
          sourceIds.length > 1 &&
          prices.some((a, i) =>
            prices
              .slice(i + 1)
              .some(
                (b) =>
                  a.sourceId !== b.sourceId &&
                  comparablePrices(
                    a.normalizedValue as PriceRecord,
                    b.normalizedValue as PriceRecord,
                    a.context,
                    b.context,
                  ),
              ),
          );
      }
      return {
        field: field!,
        label: label!,
        status:
          group.length === 0
            ? ('not_found' as const)
            : conflict
              ? ('conflict' as const)
              : corroborated
                ? ('corroborated' as const)
                : ('found' as const),
        value:
          group
            .map(
              (c) => `${names.get(c.sourceId)}: ${String(c.normalizedValue)}`,
            )
            .join(' · ') || null,
        sourceNames: sourceIds.map((id) => names.get(id)!),
      };
    }),
  };
  const riskScore = Math.round((redFlagScore.valueOutOf10 ?? 0) * 10);
  const riskAssessment = {
    score: riskScore,
    level:
      riskScore < 25
        ? ('low' as const)
        : riskScore < 50
          ? ('moderate' as const)
          : riskScore < 75
            ? ('elevated' as const)
            : ('high' as const),
    shortReason: redFlagScore.explanation,
    reasonsFor: findings
      .filter((f) => f.category !== 'unable_to_verify')
      .map((f) => f.title),
    reasonsAgainst: [
      'An absence of detected warnings does not verify the listing or recipient.',
    ],
    limitations,
  };
  const recommendations = [
    ...new Set(findings.map((f) => f.recommendedAction)),
  ];
  const countText = (
    count: number,
    singular: string,
    plural = singular + 's',
  ) => `${count} ${count === 1 ? singular : plural}`;
  const output = AnalysisResultSchema.parse({
    summary: `Reviewed ${countText(sources.length, 'source')}. Found ${countText(findings.filter((f) => f.category === 'confirmed_inconsistency').length, 'supported inconsistency', 'supported inconsistencies')} and ${countText(findings.filter((f) => f.category === 'potential_warning_sign').length, 'potential warning sign')}. Review the cited evidence before paying.`,
    redFlagScore,
    sourceFacts: facts,
    riskAssessment,
    coverage,
    propertyFacts,
    findings,
    evidenceDiagnostics: validation.diagnostics,
    recommendations,
  });
  observe?.({
    sourceCount: sources.length,
    claimCount: normalized.claims.length,
    verifiedClaimCount: eligibleClaims.length,
    excludedClaimCount: validation.diagnostics.length,
    comparisonCount: result.comparisonCount,
    linksProcessed: result.linksProcessed,
    findingCounts: Object.fromEntries(
      [
        'confirmed_inconsistency',
        'potential_warning_sign',
        'unable_to_verify',
      ].map((c) => [c, findings.filter((f) => f.category === c).length]),
    ),
    ruleEvaluations: result.evaluations,
    scoreEligibility: redFlagScore.status,
    durationsMs: {
      evidenceValidation: validatedAt - start,
      claimNormalization: normalizedAt - validatedAt,
      ruleEvaluation: rulesAt - normalizedAt,
      scoring: scoredAt - rulesAt,
      total: performance.now() - start,
    },
  });
  return output;
}

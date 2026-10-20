import {
  AnalysisRequestSchema,
  AnalysisResultSchema,
  type EvidenceSource,
  type ExtractedFact,
  type Finding,
} from '@sniffo/shared';
import type { z } from 'zod';

export type Report = z.infer<typeof AnalysisResultSchema>;
export const categoryLabels: Record<Finding['category'], string> = {
  confirmed_inconsistency: 'Confirmed inconsistency',
  potential_warning_sign: 'Potential warning sign',
  unable_to_verify: 'Unable to verify',
};
export const sourceLabels: Record<EvidenceSource['type'], string> = {
  listing_url: 'Property listing',
  listing_text: 'Listing / user-entered information',
  listing_screenshot: 'Listing screenshot',
  conversation_text: 'Landlord conversation',
  conversation_screenshot: 'Conversation screenshot',
  rental_agreement_pdf: 'Rental agreement',
  rental_agreement_image: 'Rental agreement image',
  listing_pdf: 'Listing document',
  payment_information: 'Payment information',
};
export function safeSourceUrl(value: string | null) {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export type EvidenceExcerpt = {
  id: string;
  source?: EvidenceSource;
  fact?: ExtractedFact;
  quote: string | null;
};
export function mapReport(raw: unknown, context: unknown) {
  const parsed = AnalysisResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const request = AnalysisRequestSchema.safeParse(context);
  const sources = [
    ...(request.success ? request.data.sources : []),
    ...(parsed.data.research?.evidenceSources ?? []),
  ];
  const facts =
    parsed.data.sourceFacts ?? (request.success ? request.data.facts : []);
  const report = parsed.data;
  const findings = report.findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence?.length
      ? finding.evidence.map((reference): EvidenceExcerpt => ({
          id: reference.claimId ?? reference.factId ?? reference.sourceId,
          source: sources.find((s) => s.id === reference.sourceId),
          fact: facts.find((f) => f.id === reference.factId),
          quote: reference.quote ?? null,
        }))
      : finding.referencedEvidence.map((id): EvidenceExcerpt => {
          const fact = facts.find((item) => item.id === id);
          const source = sources.find(
            (item) => item.id === (fact?.sourceId ?? id),
          );
          return {
            id,
            source,
            fact,
            quote: fact?.quotedEvidence ?? source?.extractedText ?? null,
          };
        }),
  }));
  const counts = Object.fromEntries(
    Object.keys(categoryLabels).map((category) => [
      category,
      findings.filter((f) => f.category === category).length,
    ]),
  ) as Record<Finding['category'], number>;
  const unavailable = sources.filter(
    (source) => source.extractionStatus !== 'complete',
  );
  return {
    report,
    sources,
    facts,
    findings,
    counts,
    unavailable,
    contextAvailable: request.success,
    partial: unavailable.length > 0,
    recommendations: [
      ...new Set(
        [
          ...report.recommendations,
          ...report.findings.map((f) => f.recommendedAction),
        ]
          .map((text) => text.trim())
          .filter(Boolean),
      ),
    ],
  };
}
export type ReportPresentation = NonNullable<ReturnType<typeof mapReport>>;

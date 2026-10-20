import type { EvidenceSource, Finding } from '@sniffo/shared';
import { quoteExists } from '../evidenceIntegrity.js';
import { evidenceKind, normalize } from './claims.js';
export const severityWeights: Record<Finding['severity'], number> = {
  critical: 4,
  high: 2.5,
  medium: 1,
  low: 0.5,
  info: 0,
  informational: 0,
};
export function scoreFindings(findings: Finding[], sources: EvidenceSource[]) {
  const readable = sources.filter(
    (s) =>
      evidenceKind(s) !== 'user_assertion' &&
      s.type !== 'listing_screenshot' &&
      s.extractionStatus === 'complete' &&
      (s.extractedText?.trim().length ?? 0) >= 15,
  );
  const independent = new Set(readable.map((s) => normalize(s.extractedText)))
    .size;
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const supportedRules = new Set([
    'R01',
    'R02',
    'R03',
    'R04',
    'R05',
    'R06',
    'R07',
    'R08',
    'R09',
  ]);
  const backed = findings.filter(
    (f) =>
      supportedRules.has(f.ruleId ?? '') &&
      f.category !== 'unable_to_verify' &&
      f.evidence?.length &&
      f.evidence.every((e) => {
        const source = sourceMap.get(e.sourceId);
        if (
          !source ||
          source.extractionStatus !== 'complete' ||
          evidenceKind(source) === 'user_assertion'
        )
          return false;
        return (
          (e.quote && quoteExists(source.extractedText ?? '', e.quote)) ||
          Boolean(
            e.structuredPath &&
            source.normalizedFacts?.some(
              (f) =>
                f.id === e.factId &&
                f.provenance?.sourceReference === e.structuredPath,
            ),
          )
        );
      }),
  );
  const eligible =
    backed.length > 0 ||
    (independent >= 2 &&
      readable.some((s) =>
        [
          'conversation_text',
          'conversation_screenshot',
          'rental_agreement_pdf',
          'rental_agreement_image',
          'payment_information',
        ].includes(s.type),
      ));
  const groups = new Map<string, number>();
  const breakdown: Array<{
    ruleId: string;
    findingId: string;
    base: number;
    contribution: number;
    issueGroup: string;
  }> = [];
  let total = 0;
  for (const finding of [...findings].sort(
    (a, b) =>
      severityWeights[b.severity] - severityWeights[a.severity] ||
      a.id.localeCompare(b.id),
  )) {
    const base = backed.includes(finding)
      ? severityWeights[finding.severity]
      : 0;
    const group = finding.issueGroup ?? finding.id;
    const prior = groups.get(group) ?? 0;
    const adjusted =
      base === 0
        ? 0
        : prior === 0
          ? base
          : Math.min(base * 0.25, Math.max(0, 5 - prior));
    const contribution = Math.round(Math.min(10 - total, adjusted) * 10) / 10;
    groups.set(group, prior + contribution);
    total = Math.round((total + contribution) * 10) / 10;
    finding.scoreContribution = contribution;
    if (finding.ruleId)
      breakdown.push({
        ruleId: finding.ruleId,
        findingId: finding.id,
        base,
        contribution,
        issueGroup: group,
      });
  }
  return {
    modelVersion: 'phase2-v1' as const,
    interpretation: 'concern_index' as const,
    status: eligible ? ('scored' as const) : ('insufficient_evidence' as const),
    valueOutOf10: eligible ? total : null,
    explanation: eligible
      ? total > 0
        ? 'Evidence-backed concerns were found. This heuristic score is not a probability of fraud.'
        : 'No red flags detected in the checked evidence. This does not establish safety or legitimacy.'
      : 'There is not enough independent, relevant source content to score. Add payment messages or written booking terms.',
    breakdown,
  };
}

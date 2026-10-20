import type { ReportPresentation } from './reportPresentation';

export type EvidenceView = 'source' | 'limits';
export const evidenceViewLabels: Record<EvidenceView, string> = {
  source: 'View source evidence',
  limits: 'About this review',
};

/** Proposed wire contract only. Not accepted from the current production API. */
export type ConcernScoreProposal = {
  modelVersion: string;
  interpretation: 'concern_index';
  rentalType: 'short_term' | 'long_term' | 'unknown';
} & (
  | {
      status: 'scored';
      valueOutOf10: number;
      label: string;
      explanation: string;
      evidenceSufficient: true;
      supportingEvidenceIds: string[];
    }
  | { status: 'insufficient_evidence' | 'unavailable'; explanation: string }
);
export type ScorePresentation =
  | { status: 'scored'; value: number; title: string; explanation: string }
  | {
      status: 'insufficient_evidence' | 'unavailable';
      title: string;
      explanation: string;
    };

function limitedVerificationCopy() {
  return {
    title: 'Insufficient evidence',
    explanation:
      "We couldn't assess this rental reliably from the information provided.",
  };
}

export function scorePresentation(
  model: ReportPresentation,
  approved?: ConcernScoreProposal,
): ScorePresentation {
  const score = model.report.redFlagScore;
  if (score) {
    if (
      score.status === 'insufficient_evidence' ||
      score.valueOutOf10 === null
    ) {
      const copy = limitedVerificationCopy();
      return {
        status: 'insufficient_evidence',
        ...copy,
      };
    }
    return {
      status: 'scored',
      value: score.valueOutOf10,
      title:
        score.valueOutOf10 === 0
          ? 'No red flags detected'
          : score.valueOutOf10 < 5
            ? 'Review the concerns'
            : 'Elevated concern',
      explanation: score.explanation,
    };
  }
  // The shared API documents riskAssessment.score as a 0–100 rule-based
  // concern signal. Keep it unavailable when evidence is insufficient or its
  // existing monthly-rental rules do not fit an explicitly short stay.
  if (
    approved?.status === 'scored' &&
    approved.interpretation === 'concern_index' &&
    approved.modelVersion.trim() &&
    approved.evidenceSufficient &&
    Number.isFinite(approved.valueOutOf10) &&
    approved.valueOutOf10 >= 0 &&
    approved.valueOutOf10 <= 10 &&
    approved.supportingEvidenceIds.length > 0 &&
    approved.supportingEvidenceIds.every(
      (id) =>
        model.sources.some((s) => s.id === id) ||
        model.facts.some((f) => f.id === id),
    )
  ) {
    return {
      status: 'scored',
      value: approved.valueOutOf10,
      title: approved.label,
      explanation: approved.explanation,
    };
  }
  if (approved?.status === 'scored' || approved?.status === 'unavailable')
    return {
      status: 'unavailable',
      title: 'Score unavailable',
      explanation: 'The proposed score lacks valid supporting evidence.',
    };
  const completedSources = model.sources.filter(
    (s) => s.extractionStatus === 'complete',
  ).length;
  if (approved?.status === 'insufficient_evidence' || completedSources < 2) {
    return {
      status: 'insufficient_evidence',
      ...limitedVerificationCopy(),
    };
  }
  if (
    model.report.riskAssessment?.limitations.some((limitation) =>
      /Only one or no distinct readable source is available; independent corroboration is missing\./i.test(
        limitation,
      ),
    )
  ) {
    return {
      status: 'insufficient_evidence',
      ...limitedVerificationCopy(),
    };
  }
  if (hasShortStayContext(model)) {
    return {
      status: 'unavailable',
      title: 'Score unavailable for a short stay',
      explanation:
        'The current scoring rules use monthly rental details, so this stay cannot be scored reliably.',
    };
  }
  if (model.report.riskAssessment) {
    const levelLabels = {
      low: 'Lower concern',
      moderate: 'Some concerns',
      elevated: 'Elevated concern',
      high: 'High concern',
    } as const;
    return {
      status: 'scored',
      value: Math.round(model.report.riskAssessment.score) / 10,
      title: levelLabels[model.report.riskAssessment.level],
      explanation: model.report.riskAssessment.shortReason,
    };
  }
  return {
    status: 'unavailable',
    title: 'Score unavailable',
    explanation: 'A scoring result was not returned for this review.',
  };
}

export function hasShortStayContext(model: ReportPresentation) {
  // Presentation hint only, never a new finding or an inferred price basis.
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
  };
  return model.sources.some((source) => {
    const text = source.extractedText ?? '';
    if (/\bnightly\b|\bshort[- ](?:term stay|stay)\b/i.test(text)) return true;
    return [
      ...text.matchAll(
        /\b(\d+|one|two|three|four|five|six|seven)[ -]nights?\b/gi,
      ),
    ].some((match) => {
      const nights = words[match[1].toLowerCase()] ?? Number(match[1]);
      return nights > 0 && nights < 30;
    });
  });
}
export function displayFact(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}
export function keySourceFacts(model: ReportPresentation, sourceId: string) {
  const facts = model.facts.filter((f) => f.sourceId === sourceId);
  const preferred = [
    'propertyType',
    'location',
    'bedroomCount',
    'bathroomCount',
    'address',
  ];
  const result = preferred.flatMap((field) => {
    const fact = facts.find((f) => f.fieldName === field);
    return fact && displayFact(fact.normalizedValue) !== null ? [fact] : [];
  });
  // Existing monthly concepts are not reinterpreted as nightly/booking prices.
  if (!hasShortStayContext(model)) {
    for (const field of ['monthlyRent', 'depositAmount']) {
      const fact = facts.find((f) => f.fieldName === field);
      if (fact && displayFact(fact.normalizedValue) !== null) result.push(fact);
    }
  }
  return result.slice(0, 6);
}
export function topRecommendations(model: ReportPresentation) {
  const hasPaymentMessages = model.sources.some((source) =>
    [
      'conversation_text',
      'conversation_screenshot',
      'payment_information',
    ].includes(source.type),
  );
  const originalIsAirbnb = model.sources.some((source) => {
    if (source.type !== 'listing_url') return false;
    try {
      return /(^|\.)airbnb\.[a-z.]+$/i.test(
        new URL(source.originalUrl ?? '').hostname,
      );
    } catch {
      return false;
    }
  });
  if (hasShortStayContext(model) && originalIsAirbnb && !hasPaymentMessages)
    return [
      "Keep payment within Airbnb's official booking platform.",
      'Confirm the total booking price and cancellation policy in Airbnb.',
      'Investigate any request for payment outside Airbnb before proceeding.',
    ];
  const seen = new Set<string>();
  return model.recommendations
    .filter((text) => {
      const key = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      const words = new Set(key.split(' ').filter((w) => w.length > 3));
      const similar = [...seen].some((prior) => {
        const other = new Set(prior.split(' ').filter((w) => w.length > 3));
        const intersection = [...words].filter((word) =>
          other.has(word),
        ).length;
        return (
          key === prior ||
          intersection / Math.max(1, new Set([...words, ...other]).size) > 0.65
        );
      });
      if (similar) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

import { createHash } from 'node:crypto';
import {
  PriceRecordSchema,
  AnalysisRequestSchema,
  type EvidenceSource,
  type ExtractedFact,
} from '@sniffo/shared';
import { extractFacts } from './extraction.js';
import { verifyEvidenceSource } from './sourceSignature.js';
import type { z } from 'zod';

type AnalysisInput = z.infer<typeof AnalysisRequestSchema>;
export type ValidationDiagnostic = {
  factId: string;
  code: string;
  message: string;
};
export const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/gu, ' ').trim();
export const quoteExists = (text: string, quote: string) =>
  Boolean(quote.trim()) &&
  normalizeWhitespace(text).includes(normalizeWhitespace(quote));
export function stableId(...parts: unknown[]) {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
}
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, sort(v)]),
          )
        : value;
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}
export class EvidenceValidationError extends Error {
  status = 400;
  code = 'INVALID_EVIDENCE';
  constructor(
    public diagnostics: Array<{
      code: string;
      message: string;
      sourceId?: string;
    }>,
  ) {
    super(
      'Evidence source validation failed. Re-extract the source and try again.',
    );
  }
}
export function validateAnalysisEvidence(raw: AnalysisInput): {
  sources: EvidenceSource[];
  facts: ExtractedFact[];
  diagnostics: ValidationDiagnostic[];
} {
  const input = AnalysisRequestSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(input)) > 1_000_000)
    throw new EvidenceValidationError([
      { code: 'EVIDENCE_LIMIT', message: 'Analysis evidence exceeds 1 MB.' },
    ]);
  const ids = new Set<string>();
  const errors: EvidenceValidationError['diagnostics'] = [];
  for (const source of input.sources) {
    if (ids.has(source.id))
      errors.push({
        code: 'DUPLICATE_SOURCE_ID',
        message: 'Source IDs must be unique.',
        sourceId: source.id,
      });
    ids.add(source.id);
    if (!verifyEvidenceSource(source))
      errors.push({
        code: 'SOURCE_INTEGRITY_INVALID',
        message:
          'Source was changed or was not issued by this API. Re-extract it.',
        sourceId: source.id,
      });
  }
  if (errors.length) throw new EvidenceValidationError(errors);
  const diagnostics: ValidationDiagnostic[] = [];
  const authoritative = new Map<string, ExtractedFact[]>();
  let claimCount = 0;
  for (const source of input.sources) {
    const candidates =
      source.extractionStatus === 'complete'
        ? (source.normalizedFacts ??
          (source.extractedText
            ? extractFacts(
                source.extractedText,
                source.id,
                source.type === 'listing_url'
                  ? source.name
                  : source.type.startsWith('listing') &&
                      !/correction|manually entered/i.test(source.name)
                    ? (source.extractedText
                        .match(/^([^\n.!?]{5,100})/)?.[1]
                        ?.trim() ?? null)
                    : null,
              )
            : []))
        : [];
    const accepted: ExtractedFact[] = [];
    for (const candidate of candidates) {
      if (
        candidate.fieldName === 'price' &&
        !PriceRecordSchema.safeParse(candidate.normalizedValue).success
      ) {
        diagnostics.push({
          factId: candidate.id,
          code: 'INVALID_PRICE',
          message: 'Malformed source price was excluded.',
        });
        continue;
      }
      const structured =
        candidate.provenance &&
        ['embedded_json', 'json_ld', 'metadata'].includes(
          candidate.provenance.sourceType,
        ) &&
        candidate.provenance.sourceReference.trim();
      if (
        candidate.sourceId !== source.id ||
        (!structured &&
          !quoteExists(source.extractedText ?? '', candidate.quotedEvidence))
      ) {
        diagnostics.push({
          factId: candidate.id,
          code: 'INVALID_SOURCE_FACT',
          message:
            'Issued fact lacks a matching source quotation or structured reference.',
        });
        continue;
      }
      if (++claimCount > 1000)
        throw new EvidenceValidationError([
          {
            code: 'CLAIM_LIMIT',
            message: 'At most 1000 extracted facts may be analyzed.',
          },
        ]);
      accepted.push({
        ...candidate,
        id: source.normalizedFacts
          ? candidate.id
          : `fact-${stableId(source.id, candidate.fieldName, candidate.normalizedValue, candidate.quotedEvidence)}`,
      });
    }
    authoritative.set(source.id, accepted);
  }
  const seen = new Set<string>();
  for (const fact of input.facts) {
    const source = input.sources.find((s) => s.id === fact.sourceId);
    const candidates = authoritative.get(fact.sourceId) ?? [];
    const corroborates = candidates.some(
      (c) =>
        c.fieldName === fact.fieldName &&
        sameValue(c.normalizedValue, fact.normalizedValue) &&
        (quoteExists(c.quotedEvidence, fact.quotedEvidence) ||
          quoteExists(fact.quotedEvidence, c.quotedEvidence)),
    );
    let code: string | undefined;
    if (!source) code = 'UNKNOWN_SOURCE';
    else if (seen.has(fact.id)) code = 'DUPLICATE_FACT_ID';
    else if (
      !quoteExists(source.extractedText ?? '', fact.quotedEvidence) &&
      !corroborates
    )
      code = 'QUOTE_NOT_IN_SOURCE';
    else if (!corroborates) code = 'FACT_NOT_CORROBORATED';
    seen.add(fact.id);
    if (code)
      diagnostics.push({
        factId: fact.id,
        code,
        message:
          'Client fact excluded; only source-backed server claims drive analysis.',
      });
  }
  return {
    sources: input.sources,
    facts: [...authoritative.values()].flat(),
    diagnostics,
  };
}

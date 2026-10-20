import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EvidenceSource } from '@sniffo/shared';
import { env } from '../config/env.js';

const signingKey =
  env.EVIDENCE_SIGNING_SECRET || randomBytes(32).toString('hex');
function payload(source: EvidenceSource): string {
  return JSON.stringify(
    [
      source.id,
      source.type,
      source.name,
      source.originalUrl,
      source.extractedText,
      source.extractionStatus,
      ...(source.publicListing
        ? [{ publicListing: source.publicListing }]
        : []),
      ...(source.retrievedAt ? [{ retrievedAt: source.retrievedAt }] : []),
      ...(source.extractionMethod
        ? [{ extractionMethod: source.extractionMethod }]
        : []),
      ...(source.language ? [{ language: source.language }] : []),
      ...(source.extractionWarnings
        ? [{ extractionWarnings: source.extractionWarnings }]
        : []),
      ...(source.normalizedFacts ? [source.normalizedFacts] : []),
      ...(source.evidenceKind ? [{ evidenceKind: source.evidenceKind }] : []),
      ...(source.fileProvenance
        ? [{ fileProvenance: source.fileProvenance }]
        : []),
    ],
    (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : value,
  );
}
function digest(source: EvidenceSource): Buffer {
  return createHmac('sha256', signingKey).update(payload(source)).digest();
}
export function sealEvidenceSource(source: EvidenceSource): EvidenceSource {
  return { ...source, integrityToken: digest(source).toString('base64url') };
}
export function verifyEvidenceSource(source: EvidenceSource): boolean {
  if (
    !source.integrityToken ||
    !/^[A-Za-z0-9_-]{43}$/.test(source.integrityToken)
  )
    return false;
  try {
    const supplied = Buffer.from(source.integrityToken, 'base64url');
    const expected = digest(source);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  } catch {
    return false;
  }
}

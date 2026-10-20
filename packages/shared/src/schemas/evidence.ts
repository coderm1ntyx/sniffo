import { z } from 'zod';

// Bound untyped extractor payloads before recursive serialization or signing.
const BoundedValueSchema = z.unknown().superRefine((value, context) => {
  const pending = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++visited > 10000 || item.depth > 16) {
      context.addIssue({
        code: 'custom',
        message: 'Structured fact exceeds size or depth limits.',
      });
      return;
    }
    if (
      (typeof item.value === 'string' && item.value.length > 100000) ||
      (typeof item.value === 'number' && !Number.isFinite(item.value))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid structured fact value.',
      });
      return;
    }
    if (item.value && typeof item.value === 'object')
      for (const child of Object.values(item.value))
        pending.push({ value: child, depth: item.depth + 1 });
  }
});

export const EvidenceSourceTypeSchema = z.enum([
  'listing_url',
  'listing_text',
  'listing_screenshot',
  'conversation_text',
  'conversation_screenshot',
  'rental_agreement_pdf',
  'rental_agreement_image',
  'listing_pdf',
  'payment_information',
]);
export const ExtractionStatusSchema = z.enum([
  'pending',
  'complete',
  'failed',
  'not_started',
  'unavailable',
]);
export const ExtractedFactSchema = z.object({
  id: z.string().trim().min(1).max(160),
  sourceId: z.string().trim().min(1).max(160),
  fieldName: z.string().trim().min(1).max(100),
  normalizedValue: BoundedValueSchema.nullable(),
  quotedEvidence: z.string().min(1).max(100_000),
  pageNumber: z.number().int().positive().optional(),
  textLocation: z.string().optional(),
  provenance: z
    .object({
      sourceType: z.enum([
        'embedded_json',
        'json_ld',
        'metadata',
        'visible_html',
        'url',
      ]),
      sourceReference: z.string(),
      rawValue: BoundedValueSchema,
      explicit: z.boolean(),
      quality: z.enum(['listing_specific', 'page_fallback']),
    })
    .optional(),
  extractionMethod: z.enum(['text', 'json_ld', 'metadata']).optional(),
});
export const EvidenceSourceSchema = z.object({
  publicListing: z
    .object({
      canonicalUrl: z.string().url().nullable(),
      listingId: z.string().nullable(),
      images: z.array(z.string().url()).max(12),
      retrievedAt: z.string(),
      fieldComparisonOnly: z.boolean().optional(),
    })
    .optional(),
  id: z.string().trim().min(1).max(160),
  type: EvidenceSourceTypeSchema,
  name: z.string().min(1).max(200),
  originalUrl: z.string().url().nullable(),
  extractedText: z.string().max(100_000).nullable(),
  extractionStatus: ExtractionStatusSchema,
  retrievedAt: z.string().max(40).optional(),
  extractionMethod: z
    .enum(['text', 'pdf_text', 'ai_vision', 'ai_document'])
    .optional(),
  language: z.string().trim().min(1).max(40).optional(),
  extractionWarnings: z
    .array(z.string().trim().min(1).max(240))
    .max(10)
    .optional(),
  normalizedFacts: z.array(ExtractedFactSchema).max(1000).optional(),
  evidenceKind: z
    .enum(['server_extracted', 'user_source', 'user_assertion'])
    .optional(),
  fileProvenance: z
    .object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      method: z.enum(['pdf_text', 'ai']),
    })
    .optional(),
  integrityToken: z.string().min(20).optional(),
  failureCode: z.string().optional(),
  failureMessage: z.string().optional(),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

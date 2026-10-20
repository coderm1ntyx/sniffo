import { z } from 'zod';
import { EvidenceSourceSchema, ExtractedFactSchema } from './evidence.js';
import { FindingSchema } from './findings.js';
import { PriceRecordSchema, PropertyFactsSchema } from './property.js';
import { ResearchResultSchema } from './research.js';

export const HealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal('ok'), service: z.literal('sniffo-api') }),
});
export const UrlExtractionRequestSchema = z.object({ url: z.string().url() });
export const TextExtractionRequestSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => value.trim().length > 0, 'Text cannot be blank.'),
  type: z
    .enum(['listing_text', 'conversation_text', 'payment_information'])
    .default('listing_text'),
  name: z.string().trim().min(1).max(120).optional(),
  evidenceKind: z.enum(['user_source', 'user_assertion']).optional(),
});
export const ExtractionResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    source: EvidenceSourceSchema,
    facts: z.array(ExtractedFactSchema),
    listingImage: z
      .object({
        url: z.string().url(),
        source: z.enum([
          'og:image',
          'twitter:image',
          'json_ld',
          'airbnb_public_data',
        ]),
        extractionMethod: z.enum(['metadata', 'json_ld', 'embedded_json']),
      })
      .optional(),
    listingTitle: z.string().nullable().optional(),
    fallbackTitle: z.string().nullable().optional(),
    titleIsFallback: z.boolean().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    listingId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    descriptionIsFallback: z.boolean().optional(),
    descriptionSource: z
      .enum([
        'airbnb_public_data',
        'json_ld',
        'visible_section',
        'meta_description',
      ])
      .nullable()
      .optional(),
    imageUrl: z.string().url().nullable().optional(),
    images: z.array(z.string().url()).optional(),
    hostName: z.string().nullable().optional(),
    guestCapacity: z.number().nonnegative().nullable().optional(),
    amenities: z.array(z.string()).optional(),
    houseRules: z.array(z.string()).optional(),
    accommodationType: z.string().nullable().optional(),
    bookingType: z.string().nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
    priceBasis: z
      .enum([
        'monthly_rent',
        'nightly_rate',
        'weekly_rate',
        'stay_total',
        'deposit',
        'cleaning_fee',
        'service_fee',
        'other_fee',
        'unknown',
      ])
      .nullable()
      .optional(),
    descriptionTruncated: z.boolean().optional(),
    descriptionOriginalLength: z.number().int().nonnegative().optional(),
    prices: z.array(PriceRecordSchema).optional(),
    priceStatus: z
      .enum([
        'extracted',
        'not_in_response',
        'ambiguous',
        'source_restricted',
        'extraction_failed',
      ])
      .optional(),
    bookingContext: z
      .object({
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        nights: z.number().int().positive().optional(),
        adults: z.number().int().nonnegative().optional(),
        children: z.number().int().nonnegative().optional(),
        infants: z.number().int().nonnegative().optional(),
        pets: z.number().int().nonnegative().optional(),
        guestCount: z.number().int().nonnegative().optional(),
        totalGuests: z.number().int().nonnegative().optional(),
        currency: z.string().length(3).optional(),
        locale: z.string().trim().min(2).max(20).optional(),
      })
      .optional(),
    conflicts: z
      .array(
        z.object({
          field: z.string(),
          values: z.array(z.unknown()),
          resolution: z.string(),
        }),
      )
      .optional(),
    extractionWarnings: z.array(z.string()).optional(),
    extractionDurationMs: z.number().nonnegative().optional(),
  }),
});
export const AudioNarrationSchema = z.object({
  transcript: z.string().min(1).max(400),
  token: z.string().min(1).max(2048).nullable(),
  available: z.boolean(),
});
export type AudioNarration = z.infer<typeof AudioNarrationSchema>;
export const AnalysisRequestSchema = z.object({
  deepResearch: z.boolean().optional(),
  sources: z.array(EvidenceSourceSchema).min(1).max(20),
  facts: z.array(ExtractedFactSchema).max(2000).default([]),
});
export const RedFlagScoreSchema = z
  .object({
    modelVersion: z.literal('phase2-v1'),
    interpretation: z.literal('concern_index'),
    status: z.enum(['scored', 'insufficient_evidence']),
    valueOutOf10: z.number().min(0).max(10).nullable(),
    explanation: z.string(),
    breakdown: z.array(
      z.object({
        ruleId: z.string(),
        findingId: z.string(),
        base: z.number(),
        contribution: z.number(),
        issueGroup: z.string(),
      }),
    ),
  })
  .superRefine((score, context) => {
    if ((score.status === 'scored') !== (score.valueOutOf10 !== null))
      context.addIssue({
        code: 'custom',
        message: 'Score value must agree with eligibility.',
      });
    const total =
      Math.round(
        score.breakdown.reduce((sum, item) => sum + item.contribution, 0) * 10,
      ) / 10;
    if (score.status === 'scored' && total !== score.valueOutOf10)
      context.addIssue({
        code: 'custom',
        message: 'Score breakdown must match total.',
      });
    if (
      score.breakdown.some(
        (item) =>
          (item.ruleId === 'R12' && item.contribution !== 0) ||
          item.contribution < 0 ||
          item.contribution > item.base,
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid rule contribution.',
      });
  });
export const AnalysisResultSchema = z.object({
  audioNarration: AudioNarrationSchema.optional(),
  research: ResearchResultSchema.optional(),
  redFlagScore: RedFlagScoreSchema.optional(),
  sourceFacts: z.array(ExtractedFactSchema).max(1000).optional(),
  summary: z.string(),
  riskAssessment: z
    .object({
      score: z.number().int().min(0).max(100),
      level: z.enum(['low', 'moderate', 'elevated', 'high']),
      shortReason: z.string(),
      reasonsFor: z.array(z.string()),
      reasonsAgainst: z.array(z.string()),
      limitations: z.array(z.string()),
    })
    .optional(),
  coverage: z
    .object({
      claims: z.array(
        z.object({
          field: z.string(),
          label: z.string(),
          status: z.enum(['found', 'corroborated', 'conflict', 'not_found']),
          value: z.string().nullable(),
          sourceNames: z.array(z.string()),
        }),
      ),
    })
    .optional(),
  propertyFacts: PropertyFactsSchema,
  findings: z.array(FindingSchema),
  evidenceDiagnostics: z
    .array(
      z.object({ factId: z.string(), code: z.string(), message: z.string() }),
    )
    .optional(),
  recommendations: z.array(z.string()),
});
export const AnalysisResponseSchema = z.object({
  success: z.literal(true),
  data: AnalysisResultSchema,
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export const TtsReportRequestSchema = z
  .object({ reportToken: z.string().min(1).max(2048) })
  .strict();
export const ExtractionErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

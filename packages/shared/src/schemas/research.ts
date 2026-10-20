import { z } from 'zod';
import { EvidenceSourceSchema } from './evidence.js';

export const ResearchStageSchema = z.enum([
  'checking',
  'searching',
  'comparing',
  'photos',
  'preparing',
]);
export type ResearchStage = z.infer<typeof ResearchStageSchema>;
export const VisualComparisonSchema = z
  .object({
    comparisonStatus: z.enum([
      'same_space',
      'similar_interior',
      'different_spaces',
      'indeterminate',
    ]),
    sharedFeatures: z.array(z.string().max(300)).max(8),
    differences: z.array(z.string().max(300)).max(8),
    distinctiveEvidence: z.array(z.string().max(300)).max(8),
    limitations: z.array(z.string().max(300)).min(1).max(8),
  })
  .strict();
export type VisualComparison = z.infer<typeof VisualComparisonSchema>;
export const ResearchResultSchema = z.object({
  countsKnown: z.boolean().optional(),
  enabled: z.literal(true),
  searchProvider: z.string().max(80).optional(),
  searchQueries: z
    .array(
      z.object({
        query: z.string().max(500),
        provider: z.string().max(80),
        status: z.enum(['planned', 'attempted', 'failed']),
        candidatesReturned: z.number().int().nonnegative(),
        referencesReturned: z.number().int().nonnegative().optional(),
        error: z.string().max(120).optional(),
      }),
    )
    .max(3)
    .optional(),
  searchUsage: z
    .object({
      model: z.string().max(80),
      tool: z.literal('web_search'),
      latencyMs: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      estimatedCostUsd: z.number().nonnegative().optional(),
      cacheHit: z.boolean().optional(),
    })
    .optional(),
  searchResults: z
    .array(
      z.object({
        url: z.string().url(),
        domain: z.string().max(253),
        title: z.string().max(200),
        snippet: z.string().max(500),
        query: z.string().max(500),
        status: z.enum([
          'queued',
          'reviewed',
          'rejected',
          'fetch_failed',
          'timed_out',
          'not_reviewed',
        ]),
        rejectionReason: z.string().max(180).optional(),
        classification: z
          .enum([
            'original_listing',
            'possible_same_unit',
            'same_building_different_unit',
            'unrelated_listing',
            'unverifiable',
          ])
          .optional(),
        identity: z
          .enum([
            'exact_listing',
            'likely_same_property',
            'same_building_or_development',
            'possible_match',
            'unrelated',
            'insufficient_evidence',
          ])
          .optional(),
      }),
    )
    .max(10)
    .optional(),
  status: z.enum([
    'completed',
    'partial',
    'unavailable',
    'search_unavailable',
    'provider_error',
    'rate_limited',
    'timed_out',
    'cancelled',
    'skipped',
  ]),
  queriesAttempted: z.number().int().nonnegative(),
  candidatesDiscovered: z.number().int().nonnegative(),
  candidatesReviewed: z.number().int().nonnegative(),
  matchingCandidates: z.number().int().nonnegative().optional(),
  independentSources: z.number().int().nonnegative(),
  summary: z.string(),
  sourceSummaries: z
    .array(
      z.object({
        id: z.string(),
        url: z.string().url(),
        domain: z.string(),
        title: z.string(),
        discoveryMethod: z.enum(['direct', 'canonical', 'search']),
        provider: z.string(),
        retrievedAt: z.string(),
        availability: z.enum(['readable', 'inaccessible']),
        extractionMethod: z.literal('public_html'),
        contentDigest: z.string().nullable(),
        identity: z.enum([
          'exact_listing',
          'likely_same_property',
          'same_building_or_development',
          'possible_match',
          'unrelated',
          'insufficient_evidence',
        ]),
        identityReasons: z.array(z.string()),
        independence: z.enum([
          'original',
          'derived',
          'independent',
          'unverified',
        ]),
        excerpt: z.string().max(2000),
        searchMetadata: z
          .object({
            snippet: z.string(),
            query: z.string(),
            discoveredAt: z.string(),
          })
          .optional(),
        source: EvidenceSourceSchema.optional(),
      }),
    )
    .max(8),
  comparisons: z
    .array(
      z.object({
        field: z.string(),
        status: z.enum([
          'corroborated',
          'potential_inconsistency',
          'confirmed_inconsistency',
          'unable_to_verify',
          'not_comparable',
        ]),
        explanation: z.string(),
        sourceId: z.string(),
        candidateId: z.string(),
        sourceQuote: z.string(),
        candidateQuote: z.string(),
      }),
    )
    .max(100),
  visualAnalysis: z.object({
    status: z.enum(['completed', 'skipped', 'unavailable']),
    reason: z.string(),
    cached: z.boolean(),
    model: z.string().optional(),
    analysisTimestamp: z.string().optional(),
    result: VisualComparisonSchema.optional(),
    sourceImageReferences: z.array(z.string().url()).max(2),
    candidateImageReferences: z.array(z.string().url()).max(2),
    sourceThumbnails: z
      .array(
        z
          .string()
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
          .max(500000),
      )
      .max(2)
      .optional(),
    candidateThumbnails: z
      .array(
        z
          .string()
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
          .max(500000),
      )
      .max(2)
      .optional(),
  }),
  evidenceSources: z.array(EvidenceSourceSchema).max(5),
  limitations: z.array(z.string()),
  elapsedMs: z.number().nonnegative(),
  stages: z.array(ResearchStageSchema),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

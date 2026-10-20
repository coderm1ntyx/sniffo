import { z } from 'zod';

export const FindingCategorySchema = z.enum([
  'confirmed_inconsistency',
  'potential_warning_sign',
  'unable_to_verify',
]);
export const FindingSeveritySchema = z.enum([
  'info',
  'informational',
  'low',
  'medium',
  'high',
  'critical',
]);
export const FindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z
    .enum([
      'R01',
      'R02',
      'R03',
      'R04',
      'R05',
      'R06',
      'R07',
      'R08',
      'R09',
      'R12',
    ])
    .optional(),
  affectedField: z.string().optional(),
  issueGroup: z.string().optional(),
  scoreContribution: z.number().min(0).max(10).optional(),
  evidence: z
    .array(
      z.object({
        sourceId: z.string(),
        factId: z.string().optional(),
        quote: z.string().optional(),
        structuredPath: z.string().optional(),
        claimId: z.string().optional(),
      }),
    )
    .optional(),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  referencedEvidence: z.array(z.string()),
  referencedFactIds: z.array(z.string()).optional(),
  recommendedAction: z.string().min(1),
});
export type Finding = z.infer<typeof FindingSchema>;

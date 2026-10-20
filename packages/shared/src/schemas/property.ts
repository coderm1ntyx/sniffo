import { z } from 'zod';

export const PriceRecordSchema = z.object({
  amount: z
    .number()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER / 100),
  currency: z.string().length(3).nullable(),
  rawCurrency: z.string().nullable(),
  rawText: z.string(),
  basis: z.enum([
    'monthly_rent',
    'nightly_rate',
    'weekly_rate',
    'stay_total',
    'deposit',
    'cleaning_fee',
    'service_fee',
    'other_fee',
    'unknown',
  ]),
  basisExplicit: z.boolean(),
  role: z.enum(['current', 'original', 'fee', 'ambiguous']).optional(),
  discountPresent: z.boolean().optional(),
  includesFees: z.boolean().nullable().optional(),
  nights: z.number().int().positive().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guestCount: z.number().int().positive().optional(),
  unitId: z.string().optional(),
  roomVariant: z.string().optional(),
  feeType: z.string().optional(),
  mandatory: z.boolean().optional(),
  recurring: z.enum(['one_time', 'monthly', 'weekly', 'nightly']).optional(),
  estimate: z.boolean().optional(),
});
export type PriceRecord = z.infer<typeof PriceRecordSchema>;

export const PropertyFactsSchema = z.object({
  prices: z.array(PriceRecordSchema).optional(),
  listingTitle: z.string().nullable(),
  propertyType: z.string().nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  monthlyRent: z.number().nonnegative().nullable(),
  monthlyRentRange: z
    .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
    .nullable()
    .optional(),
  currency: z.string().length(3).nullable(),
  depositAmount: z.number().nonnegative().nullable(),
  bedroomCount: z.number().int().nonnegative().nullable(),
  bathroomCount: z.number().nonnegative().nullable(),
  listingUrl: z.string().url().nullable(),
});
export type PropertyFacts = z.infer<typeof PropertyFactsSchema>;

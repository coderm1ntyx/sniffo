import { Router } from 'express';
import { z } from 'zod';
import { onlineChecks } from '../services/ai.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
const router = Router();
const RequestSchema = z
  .object({
    imageBase64: z.string().max(8_000_000).optional(),
    landlordClaim: z.string().trim().min(5).max(400).optional(),
    listingText: z.string().trim().min(30).max(1200).optional(),
  })
  .refine(
    (value) => value.imageBase64 || value.landlordClaim || value.listingText,
    'Choose an image, provide listing text, or provide a public landlord/business claim.',
  );
router.post(
  '/',
  createRateLimiter({ windowMs: 60_000, max: 5 }),
  async (req, res, next) => {
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    try {
      return res.json({
        success: true,
        data: await onlineChecks({
          image: parsed.data.imageBase64,
          landlordClaim: parsed.data.landlordClaim,
          listingText: parsed.data.listingText,
        }),
      });
    } catch (error) {
      return next(error);
    }
  },
);
export default router;

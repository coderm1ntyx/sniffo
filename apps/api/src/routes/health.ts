import { Router } from 'express';
import { HealthResponseSchema } from '@sniffo/shared';
const router = Router();
router.get('/', (_req, res) =>
  res.json(
    HealthResponseSchema.parse({
      success: true,
      data: { status: 'ok', service: 'sniffo-api' },
    }),
  ),
);
export default router;

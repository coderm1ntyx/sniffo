import { Router } from 'express';
import { TtsReportRequestSchema } from '@sniffo/shared';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getSpeechConfig } from '../services/tts/config.js';
import { verifyNarrationToken } from '../services/tts/narration.js';
import {
  createSpeechGenerator,
  isSpeechConfigured,
  SpeechFailure,
  type SpeechConfig,
} from '../services/tts/speech.js';

export function createTtsRouter(
  dependencies: {
    config?: SpeechConfig;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const router = Router();
  const config = dependencies.config ?? getSpeechConfig();
  const now = dependencies.now ?? Date.now;
  const generator = createSpeechGenerator(config, {
    fetchImpl: dependencies.fetchImpl,
    now,
  });

  router.post(
    '/report',
    createRateLimiter({ windowMs: 60_000, max: 3, now }),
    async (req, res) => {
      const parsed = TtsReportRequestSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          success: false,
          error: {
            code: 'TTS_INVALID_REPORT',
            message: 'This report cannot be used to prepare audio.',
          },
        });
      if (!isSpeechConfigured(config))
        return res.status(503).json({
          success: false,
          error: {
            code: 'TTS_UNAVAILABLE',
            message:
              'Report audio is not configured yet. You can still read the summary below.',
          },
        });
      const transcript = config.signingSecret
        ? verifyNarrationToken(
            parsed.data.reportToken,
            config.signingSecret,
            now(),
          )
        : null;
      if (!transcript)
        return res.status(400).json({
          success: false,
          error: {
            code: 'TTS_INVALID_REPORT',
            message:
              'This report audio link is invalid or has expired. Run the verification again to refresh it.',
          },
        });
      try {
        const audio = await generator.generate(transcript);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', String(audio.length));
        return res.status(200).send(audio);
      } catch (error) {
        if (error instanceof SpeechFailure)
          return res.status(error.status).json({
            success: false,
            error: { code: error.code, message: error.message },
          });
        return res.status(502).json({
          success: false,
          error: {
            code: 'TTS_TEMPORARY_FAILURE',
            message:
              'ElevenLabs could not prepare audio right now. Your written summary is still available.',
          },
        });
      }
    },
  );

  return router;
}

export default createTtsRouter();

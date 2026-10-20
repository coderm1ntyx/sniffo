import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  ResearchResultSchema,
} from '@sniffo/shared';
import { analyzeEvidence } from '../services/analysis.js';
import { evidenceKind } from '../services/verification/claims.js';
import { reviewMessageSources } from '../services/ai.js';
import {
  EvidenceValidationError,
  validateAnalysisEvidence,
} from '../services/evidenceIntegrity.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import {
  runResearch,
  unavailableResearch,
} from '../services/research/orchestrator.js';
import type { ResearchStage } from '@sniffo/shared';
import { env } from '../config/env.js';
import { getSpeechConfig } from '../services/tts/config.js';
import {
  buildReportNarration,
  issueNarrationToken,
} from '../services/tts/narration.js';
import { isSpeechConfigured } from '../services/tts/speech.js';

function addAudioNarration<T extends ReturnType<typeof analyzeEvidence>>(
  report: T,
) {
  const transcript = buildReportNarration(report);
  const available = isSpeechConfigured(getSpeechConfig());
  return {
    ...report,
    audioNarration: {
      transcript,
      token:
        available && env.EVIDENCE_SIGNING_SECRET
          ? issueNarrationToken(transcript, env.EVIDENCE_SIGNING_SECRET)
          : null,
      available,
    },
  };
}
export function createAnalysisRouter(
  dependencies: { research?: typeof runResearch } = {},
) {
  const router = Router();
  router.post(
    '/',
    createRateLimiter({ windowMs: 60_000, max: 20 }),
    async (req, res, next) => {
      const requestId = randomUUID();
      res.setHeader('x-request-id', requestId);
      const parsed = AnalysisRequestSchema.safeParse(req.body);
      if (!parsed.success) return next(parsed.error);
      try {
        // Optional external review receives only integrity-checked sources.
        if (req.query.useAI === 'true') validateAnalysisEvidence(parsed.data);
        const aiStart = performance.now();
        const aiReview =
          req.query.useAI === 'true'
            ? await reviewMessageSources(
                parsed.data.sources.filter(
                  (s) =>
                    evidenceKind(s) !== 'user_assertion' &&
                    s.extractionStatus === 'complete',
                ),
              )
            : { status: 'off' as const, concerns: [] };
        const aiDurationMs = performance.now() - aiStart;
        if (parsed.data.deepResearch) validateAnalysisEvidence(parsed.data);
        const streaming =
          parsed.data.deepResearch === true &&
          req.headers.accept === 'application/x-ndjson';
        if (streaming) {
          res.type('application/x-ndjson');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
        }
        const progress = (stage: ResearchStage) => {
          if (streaming && !res.destroyed)
            res.write(JSON.stringify({ type: 'progress', stage }) + '\n');
        };
        if (parsed.data.deepResearch) progress('checking');
        let data = addAudioNarration(
          analyzeEvidence(
            parsed.data,
            aiReview.concerns,
            aiReview.status,
            (diagnostics) => {
              if (process.env.NODE_ENV !== 'production')
                console.info(
                  '[verification-analysis]',
                  JSON.stringify({ requestId, ...diagnostics, aiDurationMs }),
                );
            },
          ),
        );
        if (parsed.data.deepResearch) {
          if (streaming)
            res.write(
              JSON.stringify({
                type: 'standard',
                response: { success: true, data },
              }) + '\n',
            );
          let research;
          try {
            const validated = validateAnalysisEvidence(parsed.data);
            const researchController = new AbortController();
            res.once('close', () => researchController.abort());
            research = await (dependencies.research ?? runResearch)(
              validated.sources,
              validated.facts,
              progress,
              { signal: researchController.signal },
            );
            const checkedResearch = ResearchResultSchema.safeParse(research);
            research = checkedResearch.success
              ? checkedResearch.data
              : unavailableResearch(
                  'Research returned an invalid evidence record; standard verification was preserved.',
                );
            if (research.evidenceSources.length) {
              try {
                data = addAudioNarration(
                  analyzeEvidence(
                    {
                      ...parsed.data,
                      sources: [
                        ...parsed.data.sources,
                        ...research.evidenceSources,
                      ],
                      facts: parsed.data.facts,
                    },
                    aiReview.concerns,
                    aiReview.status,
                  ),
                );
              } catch {
                research.limitations.push(
                  'Research claims could not be added to scoring; the standard report was preserved.',
                );
              }
            }
          } catch {
            research = unavailableResearch(
              'Public research was unavailable; the standard report was preserved.',
            );
          }
          progress('preparing');
          data = { ...data, research };
          if (data.riskAssessment)
            data.riskAssessment.limitations = [
              ...data.riskAssessment.limitations.filter(
                (l) => !l.startsWith('No external ownership'),
              ),
              ...research.limitations,
            ];
        }
        data = addAudioNarration(data);
        const response = AnalysisResponseSchema.parse({ success: true, data });
        if (streaming)
          return res.end(JSON.stringify({ type: 'result', response }) + '\n');
        return res.json(response);
      } catch (error) {
        if (error instanceof EvidenceValidationError)
          return res.status(400).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.diagnostics,
            },
          });
        return next(error);
      }
    },
  );
  return router;
}
export default createAnalysisRouter();

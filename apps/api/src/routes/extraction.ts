import express, { Router } from 'express';
import {
  ExtractionResponseSchema,
  TextExtractionRequestSchema,
  UrlExtractionRequestSchema,
} from '@sniffo/shared';
import {
  extractListingUrl,
  extractPastedText,
} from '../services/extraction.js';
import { extractListingFile } from '../services/ai.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { attachPublicListing } from '../services/research/publicSources.js';
const router = Router();
router.post(
  '/file',
  createRateLimiter({ windowMs: 60_000, max: 6 }),
  express.raw({ type: 'multipart/form-data', limit: '10mb' }),
  async (req, res, next) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : null;
    try {
      const boundary = req.headers['content-type']?.match(
        /boundary=(?:"([^"]+)"|([^;]+))/i,
      );
      if (!boundary || !raw?.length)
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_REQUIRED',
            message: 'Choose a PDF or PNG listing file.',
          },
        });
      const marker = Buffer.from(
        `--${(boundary[1] ?? boundary[2] ?? '').trim()}`,
      );
      const start = raw.indexOf(Buffer.from('\r\n\r\n'));
      const end = raw.lastIndexOf(Buffer.concat([Buffer.from('\r\n'), marker]));
      if (start < 0 || end <= start)
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_UPLOAD',
            message: 'The uploaded file could not be read.',
          },
        });
      const headers = raw.subarray(0, start).toString('utf8');
      const filename = headers.match(/filename="([^"]*)"/i)?.[1];
      const mimetype = headers
        .match(/content-type:\s*([^\r\n]+)/i)?.[1]
        ?.trim()
        .toLowerCase();
      if (!filename || !mimetype)
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_REQUIRED',
            message: 'Choose a PDF or PNG listing file.',
          },
        });
      const file = {
        buffer: raw.subarray(start + 4, end),
        mimetype,
        originalname: filename,
      };
      const documentType =
        req.query.documentType === 'rental_agreement'
          ? 'rental_agreement'
          : 'listing';
      const useAI = req.query.useAI === 'true';
      const data = await extractListingFile(file, documentType, useAI);
      return res.json(ExtractionResponseSchema.parse({ success: true, data }));
    } catch (error) {
      return next(error);
    } finally {
      raw?.fill(0);
    }
  },
);
router.post(
  '/url',
  createRateLimiter({ windowMs: 60_000, max: 15 }),
  async (req, res, next) => {
    const parsed = UrlExtractionRequestSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    const extractionController = new AbortController();
    const abortExtraction = () => extractionController.abort();
    req.once('aborted', abortExtraction);
    res.once('close', () => {
      if (!res.writableEnded) abortExtraction();
    });
    try {
      const data = await extractListingUrl(parsed.data.url, {
        signal: extractionController.signal,
      });
      if (process.env.NODE_ENV !== 'production') {
        const { timings, extractionDurationMs, facts } = data;
        console.info(
          '[listing-extraction]',
          JSON.stringify({
            durationMs: extractionDurationMs,
            ...timings,
            factCount: facts.length,
            fields: [...new Set(facts.map((fact) => fact.fieldName))],
            responseBytes: Buffer.byteLength(
              JSON.stringify({ facts, source: data.source }),
            ),
          }),
        );
      }
      return res.json(
        ExtractionResponseSchema.parse({
          success: true,
          data: attachPublicListing(data),
        }),
      );
    } catch (error) {
      return next(error);
    }
  },
);
router.post(
  '/text',
  createRateLimiter({ windowMs: 60_000, max: 30 }),
  (req, res, next) => {
    const parsed = TextExtractionRequestSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    const data = extractPastedText(
      parsed.data.text,
      parsed.data.type,
      parsed.data.name ?? 'Pasted evidence',
      parsed.data.evidenceKind,
    );
    return res.json(ExtractionResponseSchema.parse({ success: true, data }));
  },
);
export default router;

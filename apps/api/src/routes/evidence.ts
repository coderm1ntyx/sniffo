import express, { Router } from 'express';
import {
  ExtractionResponseSchema,
  TextExtractionRequestSchema,
} from '@sniffo/shared';
import { extractListingFile } from '../services/ai.js';
import { extractPastedText } from '../services/extraction.js';
import { sealEvidenceSource } from '../services/sourceSignature.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = Router();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
function error(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

function multipartParts(body: Buffer, boundary: string) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Array<{ headers: string; data: Buffer }> = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).toString() === '--') break;
    if (body.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0)
      throw error(
        400,
        'INVALID_UPLOAD',
        'The uploaded file could not be read.',
      );
    const next = body.indexOf(
      Buffer.concat([Buffer.from('\r\n'), delimiter]),
      headerEnd + 4,
    );
    if (next < 0)
      throw error(
        400,
        'INVALID_UPLOAD',
        'The uploaded file could not be read.',
      );
    parts.push({
      headers: body.subarray(cursor, headerEnd).toString('utf8'),
      data: body.subarray(headerEnd + 4, next),
    });
    cursor = next + 2;
  }
  return parts;
}

router.post(
  '/ingest',
  createRateLimiter({ windowMs: 60_000, max: 8 }),
  (req, res, next) => {
    if (req.is('application/json')) {
      const parsed = TextExtractionRequestSchema.safeParse(req.body);
      if (!parsed.success) return next(parsed.error);
      const data = extractPastedText(
        parsed.data.text,
        parsed.data.type,
        parsed.data.name ?? 'Pasted evidence',
        parsed.data.evidenceKind,
      );
      data.source = sealEvidenceSource({
        ...data.source,
        extractionMethod: 'text',
        extractionWarnings: [],
      });
      return res.json(ExtractionResponseSchema.parse({ success: true, data }));
    }
    if (!req.is('multipart/form-data'))
      return next(
        error(
          415,
          'UNSUPPORTED_CONTENT_TYPE',
          'Send UTF-8 text as JSON or upload one supported file as multipart form data.',
        ),
      );
    express.raw({ type: 'multipart/form-data', limit: MAX_UPLOAD_BYTES })(
      req,
      res,
      async (rawError) => {
        const raw = Buffer.isBuffer(req.body) ? req.body : null;
        try {
          if (rawError) return next(rawError);
          if (!raw?.length)
            throw error(400, 'FILE_REQUIRED', 'Choose an evidence file.');
          const boundary = req.headers['content-type']?.match(
            /boundary=(?:"([^"]+)"|([^;]+))/i,
          );
          const boundaryValue = (boundary?.[1] ?? boundary?.[2] ?? '').trim();
          if (!boundaryValue || boundaryValue.length > 200)
            throw error(
              400,
              'INVALID_UPLOAD',
              'The uploaded file could not be read.',
            );
          const parts = multipartParts(raw, boundaryValue);
          const files = parts.filter((part) =>
            /(?:^|;)\s*filename="[^"]*"/im.test(part.headers),
          );
          if (files.length !== 1)
            throw error(
              400,
              'FILE_REQUIRED',
              'Upload exactly one evidence file.',
            );
          const filePart = files[0]!;
          const filename = filePart.headers.match(/filename="([^"]*)"/i)?.[1];
          const mimetype = filePart.headers
            .match(/content-type:\s*([^\r\n]+)/i)?.[1]
            ?.trim()
            .toLowerCase();
          if (!filename || !mimetype || !filePart.data.length)
            throw error(
              400,
              'INVALID_UPLOAD',
              'The uploaded file could not be read.',
            );
          const fields = new Map<string, string>();
          for (const part of parts.filter(
            (candidate) => candidate !== filePart,
          )) {
            const fieldName = part.headers.match(/name="([^"]+)"/i)?.[1];
            if (fieldName && part.data.length <= 500)
              fields.set(fieldName, part.data.toString('utf8'));
          }
          const kind = fields.get('type');
          const documentType =
            kind === 'conversation_text' || kind === 'conversation_screenshot'
              ? 'conversation'
              : kind === 'rental_agreement_pdf' ||
                  kind === 'rental_agreement_image'
                ? 'rental_agreement'
                : 'listing';
          const data = await extractListingFile(
            {
              buffer: filePart.data,
              mimetype,
              originalname:
                [...filename]
                  .filter(
                    (char) =>
                      char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
                  )
                  .join('')
                  .slice(0, 120) || 'Evidence file',
            },
            documentType,
            true,
            true,
          );
          data.source = sealEvidenceSource({
            ...data.source,
            extractionWarnings: data.source.extractionWarnings ?? [],
          });
          return res.json(
            ExtractionResponseSchema.parse({ success: true, data }),
          );
        } catch (caught) {
          return next(caught);
        } finally {
          raw?.fill(0);
        }
      },
    );
  },
);

export default router;

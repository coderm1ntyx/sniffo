import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import app from '../src/app.js';
import { extractListingFile } from '../src/services/ai.js';
import { verifyEvidenceSource } from '../src/services/sourceSignature.js';
import {
  AnalysisResponseSchema,
  ExtractionResponseSchema,
} from '@sniffo/shared';

const listen = async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

function imageFixture(kind: 'png' | 'jpeg' | 'webp'): Buffer {
  if (kind === 'png') {
    const buffer = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(1, 16);
    buffer.writeUInt32BE(1, 20);
    return buffer;
  }
  if (kind === 'jpeg') {
    const buffer = Buffer.alloc(24);
    buffer.set([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
    ]);
    return buffer;
  }
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  return buffer;
}

test('evidence ingest preserves submitted text, signs provenance, and accepts it at analysis', async () => {
  const { server, origin } = await listen();
  try {
    const submitted = '\n  Please send the deposit by bank transfer today.  \n';
    const response = await fetch(`${origin}/api/evidence/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: submitted,
        type: 'conversation_text',
        name: 'Landlord chat',
      }),
    });
    assert.equal(response.status, 200);
    const ingested = ExtractionResponseSchema.parse(await response.json()).data;
    assert.equal(ingested.source.extractedText, submitted);
    assert.equal(ingested.source.extractionMethod, 'text');
    assert.equal(ingested.source.extractionStatus, 'complete');
    assert.equal(verifyEvidenceSource(ingested.source), true);
    const analysis = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sources: [ingested.source],
        facts: ingested.facts,
      }),
    });
    assert.equal(analysis.status, 200);
    assert.ok(AnalysisResponseSchema.parse(await analysis.json()).data);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('vision ingestion handles PNG, JPEG, and WebP with traceable AI transcription', async () => {
  for (const kind of ['png', 'jpeg', 'webp'] as const) {
    const mime = kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`;
    const result = await extractListingFile(
      {
        buffer: imageFixture(kind),
        mimetype: mime,
        originalname: `chat.${kind}`,
      },
      'conversation',
      true,
      true,
      {
        apiKey: 'test-key',
        fetcher: async (_input, init) => {
          assert.equal(
            (init?.headers as Record<string, string>).authorization,
            'Bearer test-key',
          );
          const request = JSON.parse(String(init?.body)) as { store: boolean };
          assert.equal(request.store, false);
          return new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                pages: [
                  { pageNumber: 1, text: 'Landlord: Send THB 5,000 today.' },
                ],
              }),
            }),
            { status: 200 },
          );
        },
      },
    );
    assert.equal(result.source.type, 'conversation_screenshot');
    assert.equal(result.source.extractionMethod, 'ai_vision');
    assert.equal(result.source.fileProvenance?.sha256.length, 64);
    assert.equal(result.source.extractionStatus, 'complete');
    assert.ok(result.source.extractionWarnings?.length);
    assert.ok(result.source.extractedText?.includes('Page 1'));
    assert.equal(verifyEvidenceSource(result.source), true);
    assert.ok(result.facts.every((fact) => fact.sourceId === result.source.id));
    assert.ok(result.facts.every((fact) => fact.pageNumber === 1));
    assert.ok(
      result.facts.every((fact) => fact.textLocation?.startsWith('line ')),
    );
  }
});

test('Vision timeouts return a controlled error without exposing request content', async () => {
  await assert.rejects(
    extractListingFile(
      {
        buffer: imageFixture('png'),
        mimetype: 'image/png',
        originalname: 'private-chat.png',
      },
      'conversation',
      true,
      true,
      {
        apiKey: 'test-key',
        fetcher: async () => {
          const timeout = new Error('private message contents');
          timeout.name = 'TimeoutError';
          throw timeout;
        },
      },
    ),
    (caught: unknown) => {
      assert.equal((caught as { code?: string }).code, 'AI_EXTRACTION_TIMEOUT');
      assert.equal(
        (caught as Error).message.includes('private message contents'),
        false,
      );
      return true;
    },
  );
});

test('unsupported vision configuration yields a signed unavailable source with no claims', async () => {
  const result = await extractListingFile(
    {
      buffer: imageFixture('png'),
      mimetype: 'image/png',
      originalname: 'unreadable.png',
    },
    'conversation',
    true,
    true,
    { apiKey: '' },
  );
  assert.equal(result.source.extractionStatus, 'unavailable');
  assert.equal(result.source.extractedText, null);
  assert.equal(result.facts.length, 0);
  assert.equal(verifyEvidenceSource(result.source), true);

  const unreadable = await extractListingFile(
    {
      buffer: imageFixture('png'),
      mimetype: 'image/png',
      originalname: 'unreadable.png',
    },
    'conversation',
    true,
    true,
    {
      apiKey: 'test-key',
      fetcher: async () =>
        new Response(
          JSON.stringify({ output_text: JSON.stringify({ pages: [] }) }),
          { status: 200 },
        ),
    },
  );
  assert.equal(unreadable.source.extractionStatus, 'unavailable');
  assert.equal(unreadable.source.extractedText, null);
  assert.equal(unreadable.facts.length, 0);
});

test('PDF text extraction preserves page references and malformed PDFs fail safely', async () => {
  const pdfParseEntry = createRequire(import.meta.url).resolve('pdf-parse');
  const textPdf = await extractListingFile(
    {
      buffer: await readFile(
        resolve(dirname(pdfParseEntry), 'test/data/04-valid.pdf'),
      ),
      mimetype: 'application/pdf',
      originalname: 'listing.pdf',
    },
    'listing',
    false,
    true,
  );
  assert.equal(textPdf.source.extractionStatus, 'complete');
  assert.equal(textPdf.source.extractionMethod, 'pdf_text');
  assert.ok(textPdf.source.extractedText?.includes('Page 1'));
  assert.ok(textPdf.facts.every((fact) => fact.sourceId === textPdf.source.id));

  await assert.rejects(
    extractListingFile(
      {
        buffer: Buffer.from('%PDF-not-valid'),
        mimetype: 'application/pdf',
        originalname: 'malformed.pdf',
      },
      'listing',
      false,
      true,
    ),
    { code: 'PDF_TEXT_READ_FAILED' },
  );
});

test('scanned PDFs use Vision and excessive PDF page counts are rejected', async () => {
  const scanned = await extractListingFile(
    {
      buffer: Buffer.from('%PDF-mock-scanned'),
      mimetype: 'application/pdf',
      originalname: 'scanned-agreement.pdf',
    },
    'rental_agreement',
    true,
    true,
    {
      apiKey: 'test-key',
      pdfParser: async () => ({ text: '', numpages: 1 }) as never,
      fetcher: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              pages: [{ pageNumber: 1, text: 'Monthly rent is THB 30,000.' }],
            }),
          }),
          { status: 200 },
        ),
    },
  );
  assert.equal(scanned.source.type, 'rental_agreement_pdf');
  assert.equal(scanned.source.extractionMethod, 'ai_document');
  assert.equal(scanned.source.extractedText?.includes('Page 1'), true);

  await assert.rejects(
    extractListingFile(
      {
        buffer: Buffer.from('%PDF-mock-many-pages'),
        mimetype: 'application/pdf',
        originalname: 'large.pdf',
      },
      'listing',
      false,
      true,
      { pdfParser: async () => ({ text: 'some text', numpages: 41 }) as never },
    ),
    { code: 'PDF_PAGE_LIMIT' },
  );
});

test('invalid signatures and oversized image dimensions are rejected', async () => {
  await assert.rejects(
    extractListingFile({
      buffer: Buffer.from('not a png'),
      mimetype: 'image/png',
      originalname: 'bad.png',
    }),
    { code: 'INVALID_FILE' },
  );
  const oversized = imageFixture('png');
  oversized.writeUInt32BE(12_001, 16);
  await assert.rejects(
    extractListingFile({
      buffer: oversized,
      mimetype: 'image/png',
      originalname: 'large.png',
    }),
    { code: 'IMAGE_DIMENSION_LIMIT' },
  );
});

test('ingest route rejects non-multipart uploads and preserves a safe no-credential path', async () => {
  const { server, origin } = await listen();
  try {
    const response = await fetch(`${origin}/api/evidence/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'secret evidence',
    });
    assert.equal(response.status, 415);
    assert.equal(
      JSON.stringify(await response.json()).includes('secret evidence'),
      false,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('multipart image upload returns analysis-ready evidence when Vision is unconfigured', async (context) => {
  if (process.env.OPENAI_API_KEY)
    return context.skip(
      'Avoid external provider calls when credentials are configured.',
    );
  const { server, origin } = await listen();
  try {
    const form = new FormData();
    form.set('type', 'conversation_screenshot');
    form.set(
      'file',
      new Blob([imageFixture('png')], { type: 'image/png' }),
      'chat.png',
    );
    const response = await fetch(`${origin}/api/evidence/ingest`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    const ingested = ExtractionResponseSchema.parse(await response.json()).data;
    assert.equal(ingested.source.extractionStatus, 'unavailable');
    const analysis = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sources: [ingested.source],
        facts: ingested.facts,
      }),
    });
    assert.equal(analysis.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

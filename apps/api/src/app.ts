import express from 'express';
import { networkInterfaces } from 'node:os';
import cors from 'cors';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import extractionRouter from './routes/extraction.js';
import analysisRouter from './routes/analysis.js';
import onlineChecksRouter from './routes/onlineChecks.js';
import evidenceRouter from './routes/evidence.js';
import ttsRouter from './routes/tts.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const configuredOrigins = env.CORS_ORIGIN.split(',').map((origin) =>
  origin.trim(),
);
const lanOrigins =
  env.NODE_ENV === 'development'
    ? Object.values(networkInterfaces())
        .flatMap((interfaces) => interfaces ?? [])
        .filter((address) => address.family === 'IPv4' && !address.internal)
        .map((address) => `http://${address.address}:5173`)
    : [];
const allowedOrigins = new Set([...configuredOrigins, ...lanOrigins]);
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || allowedOrigins.has(origin)),
  }),
);
app.use('/api/analyze', express.json({ limit: '1mb' }));
app.use('/api/tts', express.json({ limit: '8kb' }), ttsRouter);
app.use('/api/evidence/ingest', express.json({ limit: '32kb' }));
app.use(express.json({ limit: '11mb' }));
app.use('/api/health', healthRouter);
app.use('/api/extract', extractionRouter);
app.use('/api/evidence', evidenceRouter);
app.use('/api/online-checks', onlineChecksRouter);
app.use('/api/analyze', analysisRouter);
app.use(notFound);
app.use(errorHandler);
export default app;

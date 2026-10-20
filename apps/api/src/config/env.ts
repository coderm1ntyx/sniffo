import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DEEP_RESEARCH_ENABLED: z.enum(['true', 'false']).default('false'),
  DEEP_RESEARCH_SEARCH_PROVIDER: z
    .enum(['none', 'searxng', 'openai'])
    .default('none'),
  DEEP_RESEARCH_OPENAI_WEB_SEARCH_ENABLED: z
    .enum(['true', 'false'])
    .default('false'),
  DEEP_RESEARCH_SEARCH_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  DEEP_RESEARCH_MAX_QUERIES: z.coerce.number().int().min(1).max(3).default(3),
  DEEP_RESEARCH_MAX_CANDIDATES: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .default(5),
  DEEP_RESEARCH_CANDIDATE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(8000)
    .default(4000),
  DEEP_RESEARCH_OPENAI_SEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(12000)
    .default(8000),
  DEEP_RESEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(20000),
  DEEP_RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(2),
  DEEP_RESEARCH_MAX_ACTIVE: z.coerce.number().int().min(1).max(10).default(3),
  DEEP_RESEARCH_VISION_ENABLED: z.enum(['true', 'false']).default('false'),
  DEEP_RESEARCH_VISION_MODEL: z.string().default('gpt-4.1-mini'),
  DEEP_RESEARCH_MAX_VISION_CALLS: z.coerce
    .number()
    .int()
    .min(0)
    .max(1)
    .default(1),
  DEEP_RESEARCH_MAX_ORIGINAL_IMAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(2)
    .default(2),
  DEEP_RESEARCH_MAX_CANDIDATE_IMAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(2)
    .default(2),
  DEEP_RESEARCH_VISION_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(128)
    .max(1000)
    .default(500),
  DEEP_RESEARCH_VISION_MAX_DIMENSION: z.coerce
    .number()
    .int()
    .min(256)
    .max(4096)
    .default(2048),
  DEEP_RESEARCH_VISION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(15000)
    .default(6000),
  DEEP_RESEARCH_LOCAL_VISION_BUDGET_USD: z.coerce
    .number()
    .min(0)
    .max(4)
    .default(1.5),
  DEEP_RESEARCH_VISION_RESERVATION_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.05),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  ELEVENLABS_TTS_ENABLED: z.enum(['true', 'false']).default('false'),
  ELEVENLABS_API_KEY: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).max(500).optional(),
  ),
  ELEVENLABS_VOICE_ID: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).max(128).optional(),
  ),
  ELEVENLABS_MODEL_ID: z
    .literal('eleven_flash_v2_5')
    .default('eleven_flash_v2_5'),
  ELEVENLABS_MAX_CHARS_PER_REQUEST: z.coerce
    .number()
    .int()
    .min(1)
    .max(400)
    .default(400),
  ELEVENLABS_APP_MONTHLY_CHAR_BUDGET: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(3000),
  ELEVENLABS_TTS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(12000)
    .default(12000),
  ELEVENLABS_MAX_AUDIO_BYTES: z.coerce
    .number()
    .int()
    .min(16384)
    .max(2_000_000)
    .default(1_000_000),
  GOOGLE_CLOUD_VISION_API_KEY: z.string().optional(),
  EVIDENCE_SIGNING_SECRET: z.string().min(32).optional(),
});
const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success)
  throw new Error(`Invalid environment: ${parsed.error.message}`);
if (
  parsed.data.NODE_ENV === 'production' &&
  !parsed.data.EVIDENCE_SIGNING_SECRET
)
  throw new Error(
    'EVIDENCE_SIGNING_SECRET must be configured with at least 32 characters in production.',
  );
export const env = parsed.data;

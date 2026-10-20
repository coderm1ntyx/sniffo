import { createHash } from 'node:crypto';

const OUTPUT_FORMAT = 'mp3_44100_128';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 24;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 4 * 1024;

export type SpeechConfig = {
  enabled: boolean;
  apiKey?: string;
  voiceId?: string;
  modelId: string;
  maxCharacters: number;
  monthlyCharacterBudget: number;
  timeoutMs: number;
  maxAudioBytes: number;
  signingSecret?: string;
};

export type SpeechFailureCode =
  | 'TTS_UNAVAILABLE'
  | 'TTS_BUDGET_EXHAUSTED'
  | 'TTS_RATE_LIMITED'
  | 'TTS_UPSTREAM_AUTH'
  | 'TTS_PROVIDER_QUOTA'
  | 'TTS_UPSTREAM_RATE_LIMIT'
  | 'TTS_TIMEOUT'
  | 'TTS_UPSTREAM_REJECTED'
  | 'TTS_TEMPORARY_FAILURE'
  | 'TTS_INVALID_AUDIO'
  | 'TTS_INVALID_REPORT';

export class SpeechFailure extends Error {
  constructor(
    readonly code: SpeechFailureCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type AudioEntry = { audio: Buffer; expiresAt: number };
type SpeechDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export function isSpeechConfigured(config: SpeechConfig): boolean {
  return Boolean(
    config.enabled &&
    config.apiKey &&
    config.voiceId &&
    config.modelId === 'eleven_flash_v2_5' &&
    config.signingSecret,
  );
}

export function createSpeechGenerator(
  config: SpeechConfig,
  dependencies: SpeechDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, AudioEntry>();
  const inFlight = new Map<string, Promise<Buffer>>();
  let cacheBytes = 0;
  let month = '';
  let reservedCharacters = 0;
  let activeRequests = 0;

  function currentUsage() {
    const currentMonth = new Date(now()).toISOString().slice(0, 7);
    if (currentMonth !== month) {
      month = currentMonth;
      reservedCharacters = 0;
    }
    return reservedCharacters;
  }

  function getCached(key: string): Buffer | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      cacheBytes -= entry.audio.length;
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.audio;
  }

  function setCached(key: string, audio: Buffer) {
    const old = cache.get(key);
    if (old) cacheBytes -= old.audio.length;
    cache.delete(key);
    cache.set(key, { audio, expiresAt: now() + CACHE_TTL_MS });
    cacheBytes += audio.length;
    for (const [candidate, entry] of cache) {
      if (cache.size <= CACHE_MAX_ENTRIES && cacheBytes <= CACHE_MAX_BYTES)
        break;
      cache.delete(candidate);
      cacheBytes -= entry.audio.length;
    }
  }

  async function readBounded(
    response: Response,
    maxBytes: number,
  ): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new SpeechFailure(
        'TTS_INVALID_AUDIO',
        502,
        'The audio response exceeded Sniffo’s size limit.',
      );
    }
    if (!response.body)
      throw new SpeechFailure(
        'TTS_INVALID_AUDIO',
        502,
        'The audio provider returned an empty response.',
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new SpeechFailure(
            'TTS_INVALID_AUDIO',
            502,
            'The audio provider returned a file that exceeded Sniffo’s size limit.',
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!total)
      throw new SpeechFailure(
        'TTS_INVALID_AUDIO',
        502,
        'The audio provider returned an empty response.',
      );
    return Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      total,
    );
  }

  async function readErrorCode(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const body = await readBounded(response, ERROR_BODY_MAX_BYTES);
      const parsed = JSON.parse(body.toString('utf8')) as {
        detail?: { status?: unknown };
        status?: unknown;
      };
      const value = parsed.detail?.status ?? parsed.status;
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function requestSpeech(transcript: string): Promise<Buffer> {
    if (!isSpeechConfigured(config) || !config.apiKey || !config.voiceId)
      throw new SpeechFailure(
        'TTS_UNAVAILABLE',
        503,
        'Report audio is not configured yet. You can still read the summary below.',
      );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.apiKey,
          },
          body: JSON.stringify({ text: transcript, model_id: config.modelId }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const upstreamCode = await readErrorCode(response);
        if (response.status === 401 || response.status === 403)
          throw new SpeechFailure(
            'TTS_UPSTREAM_AUTH',
            502,
            'Report audio is unavailable because the ElevenLabs key or voice needs attention.',
          );
        if (
          response.status === 402 ||
          upstreamCode === 'quota_exceeded' ||
          upstreamCode === 'max_character_limit_exceeded'
        )
          throw new SpeechFailure(
            'TTS_PROVIDER_QUOTA',
            429,
            'The ElevenLabs account’s available free usage has been reached. No payment was made.',
          );
        if (response.status === 429)
          throw new SpeechFailure(
            'TTS_UPSTREAM_RATE_LIMIT',
            429,
            'ElevenLabs is limiting requests right now. Please try again later.',
          );
        if (response.status >= 500)
          throw new SpeechFailure(
            'TTS_TEMPORARY_FAILURE',
            502,
            'ElevenLabs is temporarily unavailable. Your written summary is still available.',
          );
        throw new SpeechFailure(
          'TTS_UPSTREAM_REJECTED',
          502,
          'ElevenLabs rejected the audio request. Check the configured voice and model.',
        );
      }

      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('audio/mpeg')
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new SpeechFailure(
          'TTS_INVALID_AUDIO',
          502,
          'ElevenLabs returned an unsupported audio format.',
        );
      }
      return await readBounded(response, config.maxAudioBytes);
    } catch (error) {
      if (error instanceof SpeechFailure) throw error;
      if (controller.signal.aborted)
        throw new SpeechFailure(
          'TTS_TIMEOUT',
          504,
          'ElevenLabs took too long to prepare the audio. Your written summary is still available.',
        );
      throw new SpeechFailure(
        'TTS_TEMPORARY_FAILURE',
        502,
        'ElevenLabs could not prepare audio right now. Your written summary is still available.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function generate(transcript: string): Promise<Buffer> {
    if (transcript.length > config.maxCharacters || transcript.length > 400)
      throw new SpeechFailure(
        'TTS_INVALID_REPORT',
        400,
        'The report summary is longer than the audio limit.',
      );
    if (!isSpeechConfigured(config))
      throw new SpeechFailure(
        'TTS_UNAVAILABLE',
        503,
        'Report audio is not configured yet. You can still read the summary below.',
      );

    const key = createHash('sha256')
      .update(
        JSON.stringify({
          transcript,
          voiceId: config.voiceId,
          modelId: config.modelId,
          outputFormat: OUTPUT_FORMAT,
        }),
      )
      .digest('hex');
    const cached = getCached(key);
    if (cached) return Buffer.from(cached);
    const pending = inFlight.get(key);
    if (pending) return Buffer.from(await pending);
    if (activeRequests >= 1)
      throw new SpeechFailure(
        'TTS_RATE_LIMITED',
        429,
        'Report audio is already being prepared. Please wait a moment.',
      );
    if (currentUsage() + transcript.length > config.monthlyCharacterBudget)
      throw new SpeechFailure(
        'TTS_BUDGET_EXHAUSTED',
        429,
        'Sniffo has reached its local monthly audio limit. The written report is still available.',
      );

    // Reserve before contacting the provider. Failed or timed-out calls are not refunded because
    // a lost upstream response may still have consumed account credits.
    reservedCharacters += transcript.length;
    activeRequests++;
    const request = requestSpeech(transcript)
      .then((audio) => {
        setCached(key, audio);
        return audio;
      })
      .finally(() => {
        activeRequests--;
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return Buffer.from(await request);
  }

  return {
    generate,
    getUsage: () => ({
      reservedCharacters: currentUsage(),
      monthlyCharacterBudget: config.monthlyCharacterBudget,
      cachedAudioEntries: cache.size,
    }),
  };
}

export const speechLimits = {
  outputFormat: OUTPUT_FORMAT,
  cacheTtlMs: CACHE_TTL_MS,
  cacheMaxEntries: CACHE_MAX_ENTRIES,
  cacheMaxBytes: CACHE_MAX_BYTES,
};

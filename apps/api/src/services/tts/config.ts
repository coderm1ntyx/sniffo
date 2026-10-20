import { env } from '../../config/env.js';
import type { SpeechConfig } from './speech.js';

export function getSpeechConfig(): SpeechConfig {
  return {
    enabled: env.ELEVENLABS_TTS_ENABLED === 'true',
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: env.ELEVENLABS_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID,
    maxCharacters: env.ELEVENLABS_MAX_CHARS_PER_REQUEST,
    monthlyCharacterBudget: env.ELEVENLABS_APP_MONTHLY_CHAR_BUDGET,
    timeoutMs: env.ELEVENLABS_TTS_TIMEOUT_MS,
    maxAudioBytes: env.ELEVENLABS_MAX_AUDIO_BYTES,
    signingSecret: env.EVIDENCE_SIGNING_SECRET,
  };
}

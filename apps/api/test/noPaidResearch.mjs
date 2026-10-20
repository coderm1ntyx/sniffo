// Ordinary regression tests never use account credentials or live discovery.
// Explicit transport fixtures can still exercise the real adapters and request builder.
import process from 'node:process';
process.env.NODE_ENV = 'test';
process.env.DEEP_RESEARCH_ENABLED = 'true';
process.env.OPENAI_API_KEY = '';
process.env.GOOGLE_CLOUD_VISION_API_KEY = '';
process.env.DEEP_RESEARCH_SEARCH_PROVIDER = 'none';
process.env.DEEP_RESEARCH_VISION_ENABLED = 'false';

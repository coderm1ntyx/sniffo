# ElevenLabs report audio

Sniffo can speak a short, deterministic English summary of the existing Step 3 report. The control is on-demand: opening a report, reading the transcript, pausing, resuming, or replaying does not create a provider request. The first Play action sends the short script to ElevenLabs and receives an MP3. Existing analysis and the written report remain usable if audio is not configured or the provider is unavailable.

## Enable it locally

1. In ElevenLabs, create a separate API key from **Developers → API Keys**. Restrict it to text-to-speech access and set a monthly character limit of **3,000 characters or less**. Do not enable other product permissions or usage-based billing. Do not paste the key into the web app, a `VITE_` variable, a source file, or this repository.
2. Choose a voice already available in the account. In **My Voices**, use the voice menu to copy its ID. Sniffo does not assume a sample voice is available to every account.
3. Set these values in `apps/api/.env`:

   ```dotenv
   ELEVENLABS_TTS_ENABLED=true
   ELEVENLABS_API_KEY=your_restricted_server_key
   ELEVENLABS_VOICE_ID=your_account_voice_id
   ELEVENLABS_MODEL_ID=eleven_flash_v2_5
   ELEVENLABS_MAX_CHARS_PER_REQUEST=400
   ELEVENLABS_APP_MONTHLY_CHAR_BUDGET=3000
   ELEVENLABS_TTS_TIMEOUT_MS=12000
   ELEVENLABS_MAX_AUDIO_BYTES=1000000
   EVIDENCE_SIGNING_SECRET=use_the_existing_random_secret_of_32_or_more_characters
   ```

4. Restart the API. A report created while the feature is enabled includes a short-lived signed narration token. Existing reports should be re-analyzed after enabling TTS so they receive a token.

The API key and voice ID are checked at request time. The implementation cannot confirm that a voice belongs to a particular account until the provider accepts a request. No credentials or configured voice were available during implementation, so account-specific access has not been verified.

## API contract

Analysis continues through `POST /api/analyze`. Its response adds `data.audioNarration`:

```json
{
  "transcript": "Sniffo did not detect warning signs in the information reviewed...",
  "token": "short-lived-server-signed-token",
  "available": true
}
```

The browser displays that exact transcript and sends only the token to `POST /api/tts/report`:

```json
{ "reportToken": "short-lived-server-signed-token" }
```

A successful request responds with `Content-Type: audio/mpeg` and `Cache-Control: private, no-store`. The endpoint rejects arbitrary text, plain JSON reports, altered tokens, and expired tokens. The server derives the script from the verified analysis result and signs it with `EVIDENCE_SIGNING_SECRET`; a client hash or client-authored result is not accepted as proof.

The server sends only the bounded script to `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, with `xi-api-key` authentication and `model_id: eleven_flash_v2_5`. Personal identifiers, source quotations, full listings, uploaded agreements, conversation text, URLs, and payment details are not included. Narration uses fixed descriptions keyed to existing deterministic finding IDs, not finding quotations or arbitrary text from uploaded material.

Controlled API errors include missing configuration (`TTS_UNAVAILABLE`), invalid/expired report (`TTS_INVALID_REPORT`), local budget exhaustion (`TTS_BUDGET_EXHAUSTED`), upstream authorization (`TTS_UPSTREAM_AUTH`), provider quota (`TTS_PROVIDER_QUOTA`), rate limiting, timeout, unsupported audio, and temporary provider failure. Error responses do not include the API key, raw provider body, or narration text.

## Usage limits and deployment

- Speech requires an explicit Play click. There are no automatic requests, retries, or paid features.
- Scripts are capped at 400 characters; response size is capped at 1 MB; each request has a 12-second timeout.
- Requests are limited to three per IP per minute. Only one unique provider request can be active in a process; simultaneous identical requests share one request.
- A process-local monthly character reservation defaults to 3,000 characters. Ambiguous timeouts and provider errors keep the reservation because ElevenLabs may already have counted the request. Successful audio is cached in memory for 24 hours, up to 24 entries and 8 MB. Cache keys are hashes of the exact script, voice, model, and output format.
- This app counter and audio cache are in memory. They reset when the API restarts and are not shared between replicas. A multi-process or serverless deployment must set a strict provider-side API-key character limit; do not treat the in-app counter as a global spending cap. The route limiter is also per-process. Add shared durable quota and rate-limit storage before public multi-instance rollout.
- The API deployment must permit outbound HTTPS to `api.elevenlabs.io`. The web client uses the existing `/api` proxy or configured `VITE_API_URL`; no provider key is sent to the browser. API route limits also apply to payload size and generated output.

The provider-side key limit is the strongest available cap for this stateless project. Check it in the ElevenLabs API key settings and keep it at or below the Sniffo budget. Never enable top-ups or usage-based billing for this demo key.

## Plan and licensing

ElevenLabs currently advertises API access on its free plan and a monthly free allowance, but the account-specific remaining quota and availability of a selected voice cannot be checked without that account’s credentials. The configured 3,000-character application limit is lower than the advertised free allowance; it is an app guardrail, not a credit equivalence or a guarantee that the account has available quota. Check the current account dashboard before enabling it.

ElevenLabs Free plan output is subject to noncommercial licensing and attribution requirements. Review the applicable license before launching a commercial service. Keep the visible **Powered by ElevenLabs** attribution with the audio feature. [ElevenLabs’ publishing guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform) says Free plan output is noncommercial and requires attribution when shared; [API key documentation](https://elevenlabs.io/docs/api-reference/authentication) describes endpoint restrictions and key quotas. [Text-to-speech API documentation](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) documents the endpoint and MP3 output format.

## Verification status

No real API request or account voice check was made. Real browser playback using an ElevenLabs MP3 is therefore not verified. Do not claim the account-specific integration is live until a restricted key and available voice are configured and a live request succeeds.

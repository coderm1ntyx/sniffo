# Sniffo

**Check rental details for warning signs before you pay.** Sniffo is a U-Hackathon project that helps renters compare claims across a property listing, landlord messages, payment requests, and rental agreements. It highlights supported inconsistencies, cites the evidence submitted, and explains what it could not verify.

> **Hackathon prototype:** Sniffo is an experimental, unhosted project, not a production-ready service or a substitute for independent checks or professional advice. Findings are informational, can be incomplete or wrong, and are not proof that a person or listing is fraudulent. Do not use real identity documents, payment credentials, or other sensitive personal information in testing.

## What it does

- Extracts listing details from public URLs or lets renters enter them manually.
- Compares rent, deposits, fees, dates, room type, address, and payment recipient across submitted sources.
- Flags selected payment and message warning signs with supporting quotations.
- Shows evidence coverage and missing information without treating missing details as proof of fraud.
- Offers optional AI-assisted extraction, review, public search, and image comparison when explicitly enabled and configured.
- Keeps reports in browser session storage; the API does not persist analyses.

Text and deterministic checks work without provider credentials. Optional provider features may send user-submitted text or images to those providers when enabled. Review the provider's current data practices before using those features.

## Technology

- **Web:** React 19, TypeScript, Vite, Tailwind CSS v4, React Router, GSAP
- **API:** Node.js, Express 5, TypeScript, Zod
- **Shared contracts:** npm workspaces and Zod schemas

```text
apps/web/        React application and API client
apps/api/        Express API, routes, middleware, and services
packages/shared/ Shared request/response schemas and types
```

## Run locally

Requirements: Node.js 22 LTS and npm 10 or newer.

```bash
git clone https://github.com/coderm1ntyx/sniffo.git
cd sniffo
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

Open <http://localhost:5173>. The API listens on <http://127.0.0.1:3001> by default; Vite proxies `/api` requests to it, so binding the API to loopback does not affect the local browser workflow. Provider keys are optional and should only be added to the API's ignored `.env` file when needed. The shipped API example keeps optional paid features disabled.

### Useful commands

```bash
npm run dev          # Run web app and API
npm run dev:web      # Run only the web app
npm run dev:api      # Run only the API
npm test             # Run shared, API, and web unit tests
npm run typecheck    # Type-check all workspaces
npm run lint         # Run ESLint
npm run build        # Build all workspaces
```

## Environment variables

The API loads `apps/api/.env`; the web app loads `apps/web/.env`. `.env` files are ignored by Git. Never put server credentials in a `VITE_*` variable because Vite variables are included in browser code.

| Variable                                                              | Used by | Purpose                                                                                                                                            |
| --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `HOST`, `PORT`, `CORS_ORIGIN`                             | API     | Local runtime and allowed web origin. The example uses local development values.                                                                   |
| `EVIDENCE_SIGNING_SECRET`                                             | API     | Optional local signing key; production mode requires a private random value of at least 32 characters. Leave unset for local development.          |
| `OPENAI_API_KEY`, `OPENAI_MODEL`                                      | API     | Optional scanned-document extraction, AI review, and OpenAI search. Keep the key server-side.                                                      |
| `GOOGLE_CLOUD_VISION_API_KEY`                                         | API     | Optional image-search integration.                                                                                                                 |
| `ELEVENLABS_TTS_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | API     | Optional report narration. Disabled unless explicitly enabled.                                                                                     |
| `DEEP_RESEARCH_*`                                                     | API     | Optional public search and image comparison. Search provider and Vision are disabled in the example; Vision may incur provider costs when enabled. |
| `VITE_API_URL`                                                        | Web     | Optional API origin for a separately hosted API. Leave empty for the local Vite proxy.                                                             |

See `apps/api/src/config/env.ts` for supported research limits and optional settings. Do not commit real credentials. If a credential is exposed, revoke or rotate it with its provider.

## API overview

- `GET /api/health` — service health
- `POST /api/extract/url`, `/api/extract/text`, `/api/extract/file` — ingest supported evidence
- `POST /api/online-checks` — optional, consented public image or claim checks
- `POST /api/analyze` — compare extracted evidence and return findings

The API applies per-IP in-memory request limits and uses DNS checks, pinned IPv4 connections, redirect revalidation, and request limits for URL extraction. These controls are prototype safeguards, not a deployment security assessment. The API has no user accounts or persistent report storage.

## Team contributions

- **Luka (m1ntyx):** web experience, accessible listing and evidence flows, report presentation, and frontend integration.
- **Raymit (raymeses):** API extraction, SSRF-aware URL handling, evidence verification, and analysis services.

## Hackathon background

Sniffo was built for U-Hackathon in October 2026. The project explores how a renter can review scattered listing and conversation details before sending money, with a focus on explaining evidence and uncertainty rather than presenting an unexplained scam score. It remains a hackathon prototype; no hosting or deployment is part of this release preparation.

## Privacy and legal notes

This repository is source code for a local prototype and does not provide a hosted service or collect user accounts. A standalone privacy policy or terms of service is not included because there is no hosted user relationship to describe. Local operators should still avoid real sensitive data. If optional AI or search integrations are enabled, submitted content may be sent to the configured provider. Reassess privacy notices, terms, and applicable legal requirements before offering a hosted or public-facing service.

## License

Sniffo is provided under the MIT License. See [LICENSE](LICENSE).

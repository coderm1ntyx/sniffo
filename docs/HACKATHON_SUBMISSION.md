# Sniffo

**Sniffo helps renters review listing details and landlord messages for evidence-backed rental warning signs before they pay.**

## Problem

Renters often need to compare claims across a listing and landlord conversation while deciding whether a request is safe. Sniffo highlights supported inconsistencies and warning signs, cites the submitted evidence, and states what it could not verify. Its heuristic score is not a probability of fraud.

## How it works

1. Start with a public listing URL or enter property details manually.
2. Review and edit the extracted or entered details, add landlord messages, and optionally enable Deep Research.
3. See the findings, supporting evidence, coverage limits, and suggested next steps.

Missing prices are optional. Deterministic checks run without AI credentials. Deep Research is an explicit opt-in; with the example configuration, no search provider is configured and photo comparison is disabled.

## Tech stack

- React 19, TypeScript, Vite, Tailwind CSS v4, React Router, GSAP
- Node.js, Express 5, TypeScript, Zod
- Shared request and response schemas in the npm workspaces

## Implemented

- URL extraction with SSRF protections, plus manual property entry
- Pasted text extraction and deterministic cross-source and payment-language checks
- Evidence-backed results with quotes, source selection, coverage information, and next steps
- API endpoints for text and supported file evidence ingestion
- Optional bounded AI review and Deep Research paths, gated by explicit use and server configuration
- Session-only reports; the API does not persist user analyses

The Step 2 interface currently accepts pasted landlord messages. File evidence ingestion is exposed by the API but is not offered as an upload control in the main three-step interface.

## Run locally

Use Node.js 22 LTS and npm 10 or newer:

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API health endpoint is [http://localhost:3001/api/health](http://localhost:3001/api/health).

Useful checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

## Environment

- `EVIDENCE_SIGNING_SECRET`: required in production; use a private random value of at least 32 characters.
- `PORT`, `HOST`, `NODE_ENV`, and `CORS_ORIGIN`: API runtime and allowed frontend origin.
- `VITE_API_URL`: optional frontend API origin, set at build time for a separate production API.
- `OPENAI_API_KEY`: optional server-only credential for supported AI extraction/review and opt-in research features.
- `GOOGLE_CLOUD_VISION_API_KEY`: optional server-only credential for image-search checks.
- Deep Research search requires a configured provider; the shipped example uses `DEEP_RESEARCH_SEARCH_PROVIDER=none`. Vision is disabled in the example configuration.

Never place backend credentials in `VITE_*` variables. `.env` files are ignored by Git.

## Links

- Live demo: not available
- GitHub repository: [Sniffo](https://github.com/coderm1ntyx/sniffo) (private; public release pending approval)

The repository will remain private until its public release is separately approved. No hosted demo or deployment is planned for this hackathon prototype.

## Limitations and verification status

- The ordinary listing URL parser does not launch Chromium. In the local smoke attempt on 2026-10-16, Airbnb returned HTTP 410 for a real public listing, so that listing's details and images could not be verified through the app. Manual entry remains available.
- A controlled landlord message requesting off-platform cryptocurrency payment within one hour produced payment-channel, high-risk-payment-method, and coercive-deadline warnings with supporting quotes. An ordinary listing without warning evidence returned an insufficient-evidence result.
- API analysis took 19 ms for the controlled warning case and 4 ms for the ordinary text case in the local run; pasted-text extraction took 87 ms. These are single local observations, not performance guarantees.
- The automated browser suite is configured for Microsoft Edge, which is not installed on the test machine. The main manual-entry, analysis, back-navigation, and re-analysis journey was exercised in Chrome instead.
- ElevenLabs narration, Avalanche, U-Bot, and Vision-based OCR are not part of the implemented main flow. No live demo or deployment configuration is provided. A production frontend host must rewrite client-side routes to `index.html`, and the API needs production environment values, including its evidence signing secret.
- Airbnb access can be restricted or change its response. Extraction should be treated as best-effort, and renters can correct details manually.

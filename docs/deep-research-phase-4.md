# Deep Research (Phase 4)

Deep Research adds an optional evidence-gathering stage to the existing Step 2 → `/api/analyze` → Step 3 flow. It is off in the UI by default. Existing cream/navy/orange layouts, extraction, uploaded-document ingestion, signed evidence and R01–R09/R12 remain in use. No extra page or paid search dependency is introduced.

## Architecture and API

`packages/shared/src/schemas/research.ts` defines the research report and strict visual result. `AnalysisRequestSchema` accepts optional `deepResearch: true`; omission preserves standard analysis. `apps/api/src/services/research/` separates profiles/queries, safe public retrieval and provider normalization, property matching, field comparisons, cache, budget and Vision. The existing extractor parses actual public HTML/JSON-LD/metadata. Research facts are never taken from an unread search snippet.

`POST /api/analyze` still returns `{ success: true, data }`. Deep requests add `data.research`, including counts, status, sources, comparison quotations, visual availability and limitations. A client may request `Accept: application/x-ndjson` on this same endpoint. It receives `progress`, `standard` and final `result` records. The frontend retains the earlier standard report if the research stream breaks. Stages are emitted when their work starts; photo progress is emitted only before an actual Vision request, never for a skipped/cache-only comparison. There are no fake percentages or duration promises.

The pipeline has a 10-second total research deadline, three active analyses per API process, two candidate workers, at most three queries and five deeper candidate inspections. Original direct URL checking is separate from those candidate counts. At most two strong candidates are considered for photos; the first eligible pair is selected, with a hard implementation ceiling of one model request per analysis. Partial failures preserve standard verification. Client disconnect cancels pending research transports. A timed-out response takes a snapshot so late work cannot change the emitted result.

## Search configuration and no-key operation

Defaults:

```dotenv
DEEP_RESEARCH_ENABLED=true
DEEP_RESEARCH_SEARCH_PROVIDER=none
DEEP_RESEARCH_VISION_ENABLED=false
```

Without any key or search endpoint, Deep Research can safely re-read an accessible submitted public URL and check a same-origin canonical link. These are original-source checks, **not** an independent web search. Manual properties without a public URL receive honest unavailable/partial research plus their ordinary report. Blocked, login-only, CAPTCHA-protected and otherwise inaccessible platforms stay inaccessible. No result, no images or a failed page never raises the score.

For broader discovery, configure a permitted SearXNG instance that enables JSON output:

```dotenv
DEEP_RESEARCH_SEARCH_PROVIDER=searxng
DEEP_RESEARCH_SEARCH_URL=https://your-permitted-instance.example
```

SearXNG's software/API does not require a paid API key. This project supplies neither hosting nor a guaranteed public quota. Use an existing instance you are allowed to query; many public instances disable JSON or impose limits. No keyless commercial search-engine HTML scraping or access-control bypass is implemented. This optional adapter degrades honestly if unavailable. For safety, configured endpoints currently must be public HTTP/HTTPS hosts on standard ports; a localhost/private SearXNG endpoint is not accepted. See the [SearXNG Search API](https://docs.searxng.org/dev/search_api.html). The separate pre-existing paid online-check integrations are not invoked by Deep Research.

Queries use disclosed listing titles, location, distinctive listing phrases or listing IDs, with basic contact redaction. Messages, agreements, uploaded screenshots and other private document text never enter public search. Query contents are not logged. Search cache keys hash query/endpoint context and retain only bounded public metadata for five minutes. Public pages are cached for one minute. Failed search metadata stays explicitly unverified.

## Identity, comparisons and scoring

Profiles are category-aware: apartments/condos, houses/villas, private/shared rooms, hotels/serviced stays, commercial property, land and unknown categories all have graceful handling. No bedroom, currency or address is fabricated to fill a profile. Thai text and digits are retained/normalized. Monthly and booking prices keep their own basis/context.

Identity labels are `exact_listing`, `likely_same_property`, `same_building_or_development`, `possible_match`, `unrelated` and `insufficient_evidence`. Canonical equivalence is restricted to the source's origin. Exact platform IDs must share a platform host. Strong cross-platform matching requires precise addresses, a matching category and distinctive identity evidence; apartments, hotels, rooms and commercial units additionally require an explicit matching unit/room number. A title alone never confirms a property or building. Similar photos cannot promote a weak nonvisual match into a strong property identity.

Comparisons retain both exact field quotations. City vs district detail does not automatically contradict. Unknown transaction context prevents comparisons. Currency, price basis, explicit fee inclusion, unit, room variant, discount role, stay dates and guests must be compatible before price claims are compared. Price differences remain research leads and are not automatically scored. Fee/deposit comparisons abstain when transaction context is incomplete. This is intentionally conservative for dynamic booking offers and sale/rent differences.

Only explicit physical claim differences (bedrooms, bathrooms, property category) from strong property matches and nonduplicate publishers can supply narrowed, newly signed sources to the existing rule engine. These records contain their original quotations/field references and a signed `fieldComparisonOnly` marker: incidental payment prose in webpage quotations cannot trigger message-warning rules. Existing sources and user edits are not overwritten. Original-domain, duplicated/derived advertisements, weak identity matches, snippets and Vision do not supply scoring evidence. Re-running the unchanged scoring engine supplies any resulting concern index and deduplicates issues as before. Standard scoring eligibility remains authoritative, including unavailable scores. Vision itself adds no rule or score weight.

Different domains do not establish independently verified truth: candidate publisher independence remains `unverified` unless evidence establishes derivation. `independentSources` is conservatively zero in this version; `candidatesReviewed` and strong identity labels separately describe the actual work. A repost is never legitimacy proof. A confirmed inconsistency means two attributable claims differ, not that fraud or ownership has been established.

## Signed provenance and safe retrieval

Research preserves canonical URL, domain, discovery method/provider, original retrieval time, extraction method, content digest, bounded excerpt, field quotations, identity reasons, derivation status and the backend-issued source record. Public source IDs and fact IDs are stable for their canonical/context URL and content values. `publicListing` metadata and the research-only marker are included in the HMAC signature. Client-supplied IDs, facts or altered metadata cannot bypass existing evidence validation. API issuance never proves a website truthful.

The existing DNS-pinned transport validates every redirected host, rejects credentials/private networks/IP literals/cloud metadata/unsafe ports/protocols, bounds redirects and bodies and enforces deadlines. Research also checks `robots.txt` before each page/image redirect. A missing robots file permits normal retrieval; an inaccessible policy or applicable disallow prevents research. No login, anti-bot, CAPTCHA or restricted-content bypass is attempted. Search provider JSON is bounded separately. Public images require allowed content types and actual `sharp` decoding, limits on pixels/dimensions, and are resized to at most 512×512 low-detail JPEGs with metadata removed. Raw download buffers are cleared after processing. The response embeds only these safe public thumbnails; it does not make the browser fetch arbitrary full-size images.

## Optional Vision and costs

The existing OpenAI service transport calls the [Responses API with image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [strict structured output](https://developers.openai.com/api/docs/guides/structured-outputs). It handles the HTTP response's `output[].content[].text` shape, incomplete/refused/invalid output and provider failures. There are no automatic billable retries. Keys stay server-side; `store: false` is sent.

All conditions must hold: the user requested Deep Research, global Vision is enabled, an OpenAI key is configured, a strong nonvisual property match exists, at least one original public photo and one candidate public photo safely decode, the comparison is not cached, a call slot/reservation is available, and the research deadline remains. Byte-identical selected photos skip AI entirely. No images, quota/auth/rate-limit errors, invalid output and timeouts return informative availability states without a score penalty. Auth/quota/rate-limit failures stop further Vision attempts for the process.

```dotenv
DEEP_RESEARCH_VISION_ENABLED=false
OPENAI_API_KEY=                 # existing server-side configuration
DEEP_RESEARCH_VISION_MODEL=gpt-4.1-mini
DEEP_RESEARCH_MAX_VISION_CALLS=1 # zero disables; implementation never exceeds one
DEEP_RESEARCH_MAX_ORIGINAL_IMAGES=2
DEEP_RESEARCH_MAX_CANDIDATE_IMAGES=2
DEEP_RESEARCH_VISION_MAX_OUTPUT_TOKENS=500
DEEP_RESEARCH_VISION_MAX_DIMENSION=2048
DEEP_RESEARCH_VISION_TIMEOUT_MS=6000
DEEP_RESEARCH_LOCAL_VISION_BUDGET_USD=1.50
DEEP_RESEARCH_VISION_RESERVATION_USD=0.05
```

Before any billable await, the synchronous process-wide budget reserves the configured estimated amount, checks the cumulative cap and permits only one active Vision request. Failed/timed-out calls keep their reservation because usage may already have occurred. Provider-reported input/output token totals are aggregated in memory. Concurrent identical submissions share in-flight comparisons. Completed visual descriptions and sanitized public thumbnails cache for 30 minutes by image-content fingerprints, prompt/model version, property/unit and full extracted booking/price context; private documents are never placed in this cache.

The $1.50 cap is **an internal estimated guardrail**, not a billing cutoff or verification of the remaining OpenAI balance. The $0.05 reservation is configurable, not a promise of model cost. Changing models or token/image limits requires reviewing that estimate. Counters, quota circuit breaker and caches are per process and reset on restart. Use a single API process for this hackathon deployment; multiple workers/replicas require a shared atomic budget store before enabling Vision across them. Configure a dedicated OpenAI project/key, model access and rate limits, monitor usage, and configure project budget alerts in the OpenAI dashboard. Check whether any configured provider budget is enforced or alert-only; do not assume alerts stop billing. Sniffo never retrieves or guarantees the account balance.

## Validation and controlled live smoke tests

Ordinary `npm test` never runs billable research. The regression fixtures include Airbnb apartments, hotels, villas, private rooms, monthly rentals, commercial property, land, manual listings, different units, reused photos, conflicting locations, unavailable pages, booking price contexts and Thai text. API tests exercise actual parsing/signing/matching/scoring and real loopback HTTP streaming; external search/Vision transports use explicit controlled fixtures. Browser tests exercise real standard/no-key endpoints and a separate controlled research transport to validate stages, source popups, thumbnails, navigation persistence and mobile layout. Fixture Vision is **not** proof of live OpenAI capability.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
# With npm run dev already running; uses installed Microsoft Edge:
npm run test:e2e -w @sniffo/web
```

For one real, bounded nonvisual smoke test, configure the permitted search endpoint and run from the API workspace:

```powershell
npm run smoke:research -w @sniffo/api -- https://a-public-property-listing.example/path
```

Only if deliberately authorizing a possible API charge, configure the key and global Vision enablement, then add `--vision` to that command. The usual prerequisites still apply, so the command may honestly skip Vision. No fabricated comparison is substituted when a source is inaccessible. Report live search and live Vision as unverified until each actually completes. This task did not run a billable OpenAI call or claim a fixture search was a live internet search.

Set `DEEP_RESEARCH_ENABLED=false` to return a skipped research report while preserving standard analysis. Set `DEEP_RESEARCH_VISION_ENABLED=false` or the call/budget limit to zero to stop photo model requests while retaining nonvisual work. No search key is required for the basic app.

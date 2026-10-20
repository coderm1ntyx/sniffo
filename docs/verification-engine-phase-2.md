# Sniffo verification engine — Phase 2

## Implemented pipeline

`POST /api/analyze` validates the existing request, verifies every source signature, reconstructs authoritative source facts, separates user assertions, normalizes claims and booking context, evaluates R01–R09, adds grouped R12 coverage limitations, deduplicates findings, computes a deterministic score, and validates the shared response schema. The existing analysis service is the entry point; no alternate engine or per-rule endpoints were added.

Extraction remains a separate operation. Rule evaluation does not scrape websites, resolve redirects, geocode, query a database, or call an AI provider. The Airbnb extractor and its fixtures are preserved. The endpoint accepts signed listing, message, payment, and document evidence from any provider.

## Evidence trust and security

- **Server-extracted evidence:** signed API-generated source content and structured facts. This establishes issuance/integrity, **not independent authenticity**.
- **User source content:** messages, pasted advertisements, and document text. These are attributed submitted statements, not verified truth.
- **User assertions:** manual property entries and Step 2 corrections. These remain available in the source record and extracted facts, but cannot generate contradictions, behavioral warnings, scoring eligibility, or score contributions. Legacy signed correction sources are also recognized conservatively.
- **Derived claims:** money/unit normalization retains `inputClaimIds`; derived amounts do not invent quotations. The original source/quote and optional structured reference remain attached.

Sources use HMAC-SHA256, constant-time digest comparison, exact base64url token validation, and deterministic object-key ordering. Signed fields include source identity/type/name/URL/text/status, structured facts, evidence category, extraction metadata, and file digest/method when supplied. Keys stay in the API. Production startup requires `EVIDENCE_SIGNING_SECRET` of at least 32 characters. Development uses a process-local random key when no secret is configured; restart invalidates those tokens. There is no token expiry or token-version facility in the existing format. Changes to signed data require re-extraction; there is no unsigned fallback.

Invalid source signatures or duplicate source IDs reject the request with `400 INVALID_EVIDENCE`. Invalid client facts, missing fact sources, fabricated quotations, altered normalized values, and malformed prices are excluded and reported in `evidenceDiagnostics`; valid evidence can still be analyzed. Client normalized values never override reconstructed source content. Signed structured facts may cite a source path instead of appearing in visible text. A structured path is accepted only from the signed payload, never merely from a client fact.

For text, quotation verification permits whitespace normalization while preserving original quotation text. `sourceFacts` returns the authoritative facts used by the API, so the results report does not display a fabricated client fact. Signed file metadata retains the document identifier, SHA-256 digest, extraction method, and page/line references where available. PDF/OCR/AI text quotations establish traceability to extraction output, not independent pixel-level transcription accuracy.

### Limits

Analysis JSON body: 1 MB (the service also checks 1,000,000 serialized bytes). Maximum 20 sources, 100,000 characters per source, 2,000 submitted facts, 1,000 authoritative facts/normalized claims, 2,000 behavioral statements, 10,000 candidate comparisons, 60 findings including R12, 12 evidence references per finding, and 40 payment links. Untyped structured values are limited to depth 16 and 10,000 nodes. Money is bounded to a safe cent representation. Source/claim overflow is rejected or explicitly reported as partial coverage; it cannot silently become a complete clean review.

## Claim normalization and context

Internal claims contain stable ID, source ID, field, raw and normalized values, exact quote, optional fact/path reference, extraction method, trust category, derived input IDs, and rental/booking context. Sources are parsed once into reusable facts/statements; comparison and link work have global limits.

Context identifies short stays, monthly rentals, hotel/serviced accommodation, privacy category, explicit property/unit IDs, room variants, dates, nights, and occupancy where provided. Private/shared rooms, entire homes, apartments, condominiums, villas, houses, farm stays, student housing, sublets, and direct rentals use the same evidence model; unknown categories retain conservative defaults. Rental category never creates a warning by itself. Farm/student/sublet categories do not have separate specialized policy engines.

A submission is treated as one rental case. Explicitly different listing/unit IDs or room variants prevent comparisons. When several listing IDs exist, an unlinked message is ambiguous and is not compared. With no explicit identifiers, the same-case relationship is an assumption disclosed in R12; the engine cannot independently establish which property a message describes.

## Rule coverage matrix

All ten rules are reachable from `POST /api/analyze`. Test tables in `apps/api/test/phase2.test.ts` cover positive cases, negative controls, evidence references, categories, and score effects. Existing extraction and integrity tests remain present.

| Rule | Trigger                                                                                                                            | False-positive guards                                                                                                               | Severity                                      | Tested limitations                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| R01  | Established platform plus direct/private payment, explicit bypass, cancellation/payment redirection, or broken-platform excuse     | Negation, educational warnings, reported complaints, ordinary direct rental bank transfers                                          | Critical                                      | Conservative phrase/attribution patterns; unfamiliar indirect instructions can be missed                                      |
| R02  | Gift-card/crypto demand or explicitly suspicious irreversible/unrelated-account transfer                                           | Ordinary bank payments, optional methods, denials, protective warnings                                                              | High; medium for contextual transfer concerns | Does not establish recipient identity; R10 is absent                                                                          |
| R03  | Payment is a condition of viewing, receiving terms, or verifying property details                                                  | Platform checkout, prepaid booking policies, disclosed deposits after signing/ordinary occupancy terms                              | High                                          | Does not judge local law or whether a commercial term is legally reasonable                                                   |
| R04  | Payment demand with a short deadline, immediate action, loss pressure, or refusal to allow questions                               | Check-in/office hours, promotional expiry, cancellation deadlines, arrival scheduling                                               | Medium                                        | Explicit language patterns, not inference about hidden intent                                                                 |
| R05  | Payment/identity URL with platform impersonation, misleading subdomains, selected IDN confusables, credentials, shortener, or HTTP | Exact official registered domains, maps/help-only links, protective warnings, unfamiliar HTTPS management domains without deception | Critical for impersonation; high otherwise    | `tldts` public suffix parsing; finite platform/confusable/shortener lists; no DNS, redirect, reputation, or destination fetch |
| R06  | Different comparable rent/rate/stay claims                                                                                         | Basis/currency/date/occupancy/variant/fee/discount/estimate guards; ranges and rounding                                             | High                                          | No FX conversion; undated totals and ambiguous fee/context combinations abstain                                               |
| R07  | Clearly incompatible city/country/street-level property claims                                                                     | Parent/district hierarchy, known Thai/English aliases, business address, missing address, approximate coordinates                   | High                                          | Finite conservative place aliases; no general geocoder or complete geographic hierarchy                                       |
| R08  | Same-unit room/count/privacy/type or explicit unit-amenity contradiction                                                           | Beds vs bedrooms, capacity vs selected guests, private-room scope, hotel variants, shared-building facilities, absent amenities     | High                                          | Only explicitly comparable unit claims; no image/physical inspection                                                          |
| R09  | Conflicting equivalent deposits/fees; explicit no-security-deposit or included-cleaning promise vs mandatory extra charge          | Missing is not none; holding vs security deposits; optional vs mandatory and recurring vs one-time charges                          | High                                          | No inference of undisclosed charges from omission; no legal assessment of fees                                                |
| R12  | Grouped coverage gaps, source limitations, exclusions, unsupported wording, or incomplete context                                  | Category-specific guidance; no demand for Airbnb monthly rent/hidden street address or private hotel landlord lease                 | Info                                          | Always contributes exactly zero; not a fraud detector                                                                         |

R10 identity inconsistency and R11 image verification are deliberately absent. Existing tests that expected identity comparisons or a nonzero baseline for missing information now verify the Phase 2 scope and score contract instead.

## Price semantics

The engine uses the shared `PriceRecord` model. It distinguishes monthly, weekly, nightly, stay-total, deposit, cleaning, service, and other categorized fees. Comparable claims need the same known currency, explicit basis, compatible dates/occupancy/unit/variant, matching fee inclusion, and current/non-estimated status. Unknown and original/crossed-out prices do not create contradictions. Stay totals require matching positive nights, explicit dates, and a known fee basis. Known context on only one side is not silently filled into the other offer.

Monthly intervals may corroborate a value inside the interval. Amount differences up to one currency unit are treated as rounding/clarification rather than contradictions. Comparisons use rounded integer hundredths; nightly-to-stay conversion only occurs with explicit dates, duration, and fee basis and retains the input claim reference. No exchange rate is inferred. Generic symbols such as `$` or `¥` are not assigned a country without explicit context; Japanese `円` and Korean `원` have tested normalization.

## Location and property semantics

Location comparisons use equivalent explicit levels. Known city aliases can establish incompatibility; containing district/city strings are not contradicted merely because they differ. Equivalent Thai digits/street spellings normalize conservatively. Business offices and approximate map coordinates are not property-address evidence. Unknown transliterations/hierarchies abstain rather than invoking geocoding.

Room counts use equivalent fields and unit scope. A private room in a larger house and unspecified hotel categories abstain. Privacy claims normalize `bookingType` into comparable privacy claims. Explicitly promised unit pool/Wi-Fi/parking/elevator availability can conflict with an explicit denial; amenity absence is never interpreted as a denial.

## Findings, deduplication, and scoring

Existing finding fields remain: `id`, `category`, `severity`, `title`, `description`, `referencedEvidence`, `referencedFactIds`, and `recommendedAction`. Additive fields are `ruleId`, `affectedField`, `issueGroup`, `scoreContribution`, and structured `evidence` references (`sourceId`, optional fact/claim ID, quote, structured path). Existing `info` remains supported; `critical` and `informational` are additive severities.

Finding IDs/order are deterministic for identical inputs. Duplicate same-rule quotations are collapsed across copied evidence. Equivalent field discrepancies are grouped. Distinct concerns may remain visible, but payment concerns in the same paragraph and property mismatches for the same source pair share scoring groups. Separate paragraphs can support separate issues. Paragraph grouping is conservative and may discount independent demands placed in one paragraph.

`redFlagScore` uses `phase2-v1`, `interpretation: concern_index`, an explicit eligibility status, nullable `valueOutOf10`, explanation, and per-finding/rule breakdown. Base weights: critical 4, high 2.5, medium 1, low 0.5, informational/info 0. The strongest group member receives full weight; later members receive 25%, rounded to tenths, with a group cap of 5. The total is capped at 10; the breakdown contributions exactly match the total. R12, excluded facts, unsupported rules, user assertions, and AI-only suggestions contribute zero.

A score is available when at least one supported, source-backed R01–R09 finding exists, or when at least two distinct readable source records include a conversation/payment/agreement record. Identical copied content does not create eligibility. Distinct submitted records do not prove independent authenticity. A single ordinary listing returns `insufficient_evidence` and `null`, not a safety score. Eligible zero means only that no supported red flags were detected in checked content.

The existing `riskAssessment.score` stays 0–100 (`10 × valueOutOf10`, or compatibility placeholder 0 when unavailable). Step 3 prioritizes `redFlagScore.status`; it never displays that placeholder as a scored zero. Existing summary/coverage/property/recommendation fields remain. Legacy stored reports retain their prior frontend mapping.

## Language and optional AI

English rules and representative Thai, Japanese, Korean, and Chinese payment/negation/urgency/price fixtures run deterministically. This is tested phrase coverage, not complete language understanding. New languages, transliterations, code switching, indirect requests, and ambiguous wording can be missed. Coverage text explicitly discloses this; absence of warnings is not a clearance.

The existing opt-in AI message reviewer remains optional and bounded by its existing schema, timeout, text/count limits, and exact-quote validation. Invalid/negated/assertion-backed suggestions cannot become findings. AI-only wording is retained as an R12 advisory evidence reference, not a scored fraud judgment or invented deterministic claim. Provider errors leave deterministic analysis available. No live provider or credential was required for these checks. Image/document transcription remains a separate ingestion capability and is labeled as extracted text, not independent verification.

## Real examples and API usage

Run `npx tsx apps/api/scripts/verification-examples.ts` to generate signed requests and actual responses in one process. [Generated request/response examples](verification-engine-phase-2-examples.json) contain synthetic source content processed by production code, not mocked findings. Integrity tokens use the local signing key and are not portable credentials or guarantees about those example URLs. The example Airbnb source is locally sealed illustrative source content; it is not a claim that a live page was fetched.

1. `Don't pay through Airbnb. Send ฿5,000 in crypto within one hour.` produces R01 critical (4.0), R02 high (0.6 after overlap), R04 medium (0.3 after overlap), and R12 informational (0): **4.9/10**.
2. Listing `Monthly rent: ฿28,000/month` and agreement `Monthly rent: ฿35,000/month` produce an R06 confirmed inconsistency citing both source IDs and quotations: **2.5/10**. This confirms contradictory claims, not which amount is correct.
3. One ordinary Airbnb listing produces grouped R12 coverage limitations and an **unavailable/null** score. Missing Airbnb monthly rent or exact street address creates no score contribution.

To submit real text evidence, call `POST /api/extract/text` (or the evidence ingestion route) with `{ "text": "Monthly rent: ฿28,000/month", "type": "listing_text", "name": "Listing" }`. Preserve its returned `source` unchanged. Collect listing/messages/agreement sources and pass `{ "sources": [...], "facts": [...] }` to `POST /api/analyze`. Manual/correction text sets `evidenceKind: user_assertion` at extraction time. Clients cannot request `server_extracted` text ingestion. Shared schemas define the exact envelopes and errors.

## Checks, benchmark, and observability

`npm test` runs shared contract tests, all API/extraction tests, and all web tests. `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`, and `git diff --check` cover repository verification. HTTP tests exercise real fixture extraction, Step 2 correction separation, signed text ingestion, analysis, shared-schema validation, and Step 3 evidence/score mapping without live sites or keys.

`npm run benchmark:verification` warms up ten times and measures fifty local deterministic analyses of twelve sources (~53 KB request). It reports validation, normalization, rule, scoring, and total latency separately. [Measured local benchmark](verification-engine-phase-2-benchmark.json) records Node/runtime and median/p95 results; AI is off and no destination is fetched. These are local measurements, not production SLAs.

Development diagnostics include request ID, source/claim/verified/excluded counts, comparisons, links, per-rule evaluations, finding categories, eligibility, stage durations, and optional AI duration. `x-request-id` is returned. Full private content, account details, secrets, and uploaded bytes are not logged by the analysis route. Successful-analysis diagnostics are suppressed in production.

## Phase 3 readiness and remaining boundaries

The claim/evidence model, immutable source categories, bounded evaluation, and scoring adapter provide an extension point for optional vision and external verification. R10/R11 should be separate explicit rules added only with authenticated external evidence, bounded retrieval, supporting quotations/paths, and regression coverage. AI or external services must propose traceable claims; they cannot directly assign scores.

This release does not authenticate landlord messages/documents, verify ownership or identity, inspect property images, resolve arbitrary payment sites, establish legal validity, recover inaccessible booking prices, provide FX conversion, or comprehensively understand every language/rental policy. New geographies, platforms, ambiguous scopes, and indirect payment wording require further curated fixtures. The engine is ready to integrate traceable Phase 3 evidence, not to claim those external checks already exist.

## Files and responsibilities

Paths below are relative to the repository. Existing unrelated workspace edits were preserved.

| Files                                                                                                                            | Phase 2 responsibility                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/services/analysis.ts`                                                                                              | Existing endpoint's analysis orchestration, coverage, authoritative source facts, compatibility serialization, diagnostics      |
| `apps/api/src/services/verification/claims.ts`                                                                                   | Claim model, context, statement attribution/negation, derived values, source assertion separation                               |
| `apps/api/src/services/verification/rules.ts`                                                                                    | R01–R09 comparisons, URL parsing, references, deduplication and bounds                                                          |
| `apps/api/src/services/verification/scoring.ts`                                                                                  | Versioned weights, evidence eligibility, overlap controls and contribution breakdown                                            |
| `apps/api/src/services/evidenceIntegrity.ts`, `sourceSignature.ts`                                                               | Signature verification, canonical sealing, source reconstruction, exclusion diagnostics, stable IDs                             |
| `apps/api/src/routes/analysis.ts`, `apps/api/src/app.ts`                                                                         | Endpoint integration, request ID, bounded JSON input, privacy-safe development timings                                          |
| `apps/api/src/routes/extraction.ts`, `apps/api/src/services/extraction.ts`                                                       | Signed text-ingestion purpose; small compatibility change, no Airbnb extractor rewrite                                          |
| `apps/api/src/services/ai.ts`                                                                                                    | Signed file digest and extraction-method provenance, compatible with the evidence-ingestion work                                |
| `apps/api/src/routes/evidence.ts`                                                                                                | Remove unused declaration and preserve control-character filename sanitization while satisfying lint                            |
| `packages/shared/src/schemas/api.ts`, `evidence.ts`, `findings.ts`, `property.ts`                                                | Additive score/evidence/context contracts, bounded values, legacy compatibility                                                 |
| `apps/web/src/components/check/reviewEvidence.ts`, `apps/web/src/pages/NewCheckPage.tsx`, `apps/web/src/lib/api.ts`              | Mark manual entries and corrections as assertions at ingestion                                                                  |
| `apps/web/src/components/report/reportPresentation.ts`, `reviewInsights.ts`                                                      | Prefer authoritative report facts and exact finding quotations; honor score availability; support agreement image source labels |
| `apps/api/test/phase2.test.ts`, `phase2-integration.test.ts`                                                                     | Rule/security/language/scoring regression tables and HTTP Step 2 → Step 3 coverage                                              |
| `apps/api/test/analysis.test.ts`, `evidenceIntegrity.test.ts`                                                                    | Retain tests while updating obsolete baseline/identity/AI expectations to the Phase 2 contract                                  |
| `packages/shared/test/phase2-contract.test.ts`                                                                                   | Score invariants, evidence-category security and structured-payload limits                                                      |
| `apps/api/scripts/benchmark-verification.ts`, `verification-examples.ts`                                                         | Reproducible measurements and actual generated request/response examples                                                        |
| Root, API, web, and shared `package.json`; `package-lock.json`                                                                   | `tldts`, complete test scripts, benchmark command and lockfile                                                                  |
| `docs/verification-engine-phase-2.md`, `verification-engine-phase-2-examples.json`, `verification-engine-phase-2-benchmark.json` | Engineering report, real implementation outputs, measured local performance                                                     |

## Recorded verification

The final repository run passed **387 tests**: **343 API**, **37 frontend**, and **7 shared-contract** tests, with zero failures. This includes the extraction regressions and evidence ingestion tests present in the shared workspace. Typecheck, lint, production build, formatting, and diff whitespace checks passed. The production web build retains Vite's warning about a JavaScript chunk larger than 500 KB; bundle splitting is outside this backend change.

The HTTP integration test covers fixture-based Airbnb extraction, unchanged signed originals, explicit correction assertions, suspicious/normal messages, unavailable single-source scores, invalid signatures, malformed requests, oversized payloads, excluded client facts, response validation, and the actual Step 3 report/score mapper. No live browser automation, live scraper website, production deployment, property registry, or live AI provider was exercised.

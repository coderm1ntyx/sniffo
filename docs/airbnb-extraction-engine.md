# Airbnb extraction engine — implementation and verification

## Scope and root causes

The URL endpoint now uses one listing-specific Airbnb engine. The generic extractor remains available for other listing sites and pasted evidence. Legacy HTML/text callers use the same Airbnb parser rather than a second Airbnb implementation. No frontend files were changed in this task.

The original pipeline preferred H1 → embedded listing title → JSON-LD → Open Graph for titles; embedded descriptions → JSON-LD → visible sections → metadata for descriptions; and Open Graph → JSON-LD → embedded galleries → Twitter for images. Its JSON-LD walker recursively collected facts from every object, without enforcing listing identity. The embedded parser only accepted `airbnb.com` and one detail-section layout. It missed the current `DemandStayListing` GraphQL presentation, silently capped descriptions, supported few currencies, and did not distinguish struck-out prices or missing-price states. Price parsing treated comma/space grouping as the only localized number formats. Analysis re-ran the generic parser, potentially losing resolved facts or bringing discarded price interpretations back.

## Pipeline and resolution

URL validation and existing DNS-pinned HTTP fetching, public-IP checks, redirect validation, timeouts, 1 MB response cap and extraction budget remain in place. One request is made unless the source redirects; there are no retries, browser automation, authenticated requests, LLM calls or scraping services in the extraction path. Exact Airbnb domain boundaries and an explicit regional-domain list activate the adapter. Locale subdomains are supported. Room IDs are validated after redirects, and a redirect to another listing is rejected. Booking dates and guest counts are retained from the submitted URL; tracking parameters are not interpreted as facts.

The parser scopes embedded candidates using a numeric listing ID or an explicitly decoded Airbnb listing GraphQL identity. It supports both legacy detail sections and listing-matched GraphQL presentation nodes. Recommendation, review, navigation, conversion and promotion branches are excluded. Mixed legacy containers cannot donate unassociated descriptions. JSON-LD accepts the requested listing root or a single unassociated listing root as lower-quality fallback; multiple unassociated roots require abstention. Traversal is bounded to 24 levels and 30,000 nodes per traversal.

Titles: specific GraphQL presentation → matching embedded listing → H1 → matching JSON-LD → single-root JSON-LD fallback → Open Graph/Twitter. Generic SEO titles are demoted. Capitalization, punctuation and Unicode are preserved.

Descriptions: matching GraphQL long description → matching legacy description sections → direct embedded description → matching/single-root JSON-LD → explicit visible sections → metadata summary. Paragraphs and entities are normalized, repeated section strings are deduplicated, and the 50,000-character cap exposes `descriptionTruncated` and `descriptionOriginalLength`. Metadata summaries expose fallback status, including an ellipsis truncation marker where present.

Images: listing-matched cover metadata → matched embedded cover/gallery or listing-specific JSON-LD → page Open Graph → fallback JSON-LD/Twitter. Candidates are validated without downloads, deduplicated by resolved URL and retain reliable source order. Avatars, logos, tracking images and unsupported URL schemes are excluded.

Fields retain normalized value, raw value, source type, source reference, explicitness and a categorical quality label. Higher-ranked specific sources win. Equal-ranked conflicting scalar candidates cause abstention; disagreements are returned in `conflicts`. Array facts are deduplicated. Description/evidence and normalized-fact payload caps emit warnings rather than silently dropping evidence.

The response remains `{ success: true, data: ... }`. Existing `data.description`, `data.facts`, `data.listingTitle`, `data.listingImage`, `data.imageUrl`, `data.images`, `data.guestCapacity`, `data.amenities` and `data.houseRules` retain their roles. Additive fields include `prices`, `priceStatus`, `bookingContext`, `accommodationType`, `bookingType`, description-limit metadata and conflicts.

Resolved facts are retained in `data.source.normalizedFacts`, covered by the source HMAC. Signing canonicalizes object keys so a shared-Zod parse or JSON key ordering cannot invalidate a legitimate snapshot. Analysis verifies the source before consuming these server-issued facts; client edits to the snapshot are rejected. Older signed sources without snapshots retain their existing re-extraction path. Original listing evidence remains separate from user correction sources.

## Prices, locations and types — verified fixtures

| Source example                                             | Normalized result                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `฿4,862 for 5 nights`                                      | 4862 THB, `stay_total`, 5 nights, no monthly rent                                       |
| `<s>฿6,060</s> ฿4,862 for 5 nights`                        | Current 4862; original 6060 in `originalPrice`; discount present; both retain evidence  |
| Embedded `primaryLine.discountedPrice` and `originalPrice` | Separate current and original records; original never populates Step 2's payable amount |
| `THB 100/night`, `EUR 700/week`, `USD 2000/month`          | Explicit nightly, weekly and monthly bases                                              |
| Cleaning/service/tax/deposit amounts                       | Fee/deposit bases; excluded from payable booking selection                              |
| `€1.250,50`, `1 250,00 €`, `Rp 1.250.000`                  | 1250.50 EUR, 1250 EUR, 1250000 IDR                                                      |
| `$1,250`, `¥10,000`                                        | Amount retained, currency null unless explicit currency evidence disambiguates it       |
| `$1,250 SGD per night`                                     | SGD from adjacent explicit code, without location inference                             |
| Missing/ambiguous/restricted/malformed prices              | `not_in_response` / `ambiguous` / `source_restricted` / `extraction_failed`             |

Explicit booking totals outrank generic unknown-basis amounts. Equal-ranked incompatible amounts cause abstention. Booking dates, duration and guest-count mismatches exclude structured prices. Unit-price currency can inherit from its containing offer. Current prices, original prices and fees remain distinct, and only an unambiguous current monthly claim populates legacy monthly rent.

Location fixtures cover a Bangkok district, Thai village, French city, US city/state, Japanese and Korean Unicode localities, Singapore, country-only and missing locations. The original display string is preserved. Structured address components map independently; locality/region values never become street addresses. No country-to-currency inference occurs in the API.

Accommodation and privacy are separate: `Entire rental unit` → `rental_unit` + `entire_place`; `Private room in farm stay` → `farm_stay` + `private_room`; `Shared room in cabin` → `cabin` + `shared_room`; `Hotel room` → `hotel` + `hotel_room`. The human-readable source classification remains the existing `propertyType` fact; unknown source labels remain intact.

## Live HTTP validation

The complete measurements, URLs, HTTP statuses, timings, counts, missing fields and warnings are in [airbnb-live-validation.json](./airbnb-live-validation.json). These are backend observations, not search snippets or fixtures. The public source can change between requests; the Phang Tru property's current returned title and capacity differed from search-index text, and the backend result below uses only the HTTP response.

| Listing ID          | HTTP | ms   | Returned location                 | Accommodation/privacy      | Beds / bedrooms / baths / capacity | Description chars |
| ------------------- | ---- | ---- | --------------------------------- | -------------------------- | ---------------------------------- | ----------------- |
| 1785549216267209394 | 200  | 933  | Yan Nawa, Bangkok, Thailand       | rental unit / entire place | 2 / 2 / 2 / 3                      | 1895              |
| 1185490404882204860 | 200  | 747  | U Thong, Suphan Buri, Thailand    | farm stay / private room   | 1 / 1 / unavailable / 2            | 1113              |
| 1448378915144939361 | 200  | 987  | Phang Tru, Kanchanaburi, Thailand | farm stay / entire place   | 1 / 1 / 1 / 2                      | 581               |
| 14873609            | 200  | 1655 | Shinjuku, Tokyo Prefecture, Japan | house / private room       | 3 / 1 / unavailable / 3            | 6859              |
| 30299933            | 200  | 918  | Adachi-ku, Japan                  | condominium / private room | 2 / 1 / unavailable / 2            | 5752              |
| 20347135            | 200  | 800  | Shibuya, Japan                    | condominium / private room | 1 / 1 / unavailable / 2            | 4824              |
| 10236905            | 200  | 853  | Ko Samui, Thailand                | house / entire place       | 1 / 1 / 1 / 1                      | 1424              |

All seven returned an image, actual title, description and location. All seven lacked booking prices and verified price currencies. Exact street addresses were unavailable. Some room listings supplied only shared-bathroom text without a numeric bathroom count, so no count was invented. The monthly-discount listing was attempted with booking dates, but the HTTP content did not expose a discounted payable amount; live discount-price extraction is therefore **not verified**. Discount interpretation is verified with synthetic fixtures only.

An earlier request for 14873609 exceeded the existing 1 MB response cap and was rejected with `PAGE_TOO_LARGE`; the independent final validation request received a smaller public representation. No retry loop was added. Successful final samples ranged from 747–1655 ms (median 918 ms); parsing plus candidate resolution took 57–82 ms. These samples do not establish a speed improvement over the previous isolated ~908 ms observation. Source restrictions and render-only prices remain explicit limitations.

## Files changed by this task

- `apps/api/src/services/airbnb.ts`: shared listing-specific parsing, candidate resolution, normalization, provenance and price availability.
- `apps/api/src/services/extraction.ts`: URL-adapter dispatch, shared Airbnb HTML helper, redirect identity checks and HTTP-status telemetry.
- `apps/api/src/services/prices.ts`: localized numbers, ISO currencies, ambiguous symbol handling and tax/fee context.
- `apps/api/src/services/sourceSignature.ts`: integrity coverage and canonical signing for normalized snapshots.
- `apps/api/src/services/evidenceIntegrity.ts`: validated snapshot consumption in analysis.
- `packages/shared/src/schemas/api.ts`: additive normalized metadata, booking context, price statuses, truncation and conflicts.
- `packages/shared/src/schemas/property.ts`: additive price role, discount and fee-inclusion attributes.
- `packages/shared/src/schemas/evidence.ts`: provenance and optional signed normalized facts.
- `apps/api/test/airbnb.test.ts`: deterministic regression matrix, invariants, shared-schema round trips, signing and analysis integration.
- `apps/api/test/fixtures/airbnb-public-structures.json`: public-structure-shaped synthetic fixtures for both observed layouts and Unicode JSON-LD.
- `apps/api/scripts/validateAirbnb.ts`: optional manual live validation, with no network calls in CI.
- `docs/airbnb-live-validation.json`: actual live measurements.
- `docs/airbnb-extraction-engine.md`: this report.

The workspace already contained changes from previous phases; this list describes this task's work rather than every pending Git change.

## Verification and readiness

`npm test`: 148 API tests and 11 frontend review-evidence tests pass, zero failures. The API suite includes shared-Zod round trips and tamper rejection; the shared workspace has no separate test script. Coverage includes extraction hydration/correction submission from the existing frontend suite, both embedded layouts, missing fields, localized prices, discounts, unrelated IDs, partial/malformed JSON, deep nesting, suspicious URLs, redirect identity and existing timeout tests. CI uses fixtures, never live Airbnb requests.

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check` and `git diff --check` pass. Build retains the existing Zod annotation and large-web-chunk warnings.

Step 2 continues consuming the same normalized fields without UI changes. The engine is suitable to freeze as the documented, regression-tested **public-HTTP extraction boundary** before Phase 2 work. This is not a claim of universal Airbnb coverage or verified browser-rendered booking-price extraction. Access-controlled data, prices absent from HTTP, arbitrary future Airbnb schema changes, and oversized responses remain outside guaranteed coverage.

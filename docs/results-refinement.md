# Results refinement — implementation and verification

## Information architecture

Before: overview, two columns with recommendations beneath the evidence card, raw text and claims expanding inside the right column. Source references could repeat complete documents inside findings.

After: overview with honest score/coverage states, compact findings beside a compact evidence summary, one full-width evidence inspector opened on demand, full-width next steps, compact closing CTA. The hero, navbar, illustration, progress bar, shared type system, and entrance choreography were not edited for this refinement.

The inspector is outside the columns. It uses normal page scrolling, moves focus into its labeled region, supports Escape, and restores focus to its trigger when closed. It does not constrain a long document to a fixed-height sidebar.

## Files changed in this refinement

- `apps/web/src/components/report/ReportSections.tsx`: composition, finding content, source-navigation state, overview and recommendations.
- `apps/web/src/components/report/EvidenceSummaryCard.tsx`: source selector, extracted key facts and deliberate evidence controls.
- `apps/web/src/components/report/EvidenceInspector.tsx`: source excerpts/full text, grouped claims and review limits.
- `apps/web/src/components/report/ReportDisclosure.tsx`: accessible button/region accordion with GSAP-owned height and chevron animation.
- `apps/web/src/components/report/ReviewScore.tsx`: numeric, insufficient-evidence and unavailable presentation.
- `apps/web/src/components/report/reviewInsights.ts`: presentation helpers and unintegrated proposed scoring contract.
- `apps/web/src/styles/report.css`: consolidated report styling and responsive composition.
- `apps/web/test/reviewInsights.test.ts`, `apps/web/test/reviewComponents.test.ts`: nine additional unit/component tests.
- `docs/results-scoring-contract.md`: precise proposal and backend inputs for Raymit.
- This verification report.

No shared schema, backend, report mapping, sample fixture, or hero component was changed in this refinement. Existing unrelated workspace edits were retained.

## What is disclosed on demand

- Findings: why it matters, exact fact quotations, referenced-source links and backend recommended actions. A source-level reference links to the inspector rather than repeating an entire document.
- “View source evidence”: selected source quotations with provenance, or full supplied text; the two views replace each other.
- “View all extracted details”: claims grouped into Property, Location, Pricing and Rental terms; missing fields are summarized per group rather than repeated as empty rows. Additional extracted values remain available without repeating quotations.
- “About this review”: backend summary and limitations.

All evidence controls use real buttons, Lucide icons, hover/focus states, `aria-expanded` and a stable `aria-controls` target. Finding accordions start closed and their content is inert while closed. React owns state; GSAP alone owns animated panel height. Reduced motion uses zero-duration accordion transitions and skips inspector entrance motion.

Recommendations preserve backend wording, remove near-identical wording conservatively, and show at most three. No frontend risk points or findings are introduced.

## Height measurements

Measurements use the unchanged three-finding demo, with all disclosures closed, in CSS pixels. These compare this refinement to the implementation at the start of this request, not to the user's fully expanded screenshot.

| Viewport    | Before page height | After page height |    Reduction |
| ----------- | -----------------: | ----------------: | -----------: |
| 1920 × 1080 |               2073 |              1931 |       142 px |
| 1600 × 900  |               2073 |              1931 |       142 px |
| 1440 × 900  |               2122 |              1941 |       181 px |
| 1366 × 768  |              2109* |              1929 | about 180 px |
| 1280 × 800  |               2094 |              1913 |       181 px |

*The baseline at this size was 1365 CSS pixels wide because of the browser's existing zoom. The final verification used exactly 1366 × 768 after temporarily resetting zoom; original viewing settings were restored afterward.

At 1280 × 800, the report content decreased from about 1428 px to 1246 px (about 13%), while adding the score/coverage presentation. The primary expanded-state improvement is structural: arbitrarily long evidence no longer grows the right column or creates a matching empty left column. The demo's default report columns differ by about 25 px in height across all five sizes. No horizontal overflow was detected.

Screenshots and raw dimensions are saved in `/Users/m1ntyx/.codex/visualizations/2026/10/15/01a13eff-fc5e-7933-aef0-74329865ed30/` as `results-refined-{width}.jpg` and `results-height-measurements.json`.

## Scoring and short stays

The existing backend emits a legacy rule-based 0–100 score. Its eligibility and rental-type semantics do not support safely presenting the requested concern index out of 10. Production therefore uses the insufficient/unavailable state and retains original finding counts. The numeric presentation is wired to the backend score after the frontend evidence gate. The alternate proposed contract remains available for a future versioned scoring API.

Explicit short-stay wording or a stay under 30 nights is only a presentation hint. The summary does not assume a monthly rent/deposit or reinterpret booking totals. Original findings and claims remain unchanged and inspectable, with a clear note about unsupported monthly-rental concepts. Backend rental-type-aware extraction/finding rules remain necessary to eliminate inappropriate missing-monthly-rent findings at their source.

See `results-scoring-contract.md` for required inputs, eligibility, provenance, independent concern groups, weighting, versioning and pricing-basis decisions. This is the remaining backend integration boundary; no UI blocker remains.

## Verification

Browser scenarios used the real demo plus a temporary isolated React fixture harness, removed after testing. No production fallback or route was added for test data.

Passed:

- Five requested desktop viewports, no horizontal overflow, compact closed evidence controls, unchanged shell.
- Single finding, multiple findings and no-findings neutral state.
- One source, multiple sources and unresolved source references.
- Insufficient evidence and unavailable production score; approved-contract numeric display covered by unit/component tests only.
- Enter/Space finding activation, evidence expansion, full-text switching, Escape closing and focus restoration.
- Grouped missing claims; full-width inspector matches report width.
- Reduced-motion preference simulated in the isolated harness: no entrance tween, immediate panel height/opacity and chevron final state.
- Direct `/results` fallback and closing CTA both navigate to `/check?new=1` with an empty URL field.
- Clean final page load: no browser console errors. Transient HMR errors during an intermediate export move were resolved before final checks.

Commands:

- `npm run lint`: passed, no warnings.
- `npm run typecheck`: passed across shared/API/web.
- `npm run build`: passed; existing dependency annotation and bundle-size warnings remain.
- `TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test apps/web/test/*.test.ts`: 15 passed.
- Prettier formatting/checks on changed implementation, tests and documents: passed.

Live property extraction and live analysis were not rerun. The actual screenshot's five-night booking was not available as retained route state, so short-stay behavior was exercised with explicitly fictional test inputs, not presented as a new verification of that property.

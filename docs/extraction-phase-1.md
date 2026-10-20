# Phase 1 extraction contract

Extraction remains deterministic and requires no external AI credentials. Existing `/api/extract/text`, `/api/extract/url`, `/api/extract/file` envelopes and legacy scalar fields remain compatible. No frontend change is required.

## Prices

`PriceRecordSchema` in `packages/shared/src/schemas/property.ts` defines:

```ts
type PriceRecord = {
  amount: number;
  currency: string | null;
  rawCurrency: string | null;
  rawText: string;
  basis:
    | 'monthly_rent'
    | 'nightly_rate'
    | 'weekly_rate'
    | 'stay_total'
    | 'deposit'
    | 'cleaning_fee'
    | 'service_fee'
    | 'other_fee'
    | 'unknown';
  basisExplicit: boolean;
  nights?: number;
};
```

Every price is an ordinary `ExtractedFact` with `fieldName: 'price'`, `normalizedValue: PriceRecord`, an exact `quotedEvidence` substring of its source's extracted text, `sourceId`, `textLocation`, optional PDF page number and optional `extractionMethod` (`text`, `json_ld`, `metadata`). Fact IDs and source IDs retain the existing per-extraction identity convention.

Analysis adds optional `propertyFacts.prices: PriceRecord[]`. The evidence-bearing fact array remains the authoritative source for provenance. Existing nullable fields (`listingTitle`, `propertyType`, `location`, `address`, `monthlyRent`, `currency`, `depositAmount`, `bedroomCount`, `bathroomCount`, `listingUrl`) remain. Explicit monthly ranges retain the existing optional `monthlyRentRange`.

Only unambiguous explicit monthly prices populate `monthlyRent` and `currency`. An unknown period, nightly rate or stay total never populates monthly rent. Multiple monthly claims with different amounts or currencies remain in the price records and leave the legacy monthly scalar missing. `$` alone remains unknown currency; no conversions occur.

Other explicit facts use existing open-ended `ExtractedFact.fieldName`: `bedCount`, `maxGuests`, `areaSquareMeters`, `hostName`, `houseRule`, `country`, `city`, `locality`, `postalCode`. Payment and lease facts retain their existing representation.

## Source precedence and disagreements

Visible page text is processed first, then metadata descriptions, then JSON-LD. A generic structured price with the same amount and currency as an explicit price is refined by that explicit billing basis. Different amounts, currencies or explicit billing categories remain separate claims. JSON-LD `unitText`, `unitCode` and `priceType` accept only supported explicit units (month/MON, night, week/WEE); offer currency is inherited by nested price specifications. Dates and check-in/check-out times never establish billing periods. JSON-LD is retained as canonical JSON in a marked source section, with quotations referencing that section rather than fabricated visible prose.

Geographic locality does not establish a street address or independent verification. No geographic lookup is performed. Unknown facts remain missing.

## Limits

This is a conservative explicit-fact parser, not universal language understanding. It supports the required narrow Thai pricing syntax, common currency/period formats and explicit structured units. Dates are preserved in source content rather than normalized as a booking-date model. Host/rules and geographic component parsing are intentionally limited to explicit patterns; building and unit names are not inferred. Dynamic or blocked websites may require pasted text or existing file extraction. Hidden CSS content and unrelated recommendation sections cannot always be distinguished without site-specific adapters. Existing fetched content is capped at 20,000 characters. No claims of independent property/address verification are made.

Phase 2 can consume the evidence-bearing facts and structured prices; request trust, evidence validation and secure analysis contracts remain Phase 2 work.

# Phase 2 evidence integrity

`POST /api/analyze` validates unique source IDs, requires each source to carry an API HMAC, rejects modified or unsigned source payloads, and verifies fact source references and quotations. It re-runs deterministic extraction against the source content and uses only server-derived facts for property details, comparisons and scoring. Submitted facts that do not match a server-derived field and value are excluded and returned in `evidenceDiagnostics` with a fact ID and reason. Duplicate source IDs and invalid source signatures are rejected with structured error details.

Extraction endpoints sign a canonical tuple of source ID, type, name, URL, extracted content and status. Production deployments must set `EVIDENCE_SIGNING_SECRET` to a stable secret of at least 32 characters and share it across API instances. Local development and tests use a process-local random key. Submit manual property details, corrections and renter-provided messages through `/api/extract/text` to obtain signed source records and deterministic facts.

JSON-LD evidence is accepted only when its exact serialized JSON object is present in the marked structured-data section and the server extractor derives the same field and value from it. Metadata has the same content binding. A pasted or manually submitted source remains a statement supplied by the user; a signature proves that the API processed that content, not that its claims are independently true.

Monetary comparisons require matching explicit billing basis and currency. Stay totals also require a matching known number of nights and, when both source URLs provide check-in/check-out dates, the same date range; unknown duration totals and incomplete date ranges are not compared. Location claims compare only at the same normalized field level. Missing address or landlord details produce unable-to-verify findings, not fraud claims. Payment warnings cite source text and suppress directly negated instructions.

Findings can include `referencedFactIds` while retaining the existing `referencedEvidence` source IDs. Analysis responses include optional `evidenceDiagnostics`; the existing response envelope and property fields remain available.

Limitations: deterministic extraction recognizes supported explicit patterns and cannot establish the truth of pasted material, identify a real landlord from a name alone, or independently verify legal ownership. The risk score remains a heuristic signal and does not represent scam probability.

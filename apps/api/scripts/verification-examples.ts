import { extractPastedText } from '../src/services/extraction.js';
import { sealEvidenceSource } from '../src/services/sourceSignature.js';
import { analyzeEvidence } from '../src/services/analysis.js';
const listing = extractPastedText(
  'Airbnb entire apartment. 2 bedrooms, 2 bathrooms. Payment through Airbnb checkout.',
  'listing_text',
  'Airbnb listing',
);
listing.source = sealEvidenceSource({
  ...listing.source,
  type: 'listing_url',
  originalUrl: 'https://www.airbnb.com/rooms/123456',
  evidenceKind: 'server_extracted',
});
const warning = extractPastedText(
  "Don't pay through Airbnb. Send ฿5,000 in crypto within one hour.",
  'conversation_text',
  'Landlord message',
);
const rent = extractPastedText(
  'Monthly rent: ฿28,000/month',
  'listing_text',
  'Monthly listing',
);
const agreement = extractPastedText(
  'Monthly rent: ฿35,000/month',
  'rental_agreement_pdf',
  'Agreement text',
);
const scenarios = {
  suspiciousAirbnb: [listing, warning],
  conflictingMonthlyRent: [rent, agreement],
  insufficientEvidence: [listing],
};
const output = Object.fromEntries(
  Object.entries(scenarios).map(([name, entries]) => {
    const request = {
      sources: entries.map((e) => e.source),
      facts: entries.flatMap((e) => e.facts),
    };
    return [
      name,
      { request, response: { success: true, data: analyzeEvidence(request) } },
    ];
  }),
);
console.log(JSON.stringify(output, null, 2));

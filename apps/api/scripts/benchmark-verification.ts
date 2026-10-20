import {
  analyzeEvidence,
  type AnalysisDiagnostics,
} from '../src/services/analysis.js';
import { extractPastedText } from '../src/services/extraction.js';
const sources = Array.from({ length: 12 }, (_, i) =>
  extractPastedText(
    i === 0
      ? 'Monthly rent: THB 28000/month.\nAddress: 195 Sukhumvit Soi 5, Bangkok\n2 bedrooms, 2 bathrooms\n' +
          'Published rental information and amenities.\n'.repeat(70)
      : `Monthly rent: THB ${i === 11 ? 35000 : 28000}/month.\n` +
          (i === 1
            ? "Don't pay through Airbnb. Send ฿5,000 in crypto within one hour.\n"
            : 'Please review the written terms and arrange a viewing before payment.\n') +
          'We can answer questions about the written terms.\n'.repeat(60),
    i === 0
      ? 'listing_text'
      : i === 11
        ? 'rental_agreement_pdf'
        : 'conversation_text',
    `Benchmark source ${i}`,
  ),
);
const input = {
  sources: sources.map((s) => s.source),
  facts: sources.flatMap((s) => s.facts),
};
for (let i = 0; i < 10; i++) analyzeEvidence(input);
const samples: AnalysisDiagnostics[] = [];
for (let i = 0; i < 50; i++)
  analyzeEvidence(input, [], 'off', (d) => samples.push(d));
const metrics = Object.fromEntries(
  Object.keys(samples[0]!.durationsMs).map((key) => {
    const values = samples
      .map(
        (s) => s.durationsMs[key as keyof AnalysisDiagnostics['durationsMs']],
      )
      .sort((a, b) => a - b);
    return [
      key,
      {
        medianMs: Number(values[Math.floor(values.length / 2)]!.toFixed(3)),
        p95Ms: Number(values[Math.ceil(values.length * 0.95) - 1]!.toFixed(3)),
      },
    ];
  }),
);
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      sampleCount: samples.length,
      warmupCount: 10,
      sourceCount: input.sources.length,
      requestBytes: Buffer.byteLength(JSON.stringify(input)),
      claimCount: samples[0]!.claimCount,
      comparisonCount: samples[0]!.comparisonCount,
      ai: 'off; no network calls',
      metrics,
    },
    null,
    2,
  ),
);

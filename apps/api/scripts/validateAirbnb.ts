/** Optional manual validation. CI uses fixtures and never calls Airbnb. */
import { writeFile } from 'node:fs/promises';
import { ExtractionResponseSchema } from '@sniffo/shared';
import { extractListingUrl, readPage } from '../src/services/extraction.js';
const urls = process.argv.slice(2);
if (!urls.length)
  throw new Error('Pass public Airbnb listing URLs as arguments.');
const results = [];
for (const url of urls) {
  let status: number | null = null;
  const start = performance.now();
  try {
    const data = await extractListingUrl(url, {
      fetchPage: async (...args) => {
        let page;
        try {
          page = await readPage(...args);
        } finally {
          status = args[2]?.httpStatus ?? status;
        }
        status = page.status ?? null;
        // Optional raw response capture is local diagnostic data, never a production fallback.
        if (process.env.AIRBNB_DIAGNOSTIC_DIR)
          await writeFile(
            `${process.env.AIRBNB_DIAGNOSTIC_DIR}/${new URL(url).pathname.split('/').at(-1)}.html`,
            page.body,
          );
        return page;
      },
    });
    ExtractionResponseSchema.parse({ success: true, data });
    const fields = Object.fromEntries(
      data.facts.map((f) => [f.fieldName, f.normalizedValue]),
    );
    const report = {
      url,
      status,
      durationMs: Math.round(data.extractionDurationMs),
      timings: data.timings,
      title: data.listingTitle,
      location: fields.location ?? null,
      accommodation:
        'accommodationType' in data ? data.accommodationType : null,
      bookingType: 'bookingType' in data ? data.bookingType : null,
      image: Boolean(data.imageUrl),
      descriptionCharacters: data.description?.length ?? 0,
      bedrooms: fields.bedroomCount ?? null,
      beds: fields.bedCount ?? null,
      bathrooms: fields.bathroomCount ?? null,
      capacity: data.guestCapacity,
      currency: fields.currency ?? null,
      prices: data.facts
        .filter((f) => f.fieldName === 'price')
        .map((f) => f.normalizedValue),
      priceStatus: 'priceStatus' in data ? data.priceStatus : null,
      missing: [
        'address',
        'hostName',
        'amenity',
        'price',
        'location',
        'bedroomCount',
        'bedCount',
        'bathroomCount',
        'maxGuests',
      ].filter((field) => !(field in fields)),
      warnings: data.extractionWarnings,
    };
    results.push(report);
    console.log(JSON.stringify(report));
  } catch (error) {
    const failure = error as Error & { code?: string; status?: number };
    const report = {
      url,
      status:
        status ??
        /HTTP (\d+)/.exec(failure.message)?.[1] ??
        ([403, 429].includes(failure.status ?? 0) ? failure.status : null),
      durationMs: Math.round(performance.now() - start),
      code: failure.code,
      error: failure.message,
    };
    results.push(report);
    console.log(JSON.stringify(report));
  }
}
if (process.env.AIRBNB_REPORT_PATH)
  await writeFile(
    process.env.AIRBNB_REPORT_PATH,
    JSON.stringify(results, null, 2) + '\n',
  );

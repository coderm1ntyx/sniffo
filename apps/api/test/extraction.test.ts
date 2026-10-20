import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ExtractionResponseSchema,
  AnalysisResultSchema,
  PriceRecordSchema,
} from '@sniffo/shared';
import {
  extractListingUrl,
  extractPastedText,
  htmlToText,
} from '../src/services/extraction.js';
import { extractPrices } from '../src/services/prices.js';
import { analyzeEvidence } from '../src/services/analysis.js';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/extraction.json', import.meta.url), 'utf8'),
) as Array<{
  name: string;
  text?: string;
  html?: string;
  basis?: string;
  amount?: number;
  currency?: string;
  bedroomCount?: number;
}>;
for (const fixture of fixtures)
  test(`fixture ${fixture.name}`, () => {
    const parsed = fixture.html
      ? htmlToText(fixture.html)
      : { text: fixture.text!, title: null };
    const data = extractPastedText(parsed.text, 'listing_text', fixture.name);
    ExtractionResponseSchema.parse({ success: true, data });
    const values = (field: string) =>
      data.facts
        .filter((fact) => fact.fieldName === field)
        .map((fact) => fact.normalizedValue);
    const prices = values('price').map((value) =>
      PriceRecordSchema.parse(value),
    );
    if (fixture.basis)
      assert.ok(
        prices.some(
          (price) =>
            price.basis === fixture.basis &&
            price.amount === fixture.amount &&
            price.currency === fixture.currency,
        ),
        JSON.stringify(prices),
      );
    else assert.equal(prices.length, 0);
    if (fixture.basis !== 'monthly_rent')
      assert.deepEqual(values('monthlyRent'), []);
    if (fixture.bedroomCount)
      assert.deepEqual(values('bedroomCount'), [fixture.bedroomCount]);
    else assert.deepEqual(values('bedroomCount'), []);
    assert.deepEqual(values('address'), []);
    for (const fact of data.facts) {
      assert.equal(fact.sourceId, data.source.id);
      assert.ok(
        data.source.extractedText!.includes(fact.quotedEvidence),
        fact.quotedEvidence,
      );
    }
    const result = analyzeEvidence({
      sources: [data.source],
      facts: data.facts,
    });
    AnalysisResultSchema.parse(result);
    if (fixture.name.startsWith('A')) {
      assert.equal(prices[0]?.nights, 5);
      assert.equal(result.propertyFacts.monthlyRent, null);
      assert.equal(result.propertyFacts.depositAmount, null);
      assert.deepEqual(values('maxGuests'), [3]);
      assert.deepEqual(values('bedCount'), [2]);
      assert.deepEqual(values('bathroomCount'), [2]);
      assert.deepEqual(values('hostName'), ['Krit']);
      assert.deepEqual(values('houseRule'), ['No cooking in the room']);
    }
    if (/^[BH]/.test(fixture.name))
      assert.deepEqual(values('depositAmount'), [56000]);
    if (fixture.name.startsWith('B'))
      assert.deepEqual(values('areaSquareMeters'), [85]);
    if (fixture.name.startsWith('D')) assert.equal(prices.length, 1);
  });

for (const [text, basis, amount, currency] of [
  ['฿28,000/month', 'monthly_rent', 28000, 'THB'],
  ['28,000 THB per month', 'monthly_rent', 28000, 'THB'],
  ['THB 28,000 / mo', 'monthly_rent', 28000, 'THB'],
  ['Monthly rent: 28,000 baht', 'monthly_rent', 28000, 'THB'],
  ['฿1,500/night', 'nightly_rate', 1500, 'THB'],
  ['฿11,886 for 5 nights', 'stay_total', 11886, 'THB'],
  ['Total for 5 nights: ฿11,886', 'stay_total', 11886, 'THB'],
  ['฿7,000/week', 'weekly_rate', 7000, 'THB'],
  ['฿1,500 par nuit', 'nightly_rate', 1500, 'THB'],
  ['฿700 por semana', 'weekly_rate', 700, 'THB'],
  ['฿28,000 pro Monat', 'monthly_rent', 28000, 'THB'],
  ['฿4,742 for 2 nuits', 'stay_total', 4742, 'THB'],
  ['Security deposit: ฿56,000', 'deposit', 56000, 'THB'],
  ['Cleaning fee: ฿900', 'cleaning_fee', 900, 'THB'],
  ['Service fee: ฿900', 'service_fee', 900, 'THB'],
  ['฿28,000', 'unknown', 28000, 'THB'],
  ['28 000 THB', 'unknown', 28000, 'THB'],
  ['28,000.00 THB', 'unknown', 28000, 'THB'],
  ['28,000฿', 'unknown', 28000, 'THB'],
  ['$900/month', 'monthly_rent', 900, null],
  ['US$900/month', 'monthly_rent', 900, 'USD'],
  ['S$900/month', 'monthly_rent', 900, 'SGD'],
  ['€900/month', 'monthly_rent', 900, 'EUR'],
  ['£900/month', 'monthly_rent', 900, 'GBP'],
] as const)
  test(`price ${text}`, () => {
    const prices = extractPrices(text);
    assert.equal(prices.length, 1);
    assert.equal(prices[0]?.price.basis, basis);
    assert.equal(prices[0]?.price.amount, amount);
    assert.equal(prices[0]?.price.currency, currency);
    if (basis !== 'monthly_rent')
      assert.ok(
        !extractPastedText(text, 'listing_text', 'test').facts.some(
          (fact) => fact.fieldName === 'monthlyRent',
        ),
      );
  });

test('explicit Thai baht symbol is retained as currency evidence without a parsed amount', () => {
  const data = extractPastedText(
    'Available price: ฿ shown on listing',
    'listing_text',
    'Baht listing',
  );
  const currency = data.facts.find((fact) => fact.fieldName === 'currency');
  assert.equal(currency?.normalizedValue, 'THB');
  assert.equal(currency?.quotedEvidence, '฿');
});
test('separate unknown rent, deposit and unsupported prices', () => {
  const prices = extractPrices('Rent 28,000, deposit 56,000');
  assert.deepEqual(
    prices.map((item) => [item.price.amount, item.price.basis]),
    [
      [28000, 'unknown'],
      [56000, 'deposit'],
    ],
  );
  assert.deepEqual(extractPrices('Price upon request'), []);
});
test('locations remain conservative and full address preserves postal code', () => {
  const facts = extractPastedText(
    'Entire rental unit in Yan Nawa, Thailand',
    'listing_text',
    'test',
  ).facts;
  assert.ok(
    !facts.some((fact) => ['city', 'address'].includes(fact.fieldName)),
  );
  const address = extractPastedText(
    '18 Sukhumvit Soi 21, Watthana, Bangkok 10110',
    'listing_text',
    'test',
  ).facts;
  assert.ok(
    address.some(
      (fact) =>
        fact.fieldName === 'address' &&
        fact.normalizedValue === '18 Sukhumvit Soi 21, Watthana, Bangkok 10110',
    ),
  );
});

test('labelled bedroom and bathroom counts stay on their own lines', () => {
  const facts = extractPastedText(
    'Bedrooms: 2\nBathrooms: 1',
    'listing_text',
    'Manual property details',
  ).facts;
  assert.equal(
    facts.find((fact) => fact.fieldName === 'bedroomCount')?.normalizedValue,
    2,
  );
  assert.equal(
    facts.find((fact) => fact.fieldName === 'bathroomCount')?.normalizedValue,
    1,
  );
});

test('listing image extraction prefers metadata and resolves relative URLs', () => {
  const parsed = htmlToText(
    '<html><head><meta property="og:image" content="/photos/home.jpg"><meta name="twitter:image" content="https://cdn.example/home-2.jpg"></head><body>Readable listing details here.</body></html>',
    'https://rent.example/listing/1',
  );
  assert.deepEqual(parsed.image, {
    url: 'https://rent.example/photos/home.jpg',
    source: 'og:image',
    extractionMethod: 'metadata',
  });
});
test('listing image extraction reads JSON-LD when social metadata is absent', () => {
  const parsed = htmlToText(
    '<script type="application/ld+json">{"@type":"Apartment","image":["/home.jpg"]}</script><body>Readable listing details here.</body>',
    'https://rent.example/listing/1',
  );
  assert.deepEqual(parsed.image, {
    url: 'https://rent.example/home.jpg',
    source: 'json_ld',
    extractionMethod: 'json_ld',
  });
});
test('listing image extraction rejects unsafe, branding, and absent images', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    '/assets/logo.png',
    'https://site.example/tracking-pixel.gif',
  ]) {
    const parsed = htmlToText(
      `<meta property="og:image" content="${value}"><body>Readable listing details here.</body>`,
      'https://rent.example/listing/1',
    );
    assert.equal(parsed.image, undefined, value);
  }
  assert.equal(
    htmlToText(
      '<body>Readable listing details here.</body>',
      'https://rent.example/listing/1',
    ).image,
    undefined,
  );
});

test('listing title beats generic SEO title and full metadata description is normalized', () => {
  const parsed = htmlToText(
    `<html><head><title>Rental unit in Yan Nawa · ★5.0 · Airbnb</title><meta property="og:title" content="Rental unit in Yan Nawa · ★5.0 · Airbnb"><meta property="og:description" content="About this space\\nEnjoy a superb design &amp; facilities."><link rel="canonical" href="/rooms/123"></head><body><h1>Luxury 2 bedroom - Infinity Pool - Gym</h1><p>3 guests, 2 bedrooms, 2 beds, 2 bathrooms</p></body></html>`,
    'https://www.airbnb.com/rooms/123',
  );
  assert.equal(parsed.listingTitle, 'Luxury 2 bedroom - Infinity Pool - Gym');
  assert.equal(parsed.titleIsFallback, false);
  assert.equal(
    parsed.description,
    'About this space\nEnjoy a superb design & facilities.',
  );
  assert.equal(parsed.canonicalUrl, 'https://www.airbnb.com/rooms/123');
  const facts = extractPastedText(parsed.text, 'listing_text', 'fixture').facts;
  assert.deepEqual(
    facts.find((fact) => fact.fieldName === 'bedroomCount')?.normalizedValue,
    2,
  );
  assert.deepEqual(
    facts.find((fact) => fact.fieldName === 'bedCount')?.normalizedValue,
    2,
  );
  assert.deepEqual(
    facts.find((fact) => fact.fieldName === 'bathroomCount')?.normalizedValue,
    2,
  );
});

test('generic SEO title is exposed only as a fallback', () => {
  const parsed = htmlToText(
    '<title>Rental unit in Yan Nawa · ★5.0 · 2 bedrooms · Airbnb</title><body><p>Listing information is available here.</p></body>',
    'https://www.airbnb.com/rooms/123',
  );
  assert.equal(parsed.listingTitle, null);
  assert.equal(parsed.titleIsFallback, true);
  assert.match(parsed.title ?? '', /^Rental unit in Yan Nawa/);
});

test('Airbnb response fixture extracts title, description, image gallery, counts and unassumed price basis', async () => {
  const body = readFileSync(
    new URL('./fixtures/airbnb-listing.html', import.meta.url),
    'utf8',
  );
  const result = await extractListingUrl(
    'https://www.airbnb.com/rooms/123456789',
    {
      fetchPage: async () => ({
        body,
        contentType: 'text/html',
        url: new URL('https://www.airbnb.com/rooms/123456789'),
      }),
    },
  );
  assert.equal(result.listingId, '123456789');
  assert.equal(result.listingTitle, 'Luxury 2 bedroom - Infinity Pool - Gym');
  assert.equal(result.titleIsFallback, false);
  assert.match(result.description ?? '', /Sathu Pradit\/Yan Nawa/);
  assert.match(result.description ?? '', /Reception hours: 8:00 AM–10:00 PM/);
  assert.equal(result.hostName, 'Krit');
  assert.equal(result.guestCapacity, 3);
  assert.deepEqual(result.amenities, [
    'Rooftop infinity pool',
    'Fitness center',
  ]);
  assert.deepEqual(result.houseRules, ['No cooking in the room.']);
  assert.equal(
    result.imageUrl,
    'https://www.airbnb.com/images/listing-main.jpg',
  );
  assert.equal(result.images.length, 3);
  const prices = result.facts
    .filter((fact) => fact.fieldName === 'price')
    .map((fact) => PriceRecordSchema.parse(fact.normalizedValue));
  assert.ok(
    prices.some(
      (price) =>
        price.amount === 11886 &&
        price.basis === 'stay_total' &&
        price.nights === 5,
    ),
  );
  assert.ok(!result.facts.some((fact) => fact.fieldName === 'monthlyRent'));
  assert.ok(result.facts.some((fact) => fact.fieldName === 'description'));
  ExtractionResponseSchema.parse({ success: true, data: result });
});

test('Airbnb public embedded listing data is scoped to the requested listing ID', () => {
  const body = `<script type="application/json">${JSON.stringify({
    niobeClientData: [
      [
        'query',
        {
          data: {
            presentation: {
              stayProductDetailPage: {
                sections: {
                  metadata: {
                    sharingConfig: {
                      title:
                        'Rental unit in Yan Nawa · 2 bedrooms · 2 beds · 2 baths',
                    },
                  },
                  sections: [
                    {
                      section: {
                        shareSave: {
                          embedData: {
                            id: '1785549216267209394',
                            name: 'Luxury 2 bedroom - Infinity Pool - Gym',
                            personCapacity: 3,
                            propertyType: 'Entire rental unit',
                            pictureUrl: 'https://images.example/main.jpg',
                          },
                        },
                      },
                    },
                    {
                      section: {
                        __typename: 'GeneralListContentSection',
                        items: [
                          {
                            title: 'About this space',
                            html: {
                              htmlText:
                                'Enjoy &amp; stay<br/><br/>Rama 3, Bangkok.',
                            },
                          },
                        ],
                      },
                    },
                    {
                      section: {
                        __typename: 'PhotoTourModalSection',
                        mediaItems: [
                          { baseUrl: 'https://images.example/extra.jpg' },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    ],
  })}</script><body><p>Server returned readable listing information.</p></body>`;
  const parsed = htmlToText(
    body,
    'https://www.airbnb.com/rooms/1785549216267209394',
  );
  assert.equal(parsed.listingTitle, 'Luxury 2 bedroom - Infinity Pool - Gym');
  assert.equal(parsed.guestCapacity, 3);
  assert.equal(parsed.descriptionSource, 'airbnb_public_data');
  assert.match(parsed.description ?? '', /Enjoy & stay\n\nRama 3, Bangkok\./);
  assert.match(parsed.text, /2 bedrooms · 2 beds · 2 baths/);
  const extracted = extractPastedText(
    parsed.text,
    'listing_text',
    'Embedded Airbnb details',
  );
  const guestFact = extracted.facts.find(
    (fact) => fact.fieldName === 'maxGuests',
  );
  assert.equal(guestFact?.normalizedValue, 3);
  assert.ok(
    extracted.source.extractedText?.includes(guestFact!.quotedEvidence),
  );
  assert.deepEqual(parsed.images, [
    'https://images.example/main.jpg',
    'https://images.example/extra.jpg',
  ]);

  const wrongListing = htmlToText(
    body,
    'https://www.airbnb.com/rooms/999999999999999999',
  );
  assert.equal(wrongListing.listingTitle, null);
  assert.equal(wrongListing.description, null);
  assert.deepEqual(wrongListing.images, []);
});

test('URL extraction measures mocked fetch and keeps existing response contract', async () => {
  const started = performance.now();
  const result = await extractListingUrl('https://listing.example/rooms/1', {
    fetchPage: async (_url, _redirects, timings) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (timings) {
        timings.dnsMs += 4;
        timings.httpMs += 20;
        timings.payloadBytes += 96;
      }
      return {
        body: '<html><head><meta property="og:title" content="Cozy apartment"></head><body><h1>Cozy apartment</h1><p>Listing has readable details.</p></body></html>',
        contentType: 'text/html',
        url: new URL('https://listing.example/rooms/1'),
      };
    },
  });
  const elapsed = performance.now() - started;
  assert.ok(result.extractionDurationMs >= 20);
  assert.ok(elapsed >= result.extractionDurationMs);
  assert.equal(result.timings.dnsMs, 4);
  assert.equal(result.timings.httpMs, 20);
  assert.equal(result.timings.payloadBytes, 96);
  assert.equal(result.listingTitle, 'Cozy apartment');
  assert.equal(result.description, null);
  ExtractionResponseSchema.parse({ success: true, data: result });
});

test('URL extraction keeps currency and booking context without guessing missing price fields', async () => {
  const started = performance.now();
  const result = await extractListingUrl(
    'https://listing.example/rooms/2?check_in=2026-10-16&check_out=2026-10-18&currency=THB',
    {
      fetchPage: async (url) => ({
        body: '<html><head><title>Quiet apartment</title><meta name="description" content="A bright apartment near the river."></head><body><h1>Quiet apartment</h1><p>Two bedrooms, one bathroom, close to transit.</p></body></html>',
        contentType: 'text/html',
        url,
      }),
    },
  );

  assert.ok(performance.now() - started < 250);
  assert.equal(result.listingTitle, 'Quiet apartment');
  assert.equal(result.description, 'A bright apartment near the river.');
  assert.deepEqual(result.prices, []);
  assert.equal(result.currency, 'THB');
  assert.equal(result.priceBasis, null);
  assert.equal(result.bookingContext?.nights, 2);
  ExtractionResponseSchema.parse({ success: true, data: result });
});

test('URL extraction keeps explicit structured price evidence on the fast HTTP path', async () => {
  const result = await extractListingUrl('https://listing.example/rooms/3', {
    fetchPage: async (url) => ({
      body: '<html><head><title>River apartment</title><script type="application/ld+json">{"@type":"Apartment","offers":{"price":28000,"priceCurrency":"THB","priceSpecification":{"@type":"UnitPriceSpecification","price":28000,"unitCode":"MON"}}}</script></head><body><h1>River apartment</h1><p>Two bedroom apartment available for rent in Bangkok.</p></body></html>',
      contentType: 'text/html',
      url,
    }),
  });

  assert.equal(result.currency, 'THB');
  assert.equal(result.priceBasis, 'monthly_rent');
  assert.ok(
    result.prices.some(
      (price) => price.amount === 28000 && price.basis === 'monthly_rent',
    ),
  );
});

test('URL extraction fails promptly when a mocked response exceeds the time budget', async () => {
  await assert.rejects(
    extractListingUrl('https://listing.example/slow', {
      budgetMs: 15,
      fetchPage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          body: '<html><body>This response arrived too late to use.</body></html>',
          contentType: 'text/html',
          url: new URL('https://listing.example/slow'),
        };
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'FETCH_TIMEOUT',
  );
});
test('structured generic offers and conflicting prices preserve original evidence', () => {
  const parsed = htmlToText(
    '<script type="application/ld+json">{"@type":"Apartment","offers":{"price":12000,"priceCurrency":"USD"}}</script><p>฿11,886 for 5 nights</p>',
  );
  const data = extractPastedText(parsed.text, 'listing_text', 'test');
  const prices = data.facts.filter((fact) => fact.fieldName === 'price');
  assert.equal(prices.length, 2);
  assert.ok(
    prices.some(
      (fact) =>
        PriceRecordSchema.parse(fact.normalizedValue).basis === 'unknown' &&
        fact.extractionMethod === 'json_ld',
    ),
  );
  assert.ok(
    prices.every((fact) =>
      data.source.extractedText!.includes(fact.quotedEvidence),
    ),
  );
});

test('UnitPriceSpecification supports explicit units and inherited currency across multiple scripts', () => {
  const parsed = htmlToText(
    '<script type="application/ld+json">{"@type":"WebPage"}</script><script type="application/ld+json">{"@type":"Apartment","offers":{"price":28000,"priceCurrency":"THB","priceSpecification":{"@type":"UnitPriceSpecification","price":28000,"unitCode":"MON"}}}</script>',
  );
  const data = extractPastedText(parsed.text, 'listing_text', 'test');
  const prices = data.facts
    .filter((fact) => fact.fieldName === 'price')
    .map((fact) => PriceRecordSchema.parse(fact.normalizedValue));
  assert.equal(prices.length, 1);
  assert.equal(prices[0]?.basis, 'monthly_rent');
  assert.equal(prices[0]?.currency, 'THB');
});
test('mixed monthly currencies do not populate misleading scalar rent', () => {
  const data = extractPastedText(
    'Monthly rent: USD 900\nMonthly rent: THB 28000',
    'listing_text',
    'test',
  );
  assert.equal(
    data.facts.filter((fact) => fact.fieldName === 'price').length,
    2,
  );
  assert.ok(!data.facts.some((fact) => fact.fieldName === 'monthlyRent'));
});
test('text extraction and analysis HTTP endpoints retain valid contracts', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/api/extract/text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: fixtures[0]!.text }),
    });
    assert.equal(response.status, 200);
    const { data } = ExtractionResponseSchema.parse(await response.json());
    const analysis = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [data.source], facts: data.facts }),
    });
    assert.equal(analysis.status, 200);
    const body = (await analysis.json()) as { data: unknown };
    const result = AnalysisResultSchema.parse(body.data);
    assert.equal(result.propertyFacts.monthlyRent, null);
    assert.equal(result.propertyFacts.prices?.[0]?.basis, 'stay_total');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('adjacent billing periods stay local and contradictory periods remain unknown', () => {
  assert.deepEqual(
    extractPrices('฿28000/month USD900/night').map((item) => item.price.basis),
    ['monthly_rent', 'nightly_rate'],
  );
  assert.equal(
    extractPrices('Monthly rent: ฿1500/night')[0]?.price.basis,
    'unknown',
  );
});

test('structured listing locality is not promoted to a street address or polluted from serialized JSON', () => {
  const parsed = htmlToText(
    '<meta property="og:title" content="Rental unit in Yan Nawa · ★5.0 · 2 bedrooms"><script type="application/ld+json">{"@type":"VacationRental","address":{"addressLocality":"Yan Nawa"}}</script>',
  );
  const data = extractPastedText(parsed.text, 'listing_text', 'Airbnb');
  const fields = data.facts.map((fact) => fact.fieldName);
  assert.ok(fields.includes('locality'));
  assert.ok(!fields.includes('address'));
  assert.ok(
    !fields.includes('bedroomCount'),
    'title metadata alone does not supply bedroom count',
  );
  assert.ok(
    !data.facts.some(
      (fact) =>
        fact.fieldName === 'location' &&
        String(fact.normalizedValue).includes('aggregateRating'),
    ),
  );
});

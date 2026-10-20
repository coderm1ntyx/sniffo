import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtractionResponseSchema, PriceRecordSchema } from '@sniffo/shared';
import { extractListingUrl } from '../src/services/extraction.js';
import { extractAirbnb, airbnbListingId } from '../src/services/airbnb.js';
import { extractPrices, normalizeCurrency } from '../src/services/prices.js';
import { validateAnalysisEvidence } from '../src/services/evidenceIntegrity.js';
import { verifyEvidenceSource } from '../src/services/sourceSignature.js';

const url = new URL(
  'https://www.airbnb.com/rooms/123?check_in=2026-10-17&check_out=2026-10-22&adults=1&children=1&infants=1',
);
const ld = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const embedded = (obj: unknown) =>
  `<script type="application/json">${JSON.stringify(obj)}</script>`;
const listing = (extra: Record<string, unknown> = {}) => ({
  '@type': 'VacationRental',
  url: 'https://www.airbnb.com/rooms/123',
  name: 'Quiet home 🦊 / 森',
  ...extra,
});
const extract = (html: string, input = url) =>
  extractAirbnb(html, input, input);
const value = (data: ReturnType<typeof extract>, field: string) =>
  data.facts.find((f) => f.fieldName === field)?.normalizedValue;

for (const [label, accommodation, privacy] of [
  ['Apartment', 'apartment', null],
  ['Entire rental unit', 'rental_unit', 'entire_place'],
  ['Private room in farm stay', 'farm_stay', 'private_room'],
  ['Shared room in cabin', 'cabin', 'shared_room'],
  ['Entire villa', 'villa', 'entire_place'],
  ['Entire guesthouse', 'guesthouse', 'entire_place'],
  ['Hotel room', 'hotel', 'hotel_room'],
  ['Cabin', 'cabin', null],
  ['Private room', null, 'private_room'],
  ['Martian habitat', null, null],
  ['Serviced apartment', 'serviced_apartment', null],
] as const)
  test(`accommodation/privacy: ${label}`, () => {
    const data = extract(
      embedded({ id: '123', name: 'A home', propertyType: label }),
    );
    assert.equal(value(data, 'propertyType'), label);
    assert.equal(data.accommodationType, accommodation);
    assert.equal(data.bookingType, privacy);
    ExtractionResponseSchema.parse({ success: true, data });
  });
for (const location of [
  'Yan Nawa, Bangkok, Thailand',
  'Phang Tru, Thailand',
  'Paris, France',
  'New York, NY, United States',
  '新宿区, 日本',
  '서울, 대한민국',
  'Singapore',
  'Thailand',
])
  test(`location: ${location}`, () => {
    const data = extract(embedded({ id: '123', location }));
    assert.equal(value(data, 'location'), location);
    assert.equal(value(data, 'address'), undefined);
    assert.equal(value(data, 'currency'), undefined);
  });
for (const [raw, amount, code] of [
  ['฿4,862', 4862, 'THB'],
  ['THB 4,862', 4862, 'THB'],
  ['$1,250', 1250, null],
  ['€1.250,50', 1250.5, 'EUR'],
  ['1 250,00 €', 1250, 'EUR'],
  ['Rp 1.250.000', 1250000, 'IDR'],
  ['JPY 10,000', 10000, 'JPY'],
  ['¥10,000', 10000, null],
  ['HK$1,200', 1200, 'HKD'],
  ['₩25,000', 25000, 'KRW'],
  ['INR 1,250.50', 1250.5, 'INR'],
  ['CNY 100', 100, 'CNY'],
  ['AUD 120', 120, 'AUD'],
  ['CAD 120', 120, 'CAD'],
  ['SGD 120', 120, 'SGD'],
  ['MYR 120', 120, 'MYR'],
  ['PHP 120', 120, 'PHP'],
  ['VND 120.000', 120000, 'VND'],
  ['TWD 120', 120, 'TWD'],
  ['CHF 120', 120, 'CHF'],
] as const)
  test(`localized price: ${raw}`, () => {
    const prices = extractPrices(`${raw} for 5 nights`);
    assert.equal(prices.length, 1);
    assert.equal(prices[0]!.price.amount, amount);
    assert.equal(prices[0]!.price.currency, code);
    assert.equal(prices[0]!.price.basis, 'stay_total');
    PriceRecordSchema.parse(prices[0]!.price);
  });
for (const [label, basis] of [
  ['THB 100/night', 'nightly_rate'],
  ['EUR 700/week', 'weekly_rate'],
  ['USD 2000/month', 'monthly_rent'],
  ['Cleaning fee: EUR 20', 'cleaning_fee'],
  ['Service fee: SGD 10', 'service_fee'],
  ['Deposit: GBP 100', 'deposit'],
  ['Taxes: JPY 100', 'other_fee'],
] as const)
  test(`price basis: ${basis}`, () => {
    const data = extract(`<p>${label}</p>`);
    assert.equal(data.prices[0]?.basis, basis);
    assert.equal(
      value(data, 'monthlyRent'),
      basis === 'monthly_rent' ? 2000 : undefined,
    );
  });
test('discounted total and crossed-out original remain separate through analysis', () => {
  const data = extract('<h1>Home</h1><p><s>฿6,060</s> ฿4,862 for 5 nights</p>');
  assert.equal(data.prices[0]?.amount, 4862);
  assert.equal(data.prices[0]?.discountPresent, true);
  assert.equal(data.currency, 'THB');
  assert.equal(data.priceBasis, 'stay_total');
  assert.equal(
    (value(data, 'originalPrice') as { amount: number }).amount,
    6060,
  );
  assert.equal(value(data, 'monthlyRent'), undefined);
  const checked = validateAnalysisEvidence({
    sources: [data.source],
    facts: data.facts,
  });
  assert.deepEqual(checked.diagnostics, []);
  assert.equal(
    (
      checked.facts.find((f) => f.fieldName === 'price')!.normalizedValue as {
        amount: number;
      }
    ).amount,
    4862,
  );
  assert.throws(() =>
    validateAnalysisEvidence({
      sources: [{ ...data.source, normalizedFacts: [] }],
      facts: data.facts,
    }),
  );
});
test('embedded display discountedPrice takes precedence over originalPrice', () => {
  const data = extract(
    embedded({
      id: '123',
      pricingQuote: {
        primaryLine: {
          originalPrice: '฿6,060',
          discountedPrice: '฿4,862',
          qualifier: 'for 5 nights',
        },
      },
    }),
  );
  assert.equal(data.prices[0]?.amount, 4862);
  assert.equal(data.prices[0]?.nights, 5);
  assert.equal(data.priceStatus, 'extracted');
});
test('structured price objects normalize nested currency and keep discounted total ahead of nightly rate', () => {
  const data = extract(
    embedded({
      id: '123',
      pricingQuote: {
        currency: { code: 'THB', displayName: 'Thai Baht' },
        primaryLine: {
          originalPrice: {
            amount: 7766,
            currency: { code: 'THB' },
          },
          discountedPrice: {
            amount: '4,742',
            currency: { currencyCode: 'THB' },
          },
          qualifier: 'for 2 nights',
        },
      },
      pricingDetails: {
        unitText: 'per night',
        price: { amount: 2500, currency: { code: 'THB' } },
      },
    }),
    new URL(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-16&check_out=2026-10-18&adults=1',
    ),
  );

  assert.equal(data.priceStatus, 'extracted');
  assert.equal(data.prices[0]?.amount, 4742);
  assert.equal(data.prices[0]?.currency, 'THB');
  assert.equal(data.prices[0]?.basis, 'stay_total');
  assert.equal(data.prices[0]?.basisExplicit, true);
  assert.equal(data.prices[0]?.role, 'current');
  assert.equal(data.prices[0]?.nights, 2);
  assert.deepEqual(
    data.prices.map((price) => [price.amount, price.basis]),
    [
      [4742, 'stay_total'],
      [2500, 'nightly_rate'],
    ],
  );
  assert.equal(
    (value(data, 'originalPrice') as { amount: number }).amount,
    7766,
  );
});
test('visible nondiscounted Airbnb booking label extracts an explicit stay total', () => {
  const data = extract(
    '<main><div data-testid="book-it-default"><button aria-haspopup="dialog" aria-label="฿5,400 for 2 nights">฿5,400 for 2 nights</button></div></main>',
    new URL(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-31&check_out=2026-11-02&adults=1',
    ),
  );

  assert.equal(data.priceStatus, 'extracted');
  assert.equal(data.prices[0]?.amount, 5400);
  assert.equal(data.prices[0]?.basis, 'stay_total');
  assert.equal(data.prices[0]?.nights, 2);
  assert.equal(data.prices[0]?.guestCount, 1);
});
test('rendered-only price is extracted when present and remains unavailable in the lightweight response', () => {
  const requested = new URL(
    'https://www.airbnb.com/rooms/123?check_in=2026-10-31&check_out=2026-11-02',
  );
  const lightweight = extract(
    '<main><h1>Home</h1><p>Entire rental unit in Bangkok</p></main>',
    requested,
  );
  const rendered = extract(
    '<main><h1>Home</h1><div data-testid="book-it-default"><button aria-haspopup="dialog" aria-label="฿5,400 for 2 nights">฿5,400 for 2 nights</button></div></main>',
    requested,
  );

  assert.equal(lightweight.priceStatus, 'not_in_response');
  assert.deepEqual(lightweight.prices, []);
  assert.equal(rendered.priceStatus, 'extracted');
  assert.equal(rendered.prices[0]?.amount, 5400);
});
test('booking context retains overnight ranges without a price', () => {
  const data = extract(
    '<main><h1>Home</h1></main>',
    new URL(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-16&check_out=2026-10-17&adults=1',
    ),
  );

  assert.deepEqual(data.bookingContext, {
    checkIn: '2026-10-16',
    checkOut: '2026-10-17',
    nights: 1,
    adults: 1,
    totalGuests: 1,
    guestCount: 1,
  });
  assert.equal(data.priceStatus, 'not_in_response');
});
test('nested discounted display rows extract the payable stay total', () => {
  const data = extract(
    '<main><div data-testid="price-row"><s>฿7,766</s><span>฿4,742</span><span>for 2 nights</span></div></main>',
    new URL(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-31&check_out=2026-11-02',
    ),
  );

  assert.equal(data.priceStatus, 'extracted');
  assert.equal(data.prices[0]?.amount, 4742);
  assert.equal(data.prices[0]?.role, 'current');
  assert.equal(data.prices[0]?.basis, 'stay_total');
  assert.equal(data.prices[0]?.nights, 2);
  assert.equal(data.prices[0]?.discountPresent, true);
  assert.equal(
    (value(data, 'originalPrice') as { amount: number }).amount,
    7766,
  );
});
test('Airbnb discounted booking price accessibility label extracts payable total', () => {
  const data = extract(
    `<main><aside aria-label="Booking Information"><div data-testid="book-it-default"><button aria-haspopup="dialog" aria-label="฿4,742 for 2 nights, originally ฿7,766"><span>฿4,742</span></button></div></aside></main>`,
    new URL(
      'https://www.airbnb.com/rooms/1596764979171323767?check_in=2026-10-16&check_out=2026-10-18&adults=1&currency=THB&locale=en&photo_id=2476402617&source_impression_id=test&previous_page_section_name=1000',
    ),
  );

  assert.equal(data.priceStatus, 'extracted');
  assert.equal(data.prices[0]?.amount, 4742);
  assert.equal(data.prices[0]?.role, 'current');
  assert.equal(data.prices[0]?.basis, 'stay_total');
  assert.equal(data.prices[0]?.nights, 2);
  assert.equal(data.prices[0]?.discountPresent, true);
  assert.equal(
    (value(data, 'originalPrice') as { amount: number }).amount,
    7766,
  );
  assert.equal(data.bookingContext.checkIn, '2026-10-16');
  assert.equal(data.bookingContext.checkOut, '2026-10-18');
  assert.equal(data.bookingContext.nights, 2);
  assert.equal(data.bookingContext.guestCount, 1);
  assert.equal(data.bookingContext.currency, 'THB');
  assert.equal(data.bookingContext.locale, 'en');
  assert.equal(data.prices[0]?.checkIn, '2026-10-16');
  assert.equal(data.prices[0]?.checkOut, '2026-10-18');
  assert.equal(data.source.retrievedAt !== undefined, true);
  assert.equal(verifyEvidenceSource(data.source), true);
  const roundTrip = ExtractionResponseSchema.parse({
    success: true,
    data,
  }).data;
  assert.equal(roundTrip.prices?.[0]?.amount, 4742);
  assert.equal(roundTrip.prices?.[0]?.role, 'current');
  assert.equal(roundTrip.bookingContext?.nights, 2);
  assert.equal(
    roundTrip.facts.find((item) => item.fieldName === 'price')?.provenance
      ?.sourceReference,
    'booking-price[0]',
  );
});
test('currency and explicit price basis survive when the displayed amount is unavailable', () => {
  const data = extract(
    embedded({
      id: '123',
      priceCurrency: 'THB',
      pricingQuote: { priceCurrency: 'THB', unitText: 'nightly' },
    }),
  );
  const roundTrip = ExtractionResponseSchema.parse({
    success: true,
    data,
  }).data;
  assert.equal(roundTrip.currency, 'THB');
  assert.equal(roundTrip.priceBasis, 'nightly_rate');
  assert.deepEqual(roundTrip.prices, []);
  assert.equal(
    roundTrip.facts.find((fact) => fact.fieldName === 'currency')
      ?.normalizedValue,
    'THB',
  );
  assert.equal(
    roundTrip.facts.find((fact) => fact.fieldName === 'priceBasis')
      ?.normalizedValue,
    'nightly_rate',
  );
  const jpy = extract(embedded({ id: '123', priceCurrency: 'JPY' }));
  assert.equal(jpy.currency, 'JPY');
  assert.equal(jpy.prices.length, 0);
});

test('visible Thai baht symbol survives when pricing text has no parseable amount', () => {
  const data = extract('<main><h1>Home</h1><p>฿</p></main>');
  assert.equal(data.currency, 'THB');
  assert.equal(value(data, 'currency'), 'THB');
});
test('Airbnb bootstrap display currency is retained without a price record', () => {
  const data = extract(
    '<main><h1>Home</h1></main>' +
      '<script type="application/json" id="data-injector-instances">' +
      JSON.stringify({
        'root > core-guest-spa': [
          ['CoreGuestSpaToken', { serverDeterminedCurrency: 'THB' }],
        ],
      }) +
      '</script>',
  );
  assert.equal(data.currency, 'THB');
  assert.equal(value(data, 'currency'), 'THB');
  assert.equal(
    data.facts.find((fact) => fact.fieldName === 'currency')?.quotedEvidence,
    '{"serverDeterminedCurrency":"THB"}',
  );
});
test('unlabeled competing amounts cause abstention', () => {
  const data = extract('<p>฿6,060 ฿4,862 for 5 nights</p>');
  assert.equal(data.priceStatus, 'ambiguous');
  assert.equal(data.prices.length, 0);
});
test('incompatible booking duration does not produce a price', () => {
  const data = extract('<p>฿4,862 for 3 nights</p>');
  assert.equal(data.prices.length, 0);
  assert.match(data.extractionWarnings.join(' '), /incompatible/);
});
test('selected guests and maximum capacity remain distinct', () => {
  const data = extract(
    ld(
      listing({
        occupancy: { value: 7 },
        numberOfBedrooms: 1,
        numberOfBeds: 3,
        numberOfBathroomsTotal: 1.5,
      }),
    ),
  );
  assert.equal(data.guestCapacity, 7);
  assert.equal(data.bookingContext.totalGuests, 2);
  assert.equal(data.bookingContext.infants, 1);
  assert.equal(value(data, 'bedroomCount'), 1);
  assert.equal(value(data, 'bedCount'), 3);
  assert.equal(value(data, 'bathroomCount'), 1.5);
});
test('date and guest URL variants are validated and remain distinct booking contexts', () => {
  const html = embedded({ id: '123', occupancy: { value: 7 } });
  const firstUrl = new URL(
    'https://www.airbnb.com/rooms/123?check_in=2026-10-17&check_out=2026-10-22&adults=1&children=0',
  );
  const secondUrl = new URL(
    'https://www.airbnb.com/rooms/123?checkIn=2026-11-17&checkOut=2026-11-22&guest_count=3&infants=1',
  );
  const first = extract(html, firstUrl);
  const second = extract(html, secondUrl);
  assert.deepEqual(first.bookingContext, {
    checkIn: '2026-10-17',
    checkOut: '2026-10-22',
    nights: 5,
    adults: 1,
    children: 0,
    guestCount: 1,
    totalGuests: 1,
  });
  assert.deepEqual(second.bookingContext, {
    checkIn: '2026-11-17',
    checkOut: '2026-11-22',
    nights: 5,
    infants: 1,
    guestCount: 3,
    totalGuests: 3,
  });
  assert.equal(first.guestCapacity, 7);
  assert.equal(second.guestCapacity, 7);
  const invalid = extract(
    html,
    new URL(
      'https://www.airbnb.com/rooms/123?checkin=2026-02-30&checkout=2026-03-02&guests=999',
    ),
  );
  assert.deepEqual(invalid.bookingContext, { checkOut: '2026-03-02' });
});
test('booking prices with a different selected guest count are excluded', () => {
  const data = extract(
    embedded({
      id: '123',
      pricingQuote: {
        adults: 2,
        price: 100,
        priceCurrency: 'USD',
        unitText: 'nightly',
      },
    }),
  );
  assert.deepEqual(data.prices, []);
  assert.equal(data.currency, null);
  assert.equal(data.priceBasis, null);
});
test('foreign listing IDs, offers and recommendations do not contribute data', () => {
  const data = extract(
    ld([
      listing({
        description: 'Real description',
        offers: { price: 100, priceCurrency: 'EUR' },
      }),
      {
        '@type': 'VacationRental',
        url: 'https://www.airbnb.com/rooms/999',
        name: 'Wrong',
        description: 'Wrong description',
        offers: { price: 9999, priceCurrency: 'USD' },
      },
    ]) +
      embedded({ listingId: '999', name: 'Unrelated', price: 999 }) +
      '<aside><p>USD 900/night</p></aside>',
  );
  assert.equal(data.listingTitle, 'Quiet home 🦊 / 森');
  assert.equal(data.description, 'Real description');
  assert.equal(data.prices[0]?.amount, 100);
  assert.ok(!JSON.stringify(data.facts).includes('Wrong description'));
});
test('multiple unassociated JSON-LD listing roots require abstention', () => {
  const data = extract(
    ld([
      { '@type': 'Apartment', name: 'One' },
      { '@type': 'Apartment', name: 'Two' },
    ]),
  );
  assert.equal(data.listingTitle, null);
});
test('short, multilingual, long descriptions preserve content and paragraph boundaries', () => {
  for (const description of [
    '短い 🦊',
    'Hello\n\nWorld &amp; friends',
    '長い'.repeat(7000),
  ]) {
    const data = extract(ld(listing({ description })));
    assert.equal(data.description, description.replace('&amp;', '&'));
    assert.equal(data.descriptionTruncated, false);
    assert.ok(
      data.source.extractedText!.includes(
        data.facts.find((f) => f.fieldName === 'description')!.quotedEvidence,
      ),
    );
  }
});
test('image URLs are validated and deduplicated, cover order is stable', () => {
  const data = extract(
    ld(
      listing({
        image: [
          'https://images.example/cover.jpg',
          'https://images.example/cover.jpg',
          'javascript:alert(1)',
          'https://images.example/avatar.jpg',
          'https://images.example/second.jpg',
        ],
      }),
    ),
  );
  assert.deepEqual(data.images, [
    'https://images.example/cover.jpg',
    'https://images.example/second.jpg',
  ]);
});
test('missing and restricted prices retain distinct diagnostics without fabricated currency', () => {
  assert.equal(extract('<h1>Home</h1>').priceStatus, 'not_in_response');
  assert.equal(
    extract('<p>Verify you are human</p>').priceStatus,
    'source_restricted',
  );
  const data = extract(
    ld(listing({ address: { addressCountry: 'Thailand' } })),
  );
  assert.equal(value(data, 'currency'), undefined);
  assert.equal(data.hostName, null);
  assert.deepEqual(data.amenities, []);
  assert.equal(data.description, null);
  assert.equal(normalizeCurrency('$'), null);
});
test('malformed JSON and missing location remain safe', () => {
  const data = extract(
    '<script type="application/ld+json">{invalid</script><script type="application/json">{broken</script><h1>Home</h1>',
  );
  assert.equal(data.listingTitle, 'Home');
  assert.equal(value(data, 'location'), undefined);
  assert.equal(data.extractionWarnings.length, 3);
});
test('regional domains require exact hostname boundaries', () => {
  for (const domain of [
    'airbnb.com',
    'www.airbnb.co.uk',
    'airbnb.jp',
    'airbnb.co.th',
  ])
    assert.equal(
      airbnbListingId(new URL(`https://${domain}/rooms/123?adults=1`)),
      '123',
    );
  for (const domain of [
    'evilairbnb.com',
    'airbnb.com.evil.test',
    'airbnb.fake',
  ])
    assert.equal(airbnbListingId(new URL(`https://${domain}/rooms/123`)), null);
});
test('one fetch, schema round-trip, deterministic normalized fields, JSON order invariance', async () => {
  let requests = 0;
  const html = ld(
    listing({
      description: 'A short description',
      numberOfBeds: 2,
      offers: { price: 123, priceCurrency: 'USD' },
    }),
  );
  const data = await extractListingUrl(url.href, {
    fetchPage: async () => {
      requests++;
      return { body: html, contentType: 'text/html', url };
    },
  });
  assert.equal(requests, 1);
  ExtractionResponseSchema.parse({ success: true, data });
  const first = extract(html);
  const second = extract(
    ld(
      Object.fromEntries(
        Object.entries(
          listing({
            description: 'A short description',
            numberOfBeds: 2,
            offers: { price: 123, priceCurrency: 'USD' },
          }),
        ).reverse(),
      ),
    ),
  );
  assert.deepEqual(
    first.facts.map((f) => [f.fieldName, f.normalizedValue]),
    second.facts.map((f) => [f.fieldName, f.normalizedValue]),
  );
});
test('redirect to a different listing is rejected', async () => {
  await assert.rejects(
    extractListingUrl(url.href, {
      fetchPage: async () => ({
        body: '<h1>Wrong</h1>',
        contentType: 'text/html',
        url: new URL('https://www.airbnb.com/rooms/999'),
      }),
    }),
    { code: 'LISTING_ID_MISMATCH' },
  );
});

test('public structure fixtures preserve normalized fields and evidence through schema and analysis', async () => {
  const { readFileSync } = await import('node:fs');
  const fixtures = JSON.parse(
    readFileSync(
      new URL('./fixtures/airbnb-public-structures.json', import.meta.url),
      'utf8',
    ),
  ) as Array<{
    name: string;
    embedded?: unknown;
    jsonLd?: unknown;
    expected: Record<string, unknown>;
  }>;
  for (const fixture of fixtures) {
    const data = extract(
      fixture.embedded ? embedded(fixture.embedded) : ld(fixture.jsonLd),
    );
    const roundTrip = ExtractionResponseSchema.parse({
      success: true,
      data,
    }).data;
    for (const [field, expected] of Object.entries(fixture.expected))
      assert.deepEqual(
        value(data, field),
        expected,
        `${fixture.name}: ${field}`,
      );
    for (const fact of data.facts)
      assert.ok(data.source.extractedText!.includes(fact.quotedEvidence));
    assert.deepEqual(
      validateAnalysisEvidence({
        sources: [roundTrip.source],
        facts: roundTrip.facts,
      }).diagnostics,
      [],
    );
    assert.ok(!data.amenities.includes('Pool'));
  }
});
test('explicit contextual payable price beats generic structured original amount', () => {
  const data = extract(
    ld(listing({ offers: { price: 6060, priceCurrency: 'THB' } })) +
      '<p><s>฿6,060</s> ฿4,862 for 5 nights</p>',
  );
  assert.equal(data.prices[0]?.amount, 4862);
  assert.equal(data.prices[0]?.basis, 'stay_total');
  assert.equal(
    (value(data, 'originalPrice') as { basis: string }).basis,
    'stay_total',
  );
});
test('structured inherited currency, fee semantics and specific period are preserved', () => {
  const data = extract(
    ld(
      listing({
        offers: {
          priceCurrency: 'CAD',
          price: 2000,
          priceSpecification: [
            { price: 2000, unitCode: 'MON' },
            { price: 60, name: 'Cleaning fee' },
          ],
        },
      }),
    ),
  );
  assert.equal(
    data.prices.find((price) => price.role === 'current')?.currency,
    'CAD',
  );
  assert.equal(
    data.prices.find((price) => price.role === 'current')?.basis,
    'monthly_rent',
  );
  assert.ok(
    data.prices.some(
      (price) => price.basis === 'cleaning_fee' && price.amount === 60,
    ),
  );
});
test('booking-context mismatches, foreign identities and irrelevant text are excluded', () => {
  const data = extract(
    ld(
      listing({
        offers: { checkIn: '2026-11-01', price: 999, priceCurrency: 'USD' },
      }),
    ) +
      embedded({
        __typename: 'DemandStayListing',
        id: 'RGVtYW5kU3RheUxpc3Rpbmc6OTk5',
        personCapacity: 99,
        name: 'Wrong',
      }) +
      '<p>A sofa costs USD 100.</p>',
  );
  assert.equal(data.prices.length, 0);
  assert.equal(data.guestCapacity, null);
});
test('description limits are explicit and malformed price is distinct from missing price', () => {
  const data = extract(ld(listing({ description: 'a'.repeat(60000) })));
  assert.equal(data.description?.length, 50000);
  assert.equal(data.descriptionTruncated, true);
  assert.equal(data.descriptionOriginalLength, 60000);
  assert.equal(
    extract(ld(listing({ offers: { price: 'not-a-number' } }))).priceStatus,
    'extraction_failed',
  );
});
test('duplicate metadata and unrelated listings do not alter specific normalized results', () => {
  const base = ld(listing({ description: 'Real', numberOfBeds: 2 }));
  const normalize = (data: ReturnType<typeof extract>) =>
    data.facts
      .filter((f) =>
        ['listingTitle', 'description', 'bedCount'].includes(f.fieldName),
      )
      .map((f) => [f.fieldName, f.normalizedValue]);
  assert.deepEqual(
    normalize(extract(base)),
    normalize(
      extract(
        base +
          '<meta property="og:title" content="Wrong"><meta property="og:title" content="Other">' +
          embedded({ listingId: '999', name: 'Wrong', beds: 200 }),
      ),
    ),
  );
});
test('suspicious protocols and credentials are rejected before network access', async () => {
  for (const input of [
    'file:///etc/passwd',
    'https://user:pass@www.airbnb.com/rooms/123',
    'http://127.0.0.1/rooms/123',
    'http://169.254.169.254/latest/meta-data/',
  ])
    await assert.rejects(extractListingUrl(input));
});
test('invalid booking dates and excessive nesting remain bounded', () => {
  const invalid = new URL(
    'https://www.airbnb.com/rooms/123?check_in=2026-99-99&check_out=2026-10-22',
  );
  assert.equal(
    extract('<h1>Home</h1>', invalid).bookingContext.checkIn,
    undefined,
  );
  let nested: unknown = { id: '123', name: 'Too deep' };
  for (let i = 0; i < 35; i++) nested = { child: nested };
  assert.equal(extract(embedded(nested)).listingTitle, null);
});

test('ambiguous symbols use explicit currency evidence, never geography', () => {
  assert.equal(extractPrices('$1,250 SGD per night')[0]?.price.currency, 'SGD');
  assert.equal(
    extractPrices('¥10,000 JPY per night')[0]?.price.currency,
    'JPY',
  );
  assert.equal(extractPrices('try 100 times').length, 0);
});

test('mixed legacy listing containers do not donate unassociated descriptions', () => {
  const data = extract(
    embedded({
      sections: {
        sections: [
          {
            section: {
              shareSave: {
                embedData: {
                  id: '123',
                  name: 'Correct',
                  propertyType: 'Cabin',
                },
              },
            },
          },
          {
            section: {
              shareSave: {
                embedData: { id: '999', name: 'Wrong', propertyType: 'Villa' },
              },
            },
          },
          {
            section: {
              __typename: 'GeneralListContentSection',
              items: [{ html: { htmlText: 'Unassociated description' } }],
            },
          },
        ],
      },
    }),
  );
  assert.equal(data.listingTitle, 'Correct');
  assert.equal(data.description, null);
});

for (const period of ['Monthly', 'Weekly'])
  test(`${period} discount amount is not a periodic rent or payable price`, () => {
    const data = extract(`<p>${period} discount: USD 100</p>`);
    assert.equal(data.prices.length, 0);
    assert.equal(value(data, 'monthlyRent'), undefined);
    assert.equal(data.priceStatus, 'ambiguous');
  });

test('structured original-price and discount labels cannot populate the payable price', () => {
  const data = extract(
    ld(
      listing({
        offers: [
          { price: 6060, name: 'Original price', priceCurrency: 'THB' },
          { price: 100, name: 'Monthly discount', priceCurrency: 'THB' },
        ],
      }),
    ),
  );
  assert.equal(data.prices.length, 0);
  assert.equal(
    (value(data, 'originalPrice') as { amount: number }).amount,
    6060,
  );
  assert.equal(value(data, 'monthlyRent'), undefined);
  assert.equal(data.priceStatus, 'ambiguous');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AnalysisRequestSchema,
  ExtractionResponseSchema,
} from '@sniffo/shared';
import {
  buildAnalysisEvidence,
  applyReviewValueOverrides,
  changedReviewValues,
  currencyForFacts,
  displayPropertyType,
  extractionResponseIsCurrent,
  fieldProvenance,
  hasPriceBasisEvidence,
  hasReliableListingPrice,
  hasUserEdited,
  hydrateDescription,
  listingDetailsFromFacts,
  preserveEnteredAddress,
  priceBasisFromFacts,
  priceValueKey,
  stayNightsFromListing,
  valuesFromFacts,
} from '../src/components/check/reviewEvidence';

const source = {
  id: 'listing-source',
  type: 'listing_url' as const,
  name: 'Airbnb listing',
  originalUrl: 'https://www.airbnb.com/rooms/123',
  extractedText: 'Listing description:\nThe original source description.',
  extractionStatus: 'complete' as const,
};
let factId = 0;
const fact = (
  fieldName: string,
  normalizedValue: unknown,
  quotedEvidence = String(normalizedValue),
) => ({
  id: `fact-${++factId}`,
  sourceId: source.id,
  fieldName,
  normalizedValue,
  quotedEvidence,
});

test('Step 2 hydrates the API data.description field and retains it as original', () => {
  const response = ExtractionResponseSchema.parse({
    success: true,
    data: {
      source,
      facts: [],
      description: 'The original source description.',
      descriptionSource: 'airbnb_public_data',
    },
  });
  const state = hydrateDescription(response.data.description);
  assert.equal(state.description, 'The original source description.');
  assert.equal(state.originalDescription, state.description);
  assert.equal(source.extractedText?.includes(state.originalDescription), true);
});

test('an absent extracted description hydrates to empty without a false edit', () => {
  const state = hydrateDescription(null);
  assert.deepEqual(state, { description: '', originalDescription: '' });
  assert.equal(
    hasUserEdited(state.description, state.originalDescription),
    false,
  );
});

test('edited state changes only when a value diverges from its hydrated original', () => {
  const state = hydrateDescription('Source copy');
  assert.equal(
    hasUserEdited(state.description, state.originalDescription),
    false,
  );
  assert.equal(
    hasUserEdited('Source copy edited', state.originalDescription),
    true,
  );
  assert.equal(hasUserEdited('Source copy', state.originalDescription), false);
});

test('price hydration keeps Airbnb stay totals separate from monthly rent', () => {
  const facts = [
    {
      id: 'price-fact',
      sourceId: source.id,
      fieldName: 'price',
      normalizedValue: {
        amount: 11886,
        currency: 'THB',
        basis: 'stay_total',
        basisExplicit: true,
        nights: 5,
      },
      quotedEvidence: '฿11,886 for 5 nights',
    },
  ];
  const values = valuesFromFacts(facts, {
    monthlyRent: '',
    listingPrice: '',
    currency: 'THB',
  });
  assert.equal(priceBasisFromFacts(facts), 'stay_total');
  assert.equal(priceValueKey(priceBasisFromFacts(facts)), 'listingPrice');
  assert.equal(values.listingPrice, '11886');
  assert.equal(values.monthlyRent, '');
  assert.equal(priceBasisFromFacts([]), 'unknown');
});

test('discounted Airbnb stay price hydrates the payable total, not the crossed-out amount', () => {
  const facts = [
    fact('price', {
      amount: 2500,
      currency: 'THB',
      basis: 'nightly_rate',
      basisExplicit: true,
      role: 'current',
    }),
    fact('price', {
      amount: 4742,
      currency: 'THB',
      basis: 'stay_total',
      basisExplicit: true,
      role: 'current',
      discountPresent: true,
      nights: 2,
    }),
    fact('originalPrice', {
      amount: 7766,
      currency: 'THB',
      basis: 'stay_total',
      basisExplicit: true,
      role: 'original',
      nights: 2,
    }),
  ];
  const values = valuesFromFacts(facts, {
    monthlyRent: '',
    listingPrice: '',
    currency: '',
  });

  assert.equal(values.listingPrice, '4742');
  assert.equal(values.currency, 'THB');
  assert.equal(priceBasisFromFacts(facts), 'stay_total');
  assert.equal(stayNightsFromListing(source.originalUrl, facts), 2);
});

test('price hydration does not autofill a price without an explicit basis or with competing amounts', () => {
  const unknownBasis = [
    fact('price', {
      amount: 4742,
      currency: 'THB',
      basis: 'unknown',
      basisExplicit: false,
    }),
  ];
  assert.equal(
    valuesFromFacts(unknownBasis, { listingPrice: '', monthlyRent: '' })
      .listingPrice,
    '',
  );
  assert.equal(hasReliableListingPrice(unknownBasis), false);

  const missingCurrency = [
    fact('price', {
      amount: 4742,
      basis: 'stay_total',
      basisExplicit: true,
      role: 'current',
    }),
  ];
  const manualEntryValues = valuesFromFacts(missingCurrency, {
    listingPrice: '',
    monthlyRent: '',
    currency: '',
  });
  assert.equal(manualEntryValues.listingPrice, '');
  assert.equal(manualEntryValues.currency, '');
  assert.equal(hasReliableListingPrice(missingCurrency), false);

  const competing = [
    fact('price', {
      amount: 7766,
      currency: 'THB',
      basis: 'stay_total',
      basisExplicit: true,
    }),
    fact('price', {
      amount: 4742,
      currency: 'THB',
      basis: 'stay_total',
      basisExplicit: true,
    }),
  ];
  assert.equal(
    valuesFromFacts(competing, { listingPrice: '', monthlyRent: '' })
      .listingPrice,
    '',
  );
  assert.equal(hasReliableListingPrice(competing), false);
});

test('user-edited price remains unchanged after another extraction of the same listing', () => {
  const originalValues = {
    listingPrice: '4742',
    currency: 'THB',
    propertyType: 'entire rental unit',
  };
  const userValues = {
    ...originalValues,
    listingPrice: '5000',
    propertyType: 'apartment',
  };
  const edits = changedReviewValues(userValues, originalValues);
  const extractedValues = {
    listingPrice: '4800',
    currency: 'THB',
    propertyType: 'entire rental unit',
  };

  assert.deepEqual(edits, {
    listingPrice: '5000',
    propertyType: 'apartment',
  });
  assert.deepEqual(applyReviewValueOverrides(extractedValues, edits), {
    listingPrice: '5000',
    currency: 'THB',
    propertyType: 'apartment',
  });
});

test('specific property type wins while canonical facts stay unchanged', () => {
  const facts = [
    fact('propertyType', 'entire rental unit', 'Entire rental unit'),
    fact('propertyType', 'vacation rental', 'VacationRental'),
  ];
  const values = valuesFromFacts(facts, { propertyType: '' });
  assert.equal(values.propertyType, 'entire rental unit');
  assert.equal(displayPropertyType(values.propertyType), 'Entire Rental Unit');
  assert.equal(facts[0]?.normalizedValue, 'entire rental unit');
  assert.equal(facts[0]?.quotedEvidence, 'Entire rental unit');
});

test('currency hydrates from explicit price or currency evidence independently of amount', () => {
  const extractedFacts = [
    fact('price', { amount: 11886, currency: 'THB', basis: 'stay_total' }),
    fact('country', 'Thailand'),
  ];
  assert.deepEqual(currencyForFacts(extractedFacts), {
    value: 'THB',
    provenance: 'extracted',
  });
  assert.deepEqual(currencyForFacts([fact('currency', 'THB')]), {
    value: 'THB',
    provenance: 'extracted',
  });
  assert.deepEqual(currencyForFacts([], 'JPY'), {
    value: 'JPY',
    provenance: 'extracted',
  });
  assert.deepEqual(currencyForFacts([fact('city', 'Bangkok')]), {
    value: '',
    provenance: 'missing',
  });
  assert.deepEqual(currencyForFacts([fact('city', 'Unknown City')]), {
    value: '',
    provenance: 'missing',
  });
});

test('Thai baht symbol in extracted evidence hydrates the currency field', () => {
  const evidence = fact(
    'price',
    {
      amount: 11886,
      currency: null,
      basis: 'stay_total',
    },
    '฿11,886 for 5 nights',
  );
  assert.deepEqual(currencyForFacts([evidence]), {
    value: 'THB',
    provenance: 'extracted',
  });
  assert.equal(valuesFromFacts([evidence], { currency: '' }).currency, 'THB');
});

test('missing price remains empty and deposits never populate the listing price input', () => {
  const initial = { monthlyRent: '', listingPrice: '' };
  assert.deepEqual(valuesFromFacts([], initial), {
    ...initial,
    location: '',
    currency: '',
  });
  const deposit = fact('price', {
    amount: 56000,
    currency: 'THB',
    basis: 'deposit',
  });
  const values = valuesFromFacts([deposit], initial);
  assert.equal(values.listingPrice, '');
  assert.equal(values.monthlyRent, '');
  assert.equal(priceBasisFromFacts([deposit]), 'unknown');
});

test('additional listing details show beds and guests without inventing a host', () => {
  const details = listingDetailsFromFacts(
    [
      fact('bedCount', 2),
      fact('maxGuests', 3),
      fact('houseRule', 'NO COOKING IN THE ROOM'),
    ],
    5,
  );
  assert.deepEqual(
    details.map(({ label, value }) => [label, value]),
    [
      ['Beds', '2'],
      ['Maximum guests', '3'],
      ['Stay duration', '5 nights'],
      ['House rules', 'No cooking in the room'],
    ],
  );
  assert.ok(!details.some((detail) => detail.label === 'Host'));
});

test('large and duplicate amenity facts become one capped, normalized summary', () => {
  const amenities = [
    'Wireless internet',
    'Wi-Fi',
    'pool',
    'Air conditioning',
    'Kitchen',
    ...Array.from({ length: 120 }, (_, index) => `Amenity ${index + 1}`),
  ];
  const facts = amenities.map((value) => fact('amenity', value));
  const details = listingDetailsFromFacts(facts);
  assert.equal(details.length, 1);
  assert.equal(details[0]?.label, 'Amenities');
  assert.match(
    details[0]?.value ?? '',
    /^Wi-Fi · Air conditioning · Pool · Kitchen/,
  );
  assert.match(details[0]?.value ?? '', /\+116 more$/);
  assert.equal(facts.length, amenities.length);
  assert.equal(facts[0]?.normalizedValue, 'Wireless internet');
});

test('empty supplementary fields produce no extra section rows', () => {
  assert.deepEqual(listingDetailsFromFacts([]), []);
  assert.deepEqual(
    listingDetailsFromFacts([fact('amenity', '  '), fact('hostName', null)]),
    [],
  );
});

test('both Step 2 disclosure sections remain collapsed by default', () => {
  const page = readFileSync(
    new URL('../src/pages/NewCheckPage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    page,
    /<details className="additional-property-details">\s*<summary>/,
  );
  assert.match(
    page,
    /<details className="additional-property-details listing-description-details">\s*<summary>/,
  );
  assert.doesNotMatch(page, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.match(page, /Array\.from\(review\.description\)\.length/);
  assert.match(
    page,
    /const reviewFieldOrder = \[\s*'listingTitle',\s*'propertyType',\s*'location',\s*'monthlyRent',\s*'currency',\s*'priceBasis',\s*'bedroomCount',\s*'bathroomCount',\s*\] as const;/,
  );
  assert.match(
    page,
    /<details className="additional-property-details">[\s\S]*?<dt>Address<\/dt>[\s\S]*?<dt>Deposit \(\{review\.values\.currency \|\| 'amount'\}\)<\/dt>/,
  );
});

test('description edits preserve the immutable source copy for correction submission', () => {
  const original = hydrateDescription(
    'Full original description with all paragraphs.',
  );
  const edited =
    'Full original description with all paragraphs. Corrected detail.';
  assert.equal(hasUserEdited(edited, original.originalDescription), true);
  assert.equal(original.description, original.originalDescription);
  assert.equal(
    source.extractedText,
    'Listing description:\nThe original source description.',
  );
});

test('booking dates provide stay duration without inventing a price basis', () => {
  assert.equal(
    stayNightsFromListing(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-17&check_out=2026-10-22',
      [],
    ),
    5,
  );
  assert.equal(priceBasisFromFacts([]), 'unknown');
  assert.equal(
    priceBasisFromFacts([fact('bookingContext', { nights: 5 })], 'unknown'),
    'unknown',
  );
  assert.equal(priceBasisFromFacts([], 'stay_total'), 'stay_total');
  assert.equal(
    hasPriceBasisEvidence([fact('priceBasis', 'stay_total')], 'stay_total'),
    true,
  );
});

test('location mapping uses rural locality and country without inventing an address', () => {
  const values = valuesFromFacts(
    [fact('locality', 'Phang Tru'), fact('country', 'Thailand')],
    { location: '', address: '' },
  );
  assert.equal(values.location, 'Phang Tru, Thailand');
  const withLocation = valuesFromFacts(
    [
      fact('location', 'Phang Tru'),
      fact('locality', 'Phang Tru'),
      fact('country', 'Thailand'),
    ],
    { location: '', address: '' },
  );
  assert.equal(withLocation.location, 'Phang Tru, Thailand');
  assert.equal(withLocation.address, '');
  assert.deepEqual(valuesFromFacts([], { location: '', address: '' }), {
    location: '',
    address: '',
    currency: '',
  });
  assert.equal(
    preserveEnteredAddress({ address: '' }, '12 Main Road', true).address,
    '12 Main Road',
  );
  assert.equal(
    preserveEnteredAddress({ address: '' }, '12 Main Road', false).address,
    '',
  );
});

test('out-of-order extraction responses cannot replace the latest submission', () => {
  assert.equal(extractionResponseIsCurrent(2, 2), true);
  assert.equal(extractionResponseIsCurrent(1, 2), false);
});

test('price and currency edits retain user provenance independently', () => {
  const facts = [
    fact('price', {
      amount: 100,
      currency: 'THB',
      basis: 'stay_total',
      basisExplicit: true,
    }),
  ];
  assert.equal(
    fieldProvenance({
      field: 'currency',
      value: 'JPY',
      originalValue: 'THB',
      facts,
      mode: 'url',
      currencyProvenance: 'user_provided',
    }),
    'user_provided',
  );
  assert.equal(
    fieldProvenance({
      field: 'priceBasis',
      value: 'nightly_rate',
      originalValue: 'stay_total',
      facts,
      mode: 'url',
      priceBasis: 'nightly_rate',
      originalPriceBasis: 'stay_total',
    }),
    'user_provided',
  );
});

test('dropdown uses canonical ISO currency and price-basis values', () => {
  const currencySelect = readFileSync(
    new URL('../src/components/check/CurrencySelect.tsx', import.meta.url),
    'utf8',
  );
  const page = readFileSync(
    new URL('../src/pages/NewCheckPage.tsx', import.meta.url),
    'utf8',
  );
  assert.match(currencySelect, /value: currency\.code/);
  assert.match(currencySelect, /currency\.code === value/);
  for (const basis of [
    'monthly_rent',
    'nightly_rate',
    'weekly_rate',
    'stay_total',
  ])
    assert.match(page, new RegExp(`value: '${basis}'`));
});

test('field provenance distinguishes extracted, suggested, user-provided and missing', () => {
  const base = {
    facts: [fact('listingTitle', 'Source title')],
    mode: 'url' as const,
    originalValue: 'Source title',
  };
  assert.equal(
    fieldProvenance({ ...base, field: 'listingTitle', value: 'Source title' }),
    'extracted',
  );
  assert.equal(
    fieldProvenance({
      ...base,
      field: 'currency',
      value: 'THB',
      originalValue: 'THB',
      currencyProvenance: 'suggested',
    }),
    'suggested',
  );
  assert.equal(
    fieldProvenance({ ...base, field: 'listingTitle', value: 'Corrected' }),
    'user_provided',
  );
  assert.equal(
    fieldProvenance({
      ...base,
      field: 'address',
      value: '',
      originalValue: '',
    }),
    'missing',
  );
});

test('Step 2 to Step 3 sends the immutable listing and renter correction as separate sources', async () => {
  const originalPriceFact = fact(
    'price',
    {
      amount: 11886,
      currency: 'THB',
      rawCurrency: '฿',
      rawText: '฿11,886 for 5 nights',
      basis: 'stay_total',
      basisExplicit: true,
      nights: 5,
    },
    '฿11,886 for 5 nights',
  );
  const retainedAmenities = Array.from({ length: 120 }, (_, index) =>
    fact('amenity', `Available amenity ${index + 1}`),
  );
  const listingSource = {
    ...source,
    extractedText: `${source.extractedText}\n฿11,886 for 5 nights\n${retainedAmenities.map((item) => item.quotedEvidence).join('\n')}`,
  };
  const savedText = listingSource.extractedText;
  const correctionCalls: Array<{ text: string; type: string; name: string }> =
    [];
  const evidence = await buildAnalysisEvidence({
    source: listingSource,
    facts: [originalPriceFact, ...retainedAmenities],
    values: {
      listingPrice: '12000',
      monthlyRent: '',
      listingTitle: 'Original',
      address: 'Unit 8, 12 Main Road',
      depositAmount: '60000',
      currency: 'USD',
    },
    originalValues: {
      listingPrice: '11886',
      monthlyRent: '',
      listingTitle: 'Original',
      address: '',
      depositAmount: '',
      currency: 'THB',
    },
    description: 'Corrected description',
    originalDescription: 'The original source description.',
    messages: '',
    fieldLabels: {
      listingTitle: 'Property title',
      address: 'Address',
      depositAmount: 'Deposit',
    },
    priceLabel: 'Total Stay Price',
    priceAmount: '12000',
    originalPriceAmount: '11886',
    priceBasis: 'stay_total',
    originalPriceBasis: 'stay_total',
    priceBasisProvenance: 'extracted',
    originalPriceBasisProvenance: 'extracted',
    currency: 'USD',
    currencyProvenance: 'user_provided',
    originalCurrencyProvenance: 'suggested',
    stayNights: 5,
    extractText: async (text, type, name) => {
      correctionCalls.push({ text, type, name });
      return {
        source: {
          ...listingSource,
          id: 'correction-source',
          type: 'listing_text',
          name,
          originalUrl: null,
          extractedText: text,
        },
        facts: [],
      };
    },
  });
  const request = AnalysisRequestSchema.parse(evidence);
  assert.equal(request.sources.length, 2);
  assert.equal(request.sources[0]?.id, listingSource.id);
  assert.equal(request.sources[0]?.extractedText, savedText);
  assert.equal(request.sources[1]?.id, 'correction-source');
  const retainedPrice = request.facts.find(
    (item) => item.fieldName === 'price',
  );
  assert.equal(
    (retainedPrice?.normalizedValue as { basis?: string } | undefined)?.basis,
    'stay_total',
  );
  assert.ok(!request.facts.some((item) => item.fieldName === 'monthlyRent'));
  assert.equal(
    request.facts.filter((item) => item.fieldName === 'amenity').length,
    120,
  );
  assert.equal(request.sources[0]?.extractedText, savedText);
  assert.equal(correctionCalls.length, 1);
  assert.equal(correctionCalls[0]?.name, 'Renter corrections');
  assert.match(
    correctionCalls[0]?.text ?? '',
    /Stay total: USD 12000 for 5 nights/,
  );
  assert.match(correctionCalls[0]?.text ?? '', /Currency: USD/);
  assert.match(correctionCalls[0]?.text ?? '', /Address: Unit 8, 12 Main Road/);
  assert.match(correctionCalls[0]?.text ?? '', /Deposit: 60000/);
  assert.match(correctionCalls[0]?.text ?? '', /Corrected description/);
  assert.equal(listingSource.extractedText, savedText);
});

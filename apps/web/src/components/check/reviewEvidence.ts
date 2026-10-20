import type { EvidenceSource, ExtractedFact } from '@sniffo/shared';

export type ReviewValues = Record<string, string>;
export type PriceBasis =
  'monthly_rent' | 'nightly_rate' | 'weekly_rate' | 'stay_total' | 'unknown';
export type CurrencyProvenance =
  'extracted' | 'suggested' | 'user_provided' | 'missing';
export type FieldProvenance = CurrencyProvenance;
const listingPriceBases = new Set([
  'monthly_rent',
  'nightly_rate',
  'weekly_rate',
  'stay_total',
]);
type ReviewPrice = {
  amount?: number;
  basis?: string;
  basisExplicit?: boolean;
  currency?: string | null;
  role?: string;
};

function currentListingPrices(facts: ExtractedFact[]): ReviewPrice[] {
  const candidates = facts
    .filter((fact) => fact.fieldName === 'price')
    .map((fact) => fact.normalizedValue as ReviewPrice)
    .filter(
      (price) =>
        listingPriceBases.has(price?.basis ?? '') &&
        price?.role !== 'original' &&
        price?.role !== 'fee' &&
        price?.role !== 'ambiguous' &&
        price?.basis !== 'unknown' &&
        price?.basisExplicit === true &&
        typeof price?.currency === 'string' &&
        !!price.currency.trim() &&
        Number.isFinite(price?.amount),
    );
  const current = candidates.filter((price) => price.role === 'current');
  const unambiguous = current.length
    ? current
    : candidates.filter((price) => !price.role);
  const stayTotals = unambiguous.filter(
    (price) => price.basis === 'stay_total',
  );
  const preferred = stayTotals.length ? stayTotals : unambiguous;
  if (
    new Set(preferred.map((price) => `${price.amount}:${price.basis}`)).size > 1
  )
    return [];
  return preferred.sort((left, right) => {
    const priority = (price: ReviewPrice) =>
      price.basis === 'stay_total'
        ? 5
        : ['monthly_rent', 'nightly_rate', 'weekly_rate'].includes(
              price.basis ?? '',
            )
          ? 4
          : price.basisExplicit
            ? 3
            : 1;
    return priority(right) - priority(left);
  });
}

export function hasReliableListingPrice(facts: ExtractedFact[]) {
  return currentListingPrices(facts).some(
    (price) =>
      price.basis !== 'unknown' &&
      price.basisExplicit === true &&
      Number.isFinite(price.amount),
  );
}

export function hydrateDescription(description?: string | null) {
  const value = description ?? '';
  return { description: value, originalDescription: value };
}

export function valuesFromFacts(
  facts: ExtractedFact[],
  initialValues: ReviewValues,
) {
  const values = { ...initialValues };
  facts.forEach((fact) => {
    if (fact.fieldName in values)
      values[fact.fieldName] = String(fact.normalizedValue ?? '');
  });
  const propertyTypeFacts = facts
    .filter((fact) => fact.fieldName === 'propertyType')
    .map((fact) => String(fact.normalizedValue ?? '').trim())
    .filter(Boolean);
  if (propertyTypeFacts.length)
    values.propertyType = preferredPropertyType(propertyTypeFacts);
  const price = currentListingPrices(facts)[0];
  if (typeof price?.amount === 'number') {
    values.listingPrice = String(price.amount);
    if (price.basis === 'monthly_rent' && !values.monthlyRent)
      values.monthlyRent = String(price.amount);
  }
  const factValue = (name: string) =>
    facts.find((fact) => fact.fieldName === name)?.normalizedValue;
  const location = String(factValue('location') ?? '').trim();
  if (!location.includes(',')) {
    const components = [
      factValue('village'),
      factValue('locality'),
      factValue('city'),
      factValue('region'),
      factValue('country'),
    ]
      .filter(
        (part): part is string => typeof part === 'string' && !!part.trim(),
      )
      .map((part) => part.trim());
    const unique = [...new Set(components)];
    values.location =
      unique.length > 1 ? unique.join(', ') : location || unique[0] || '';
  }
  values.currency = currencyForFacts(facts).value;
  return values;
}

export function changedReviewValues(
  values: ReviewValues,
  originalValues: ReviewValues,
): Partial<ReviewValues> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([field, value]) => originalValues[field] !== value,
    ),
  );
}

export function applyReviewValueOverrides(
  values: ReviewValues,
  overrides: Partial<ReviewValues>,
): ReviewValues {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return { ...values, ...definedOverrides };
}

const propertyTypePriority = [
  'entire rental unit',
  'private room',
  'shared room',
  'apartment',
  'condominium',
  'condo',
  'studio',
  'house',
  'vacation rental',
];

function preferredPropertyType(values: string[]) {
  return [...values].sort((left, right) => {
    const leftIndex = propertyTypePriority.indexOf(left.toLowerCase());
    const rightIndex = propertyTypePriority.indexOf(right.toLowerCase());
    return (
      (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    );
  })[0]!;
}

export function displayPropertyType(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  const labels: Record<string, string> = {
    'vacation rental': 'Vacation Rental',
    'entire rental unit': 'Entire Rental Unit',
    apartment: 'Apartment',
    condominium: 'Condominium',
    condo: 'Condominium',
    'private room': 'Private Room',
    'shared room': 'Shared Room',
    house: 'House',
    studio: 'Studio',
  };
  return (
    labels[normalized] ??
    normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function currencyForFacts(
  facts: ExtractedFact[],
  responseCurrency?: string | null,
): {
  value: string;
  provenance: CurrencyProvenance;
} {
  const priceCurrencies = facts
    .filter((fact) => fact.fieldName === 'price')
    .filter((fact) => {
      const basis = (fact.normalizedValue as { basis?: string } | null)?.basis;
      return !['deposit', 'cleaning_fee', 'service_fee', 'other_fee'].includes(
        basis ?? '',
      );
    })
    .map(
      (fact) =>
        (fact.normalizedValue as { currency?: unknown } | null)?.currency,
    )
    .filter((value): value is string => typeof value === 'string' && !!value);
  const explicitCurrency =
    priceCurrencies[0] ??
    facts.find((fact) => fact.fieldName === 'currency')?.normalizedValue ??
    responseCurrency;
  if (typeof explicitCurrency === 'string' && explicitCurrency.trim())
    return {
      value: explicitCurrency.trim().toUpperCase(),
      provenance: 'extracted',
    };
  if (
    facts.some((fact) =>
      /(?:฿|thai\s+baht|\bbaht\b|บาท)/i.test(fact.quotedEvidence),
    )
  )
    return { value: 'THB', provenance: 'extracted' };

  return { value: '', provenance: 'missing' };
}

export function priceBasisFromFacts(
  facts: ExtractedFact[],
  responseBasis?: string | null,
): PriceBasis {
  const basisFact = facts.find((fact) => fact.fieldName === 'priceBasis');
  const explicitBasis = responseBasis ?? basisFact?.normalizedValue;
  const bestPrice = currentListingPrices(facts)[0];
  if (
    typeof bestPrice?.basis === 'string' &&
    ['monthly_rent', 'nightly_rate', 'weekly_rate', 'stay_total'].includes(
      bestPrice.basis,
    )
  )
    return bestPrice.basis as PriceBasis;
  if (
    typeof explicitBasis === 'string' &&
    ['monthly_rent', 'nightly_rate', 'weekly_rate', 'stay_total'].includes(
      explicitBasis,
    )
  )
    return explicitBasis as PriceBasis;
  return ['monthly_rent', 'nightly_rate', 'weekly_rate', 'stay_total'].includes(
    bestPrice?.basis ?? '',
  )
    ? (bestPrice!.basis as PriceBasis)
    : 'unknown';
}

export function hasListingPriceFact(facts: ExtractedFact[]) {
  return facts.some((fact) => {
    if (fact.fieldName !== 'price') return false;
    const basis = (fact.normalizedValue as { basis?: string } | null)?.basis;
    return listingPriceBases.has(basis ?? '');
  });
}

export function hasPriceBasisEvidence(
  facts: ExtractedFact[],
  basis: PriceBasis,
) {
  if (basis === 'unknown') return false;
  if (
    facts.some(
      (fact) =>
        fact.fieldName === 'priceBasis' && fact.normalizedValue === basis,
    )
  )
    return true;
  return facts.some((fact) => {
    if (fact.fieldName !== 'price') return false;
    const price = fact.normalizedValue as {
      basis?: string;
      basisExplicit?: boolean;
      role?: string;
    } | null;
    return (
      price?.basis === basis &&
      price.basisExplicit === true &&
      price.role !== 'original' &&
      price.role !== 'fee'
    );
  });
}

export function priceValueKey(basis: PriceBasis) {
  return basis === 'monthly_rent' ? 'monthlyRent' : 'listingPrice';
}

export function stayNightsFromListing(url: string, facts: ExtractedFact[]) {
  const priceNights = facts
    .filter((fact) => fact.fieldName === 'price')
    .map(
      (fact) => (fact.normalizedValue as { nights?: unknown } | null)?.nights,
    )
    .find(
      (value): value is number => Number.isInteger(value) && Number(value) > 0,
    );
  if (priceNights) return priceNights;
  try {
    const params = new URL(url).searchParams;
    const checkIn = params.get('check_in');
    const checkOut = params.get('check_out');
    if (
      !checkIn ||
      !checkOut ||
      !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)
    )
      return undefined;
    const start = Date.parse(`${checkIn}T00:00:00Z`);
    const end = Date.parse(`${checkOut}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return undefined;
    return (end - start) / 86_400_000;
  } catch {
    return undefined;
  }
}

export function hasUserEdited(current: string, original: string) {
  return current !== original;
}

export function extractionResponseIsCurrent(
  responseRequestId: number,
  latestRequestId: number,
) {
  return responseRequestId === latestRequestId;
}

export function preserveEnteredAddress(
  values: ReviewValues,
  previousAddress: string,
  sameListing: boolean,
) {
  if (sameListing && !values.address?.trim() && previousAddress.trim())
    values.address = previousAddress;
  return values;
}

export function fieldProvenance(args: {
  field: string;
  value: string;
  originalValue: string;
  facts: ExtractedFact[];
  mode: 'url' | 'manual';
  currencyProvenance?: CurrencyProvenance;
  priceBasisProvenance?: CurrencyProvenance;
  priceBasis?: PriceBasis;
  originalPriceBasis?: PriceBasis;
}): FieldProvenance {
  if (
    hasUserEdited(args.value, args.originalValue) ||
    (args.field === 'priceBasis' && args.priceBasis !== args.originalPriceBasis)
  )
    return 'user_provided';
  if (args.field === 'currency') return args.currencyProvenance ?? 'missing';
  if (args.field === 'priceBasis' && args.priceBasisProvenance)
    return args.priceBasis === 'unknown'
      ? 'missing'
      : args.priceBasisProvenance;
  if (args.mode === 'manual' && args.value.trim()) return 'user_provided';
  if (!args.value.trim()) return 'missing';
  if (args.field === 'priceBasis')
    return hasPriceBasisEvidence(args.facts, args.priceBasis ?? 'unknown')
      ? 'extracted'
      : 'missing';
  if (args.field === 'monthlyRent' || args.field === 'listingPrice')
    return args.facts.some(
      (fact) =>
        (fact.fieldName === 'price' && hasListingPriceFact([fact])) ||
        fact.fieldName === args.field,
    )
      ? 'extracted'
      : 'missing';
  const factNames =
    args.field === 'location' ? ['location', 'locality', 'city'] : [args.field];
  return args.facts.some((fact) => factNames.includes(fact.fieldName))
    ? 'extracted'
    : 'missing';
}

export type ListingDetail = { field: string; label: string; value: string };

const amenityPriority = [
  /wifi|wi-fi|wireless internet/i,
  /air conditioning|aircon/i,
  /pool/i,
  /kitchen/i,
  /washer|laundry/i,
  /parking/i,
  /workspace|desk/i,
  /heating/i,
  /elevator|lift/i,
  /hot water/i,
  /balcony|patio/i,
  /tv|television/i,
  /crib|cot|high chair/i,
  /smoke alarm|carbon monoxide/i,
];
const amenityLabels: Array<[RegExp, string]> = [
  [/^(?:wifi|wi[ -]?fi|wireless internet)$/i, 'Wi-Fi'],
  [/^(?:air ?conditioning|aircon)$/i, 'Air conditioning'],
  [/^(?:free )?parking(?: on premises)?$/i, 'Parking'],
  [/^(?:swimming )?pool$/i, 'Pool'],
  [/^(?:washer|washing machine)$/i, 'Washing machine'],
  [/^(?:tv|television)$/i, 'TV'],
  [/^(?:workspace|dedicated workspace)$/i, 'Workspace'],
];

function displayAmenity(value: string) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const known = amenityLabels.find(([pattern]) => pattern.test(normalized));
  if (known) return known[1];
  return normalized.replace(/\b\p{L}/gu, (letter) =>
    letter.toLocaleUpperCase(),
  );
}

function normalizedFactValues(facts: ExtractedFact[], fieldName: string) {
  const seen = new Set<string>();
  return facts.flatMap((fact) => {
    if (fact.fieldName !== fieldName) return [];
    const value = String(fact.normalizedValue ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const displayValue =
      fieldName === 'amenity' ? displayAmenity(value) : value;
    const key = displayValue
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}\s]/gu, '');
    if (!value || !key || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

function readableRule(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return /[a-z]/.test(normalized)
    ? normalized
    : normalized
        .toLocaleLowerCase()
        .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase());
}

export function listingDetailsFromFacts(
  facts: ExtractedFact[],
  stayNights?: number,
): ListingDetail[] {
  const details: ListingDetail[] = [];
  for (const [field, label] of [
    ['bedCount', 'Beds'],
    ['maxGuests', 'Maximum guests'],
    ['hostName', 'Host'],
  ] as const) {
    const value = normalizedFactValues(facts, field)[0];
    if (value) details.push({ field, label, value });
  }

  if (stayNights && stayNights > 0) {
    details.push({
      field: 'stayDuration',
      label: 'Stay duration',
      value: `${stayNights} ${stayNights === 1 ? 'night' : 'nights'}`,
    });
  }

  const rules = [
    ...new Set(
      normalizedFactValues(facts, 'houseRule')
        .map(readableRule)
        .filter(Boolean),
    ),
  ];
  const importantRules = rules.filter((rule) =>
    /\b(?:no|not allowed|must|required|quiet hours?|check.?in|check.?out|pets?|smoking|parties|events|cooking|maximum guests|curfew)\b/i.test(
      rule,
    ),
  );
  const selectedRules = [...new Set([...importantRules, ...rules])].slice(0, 3);
  if (selectedRules.length) {
    const extraCount = rules.length - selectedRules.length;
    details.push({
      field: 'houseRule',
      label: 'House rules',
      value: `${selectedRules.join(' · ')}${extraCount > 0 ? ` · +${extraCount} more` : ''}`,
    });
  }

  const amenities = [
    ...new Map(
      normalizedFactValues(facts, 'amenity').map((value) => [
        value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim(),
        value,
      ]),
    ).values(),
  ];
  const orderedAmenities = [...amenities].sort((left, right) => {
    const score = (value: string) => {
      const index = amenityPriority.findIndex((pattern) => pattern.test(value));
      return index < 0 ? amenityPriority.length : index;
    };
    return score(left) - score(right);
  });
  const visibleAmenities = orderedAmenities.slice(0, 8).map(displayAmenity);
  if (visibleAmenities.length) {
    const extraCount = amenities.length - visibleAmenities.length;
    details.push({
      field: 'amenities',
      label: 'Amenities',
      value: `${visibleAmenities.join(' · ')}${extraCount > 0 ? ` · +${extraCount} more` : ''}`,
    });
  }

  return details;
}

export type AnalysisEvidence = {
  sources: EvidenceSource[];
  facts: ExtractedFact[];
};

export async function buildAnalysisEvidence(args: {
  source: EvidenceSource;
  facts: ExtractedFact[];
  values: ReviewValues;
  originalValues: ReviewValues;
  description: string;
  originalDescription: string;
  messages: string;
  fieldLabels: Record<string, string>;
  extractText: (
    text: string,
    type: 'listing_text' | 'conversation_text' | 'payment_information',
    name: string,
    signal?: AbortSignal,
    evidenceKind?: 'user_source' | 'user_assertion',
  ) => Promise<{ source: EvidenceSource; facts: ExtractedFact[] }>;
  priceLabel: string;
  priceAmount: string;
  originalPriceAmount: string;
  priceBasis: PriceBasis;
  originalPriceBasis: PriceBasis;
  currency: string;
  currencyProvenance: CurrencyProvenance;
  originalCurrencyProvenance: CurrencyProvenance;
  priceBasisProvenance: CurrencyProvenance;
  originalPriceBasisProvenance: CurrencyProvenance;
  stayNights?: number;
  signal?: AbortSignal;
}): Promise<AnalysisEvidence> {
  const sources = [args.source];
  const facts = [...args.facts];
  const correctionLines = Object.entries(args.values)
    .filter(([field, value]) => {
      if (
        field === 'listingPrice' ||
        field === 'monthlyRent' ||
        field === 'currency'
      )
        return false;
      return hasUserEdited(value, args.originalValues[field] ?? '');
    })
    .map(
      ([field, value]) =>
        `Renter-supplied correction — ${args.fieldLabels[field]}: ${value.trim() || 'marked as unknown'}`,
    );
  const priceChanged =
    hasUserEdited(args.priceAmount, args.originalPriceAmount) ||
    args.priceBasis !== args.originalPriceBasis ||
    (args.priceBasisProvenance === 'user_provided' &&
      args.originalPriceBasisProvenance !== 'user_provided');
  const currencyWasConfirmed =
    args.currencyProvenance === 'user_provided' &&
    args.originalCurrencyProvenance !== 'user_provided';
  if (priceChanged && args.priceAmount.trim()) {
    const priceDescription =
      args.priceBasis === 'monthly_rent'
        ? 'Monthly rent'
        : args.priceBasis === 'nightly_rate'
          ? 'Nightly rate'
          : args.priceBasis === 'weekly_rate'
            ? 'Weekly rent'
            : args.priceBasis === 'stay_total'
              ? 'Stay total'
              : 'Price';
    correctionLines.push(
      `Renter-supplied price — ${priceDescription}: ${args.currency ? `${args.currency} ` : ''}${args.priceAmount.trim()}${args.priceBasis === 'stay_total' && args.stayNights ? ` for ${args.stayNights} nights` : ''}`,
    );
  } else if (args.priceBasis !== args.originalPriceBasis) {
    correctionLines.push(`Renter-supplied price type: ${args.priceLabel}`);
  }
  if (currencyWasConfirmed && args.currency)
    correctionLines.push(`Currency: ${args.currency}`);
  if (hasUserEdited(args.description, args.originalDescription))
    correctionLines.push(
      `Listing description:\n${args.description.trim() || 'Renter marked description as unavailable.'}`,
    );
  if (correctionLines.length) {
    const correction = await args.extractText(
      correctionLines.join('\n'),
      'listing_text',
      'Renter corrections',
      args.signal,
      'user_assertion',
    );
    sources.push(correction.source);
    facts.push(...correction.facts);
  }
  if (args.messages.trim()) {
    const message = await args.extractText(
      args.messages.trim(),
      'conversation_text',
      'Landlord messages supplied by renter',
      args.signal,
    );
    sources.push(message.source);
    facts.push(...message.facts);
  }
  return { sources, facts };
}

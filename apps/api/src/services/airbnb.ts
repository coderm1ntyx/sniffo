import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import type { ExtractedFact, PriceRecord } from '@sniffo/shared';
import {
  extractPrices,
  findBahtCurrencyEvidence,
  normalizeCurrency,
  parseLocalizedAmount,
} from './prices.js';
import { sealEvidenceSource } from './sourceSignature.js';

type Obj = Record<string, unknown>;
type SourceType = NonNullable<ExtractedFact['provenance']>['sourceType'];
type Candidate = {
  field: string;
  value: unknown;
  raw: unknown;
  quote: string;
  ref: string;
  source: SourceType;
  rank: number;
};
const domains = new Set([
  'com',
  'co.uk',
  'com.au',
  'ca',
  'co.nz',
  'co.in',
  'co.kr',
  'com.sg',
  'com.hk',
  'com.tw',
  'com.br',
  'com.mx',
  'co.za',
  'co.id',
  'com.my',
  'com.ph',
  'co.th',
  'jp',
  'cn',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'nl',
  'be',
  'at',
  'ch',
  'ie',
  'dk',
  'se',
  'no',
  'fi',
  'pl',
  'cz',
  'hu',
  'gr',
  'com.tr',
  'ru',
  'ba',
  'bg',
  'hr',
  'rs',
  'ro',
  'si',
  'sk',
  'is',
  'com.vn',
  'ae',
  'sa',
  'com.ar',
  'cl',
  'com.co',
  'com.pe',
]);
export function airbnbListingId(url: URL): string | null {
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^m\./, '')
    .replace(/^[a-z]{2}(?:-[a-z]{2})?\.(?=airbnb\.)/, '');
  if (!host.startsWith('airbnb.') || !domains.has(host.slice(7))) return null;
  return url.pathname.match(/^\/rooms\/(\d+)(?:\/|$)/)?.[1] ?? null;
}
function identity(obj: Obj): string | null {
  const raw = obj.listingId ?? obj.roomId ?? obj.id;
  if (raw === undefined) return null;
  if (/^\d+$/.test(String(raw))) return String(raw);
  if (typeof raw === 'string' && raw.length < 200) {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return (
      decoded.match(/^(?:DemandStayListing|StayListing|Listing):(\d+)$/)?.[1] ??
      null
    );
  }
  return null;
}
function typeLocation(raw: string): RegExpMatchArray | null {
  if (/for rent| - Airbnb/i.test(raw)) return null;
  const match = raw.match(/^(.{1,70}?)\s+in\s+([^·]+)(?:·|$)/i);
  if (!match) return null;
  const prefix = match[1]!
    .toLowerCase()
    .replace(
      /^(?:entire|private room in|shared room in|room in|hotel room in)\s+/,
      '',
    );
  return accommodationTypes.includes(prefix) ||
    ['home', 'private room', 'shared room', 'hotel room', 'room'].includes(
      prefix,
    )
    ? match
    : null;
}
function object(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Obj)
    : null;
}
function text(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const $ = load(value.replace(/\\n/g, '\n'));
  $('br').replaceWith('\n');
  $('p, li, div').append('\n');
  return (
    $.root()
      .text()
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null
  );
}
const accommodationTypes = [
  'serviced apartment',
  'boutique hotel',
  'bed and breakfast',
  'entire rental unit',
  'rental unit',
  'farm stay',
  'tiny home',
  'guesthouse',
  'townhouse',
  'condominium',
  'apartment',
  'bungalow',
  'cottage',
  'cabin',
  'villa',
  'studio',
  'loft',
  'house',
  'hostel',
  'hotel',
  'campsite',
  'glamping',
];
export function normalizeAccommodation(raw: string) {
  const expanded = raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  const aliases: Record<string, string> = {
    home: 'house',
    condo: 'condominium',
    'tiny house': 'tiny home',
    'serviced accommodation': 'serviced apartment',
  };
  const match =
    accommodationTypes.find((type) =>
      new RegExp('\\b' + type + '\\b').test(expanded),
    ) ??
    Object.entries(aliases).find(([label]) =>
      new RegExp('\\b' + label + '\\b').test(expanded),
    )?.[1];
  return {
    accommodationType:
      match === 'entire rental unit' || match === 'rental unit'
        ? 'rental_unit'
        : (match?.replaceAll(' ', '_') ?? null),
    bookingType: /private room/i.test(raw)
      ? 'private_room'
      : /shared room/i.test(raw)
        ? 'shared_room'
        : /hotel room|room in.*hotel/i.test(raw)
          ? 'hotel_room'
          : /^entire\b/i.test(raw)
            ? 'entire_place'
            : null,
  };
}
function bookingContext(url: URL) {
  const context: Record<string, string | number> = {};
  for (const [params, key] of [
    [['check_in', 'checkIn', 'checkin', 'check_in_date', 'arrival'], 'checkIn'],
    [
      ['check_out', 'checkOut', 'checkout', 'check_out_date', 'departure'],
      'checkOut',
    ],
  ] as const) {
    const value = params
      .map((param) => url.searchParams.get(param))
      .find(Boolean);
    if (
      value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
    )
      context[key] = value;
  }
  const requestedCurrency = url.searchParams.get('currency');
  if (requestedCurrency) {
    const currency = normalizeCurrency(requestedCurrency);
    if (currency) context.currency = currency;
  }
  const requestedLocale = url.searchParams.get('locale');
  if (requestedLocale && /^[a-z]{2,3}(?:-[A-Z]{2})?$/i.test(requestedLocale))
    context.locale = requestedLocale;
  if (context.checkIn && context.checkOut) {
    const nights =
      (Date.parse(String(context.checkOut)) -
        Date.parse(String(context.checkIn))) /
      86400000;
    if (nights > 0 && nights <= 366) context.nights = nights;
  }
  for (const key of ['adults', 'children', 'infants', 'pets'] as const) {
    const value = url.searchParams.get(key);
    if (value && /^\d{1,3}$/.test(value) && Number(value) <= 100)
      context[key] = Number(value);
  }
  const guestCountParam = [
    'guest_count',
    'guestCount',
    'numberOfGuests',
    'number_of_guests',
    'guests',
  ]
    .map((param) => url.searchParams.get(param))
    .find((value) => value && /^\d{1,3}$/.test(value) && Number(value) <= 100);
  if (guestCountParam) context.guestCount = Number(guestCountParam);
  if ('adults' in context || 'children' in context)
    context.totalGuests =
      Number(context.adults ?? 0) + Number(context.children ?? 0);
  else if ('guestCount' in context) context.totalGuests = context.guestCount;
  if (context.totalGuests !== undefined)
    context.guestCount = context.totalGuests;
  return context;
}

/** Bounded traversal; recommendation branches and explicitly different listing IDs are excluded. */
function walk(
  value: unknown,
  visit: (obj: Obj, path: string, ancestors: Obj[]) => void,
  listingId: string,
  path = '$',
  depth = 0,
  budget = { count: 0 },
  ancestors: Obj[] = [],
) {
  if (
    !value ||
    typeof value !== 'object' ||
    depth > 24 ||
    budget.count++ > 30_000
  )
    return;
  if (Array.isArray(value)) {
    value.forEach((child, i) =>
      walk(
        child,
        visit,
        listingId,
        `${path}[${i}]`,
        depth + 1,
        budget,
        ancestors,
      ),
    );
    return;
  }
  const obj = value as Obj;
  const id = identity(obj);
  if (
    id !== null &&
    id !== listingId &&
    (/Listing/i.test(String(obj.__typename ?? '')) ||
      /VacationRental|Apartment|Accommodation|House|Room|Hotel/i.test(
        String(obj['@type'] ?? ''),
      ) ||
      obj.listingId !== undefined ||
      obj.roomId !== undefined)
  )
    return;
  const linkedId = String(obj.url ?? obj['@id'] ?? '').match(
    /\/rooms\/(\d+)/,
  )?.[1];
  if (linkedId && linkedId !== listingId) return;
  if (
    /^\d+$/.test(String(obj.id)) &&
    String(obj.id) !== listingId &&
    ('personCapacity' in obj || 'propertyType' in obj || 'listingId' in obj)
  )
    return;
  visit(obj, path, ancestors);
  for (const [key, child] of Object.entries(obj)) {
    if (
      /recommend|similar|nearby|(?:^|_)reviews?|navigation|conversion|promotion|searchResult/i.test(
        key,
      )
    )
      continue;
    walk(child, visit, listingId, `${path}.${key}`, depth + 1, budget, [
      ...ancestors,
      obj,
    ]);
  }
}

export function extractAirbnb(html: string, url: URL, originalUrl: URL) {
  const listingId = airbnbListingId(url);
  if (!listingId) throw new Error('Airbnb extraction requires a listing URL');
  const $ = load(html);
  const candidates: Candidate[] = [];
  const warnings: string[] = [];
  const context = bookingContext(originalUrl);
  let descriptionTruncated = false;
  let descriptionOriginalLength: number | undefined;
  let priceFailure = false;
  const add = (
    field: string,
    value: unknown,
    raw: unknown,
    source: SourceType,
    ref: string,
    rank: number,
    quote?: string,
  ) => {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
    )
      return;
    if (
      field === 'description' &&
      typeof value === 'string' &&
      value.length > 50_000
    ) {
      descriptionTruncated = true;
      descriptionOriginalLength = value.length;
      value = value.slice(0, 50_000);
      raw = value;
      quote = value as string;
      warnings.push(
        'Description exceeded the 50000-character extraction limit; truncation metadata is available.',
      );
    }
    candidates.push({
      field,
      value,
      raw,
      source,
      ref,
      rank,
      quote: quote ?? (typeof raw === 'string' ? raw : JSON.stringify(raw)),
    });
  };
  const addText = (
    field: string,
    raw: unknown,
    source: SourceType,
    ref: string,
    rank: number,
  ) => add(field, text(raw), raw, source, ref, rank);
  const image = (
    raw: unknown,
    source: SourceType,
    ref: string,
    rank: number,
  ) => {
    if (typeof raw !== 'string') return;
    try {
      const value = new URL(raw, url);
      if (
        !['https:', 'http:'].includes(value.protocol) ||
        value.username ||
        value.password ||
        /avatar|profile|icon|logo|sprite|pixel|tracking|spacer|placeholder|default-image|\.(svg|ico)$/i.test(
          value.pathname,
        )
      )
        return;
      add('listingImage', value.href, raw, source, ref, rank);
    } catch {
      /* Invalid image URLs are ignored without fetching them. */
    }
  };
  const addCounts = (
    raw: string,
    source: SourceType,
    ref: string,
    rank: number,
  ) => {
    for (const [field, pattern] of [
      ['bedroomCount', /\b(\d+)\s+bedrooms?\b/i],
      ['bedCount', /\b(\d+)\s+beds?\b/i],
      ['bathroomCount', /\b(\d+(?:\.5)?)\s+(?:bathrooms?|baths?)\b/i],
      ['maxGuests', /\b(\d+)\s+guests?\b/i],
    ] as const) {
      const match = raw.match(pattern);
      if (match) add(field, Number(match[1]), raw, source, ref, rank);
    }
  };
  const addType = (
    raw: unknown,
    source: SourceType,
    ref: string,
    rank: number,
  ) => {
    if (typeof raw !== 'string') return;
    const { accommodationType, bookingType } = normalizeAccommodation(raw);
    if (/^entire home\/apt$/i.test(raw)) rank -= 20;
    // Keep the source label for Step 2 and expose canonical concepts separately.
    addText(
      'propertyType',
      /^[A-Z_]+$/.test(raw) ? raw.toLowerCase().replaceAll('_', ' ') : raw,
      source,
      ref,
      rank,
    );
    add('accommodationType', accommodationType, raw, source, ref, rank);
    add('bookingType', bookingType, raw, source, ref, rank);
  };
  const addPrices = (
    raw: string,
    source: SourceType,
    ref: string,
    rank: number,
    forcedRole?: PriceRecord['role'],
  ) => {
    const prices = extractPrices(raw);
    for (const { price } of prices) {
      const role =
        forcedRole ??
        (/^\s*(?:(?:monthly|weekly|promotional)\s+)?(?:discount|savings?)\s*:/i.test(
          raw,
        )
          ? 'ambiguous'
          : /original|before discount|crossed.out/i.test(raw)
            ? 'original'
            : prices.length > 1 && !/fee|deposit|tax/i.test(raw)
              ? 'ambiguous'
              : [
                    'deposit',
                    'cleaning_fee',
                    'service_fee',
                    'other_fee',
                  ].includes(price.basis)
                ? 'fee'
                : 'current');
      if (price.nights && context.nights && price.nights !== context.nights) {
        warnings.push(
          'A source price had incompatible booking dates or duration and was excluded.',
        );
        continue;
      }
      const value: PriceRecord = {
        ...price,
        currency:
          price.currency ??
          (typeof context.currency === 'string' ? context.currency : null),
        role,
        ...(typeof context.checkIn === 'string'
          ? { checkIn: context.checkIn }
          : {}),
        ...(typeof context.checkOut === 'string'
          ? { checkOut: context.checkOut }
          : {}),
        ...(typeof context.guestCount === 'number'
          ? { guestCount: context.guestCount }
          : {}),
        includesFees: /including (?:fees|tax)|fees included/i.test(raw)
          ? true
          : /before (?:fees|tax)|excluding (?:fees|tax)/i.test(raw)
            ? false
            : null,
      };
      add(
        role === 'original'
          ? 'originalPrice'
          : role === 'ambiguous'
            ? 'ambiguousPrice'
            : 'price',
        value,
        raw,
        source,
        ref,
        rank,
      );
    }
  };
  const addStructuredPrice = (
    rawValue: unknown,
    role: PriceRecord['role'],
    source: SourceType,
    ref: string,
    rank: number,
    qualifiers: string[],
    inheritedCurrency?: unknown,
  ) => {
    const priceObject = object(rawValue);
    const rawAmount =
      typeof rawValue === 'number' || typeof rawValue === 'string'
        ? rawValue
        : (priceObject?.amount ??
          priceObject?.value ??
          priceObject?.formattedAmount ??
          priceObject?.localizedString);
    const rawText = typeof rawAmount === 'string' ? rawAmount : '';
    const formatted =
      rawText ||
      qualifiers.find((qualifier) => extractPrices(qualifier).length) ||
      '';
    const parsedTextPrice = formatted
      ? extractPrices(formatted)[0]?.price
      : null;
    const amount =
      typeof rawAmount === 'number' && Number.isFinite(rawAmount)
        ? rawAmount
        : typeof rawAmount === 'string'
          ? (parseLocalizedAmount(rawAmount) ?? parsedTextPrice?.amount ?? null)
          : null;
    if (amount === null || amount < 0) return;

    const currencyValue =
      priceObject?.currency ??
      priceObject?.currencyCode ??
      priceObject?.currency_code ??
      inheritedCurrency;
    const currencyObject = object(currencyValue);
    const rawCurrency =
      typeof currencyValue === 'string'
        ? currencyValue
        : (currencyObject?.code ??
          currencyObject?.currencyCode ??
          currencyObject?.name);
    const currency =
      typeof rawCurrency === 'string' ? normalizeCurrency(rawCurrency) : null;
    const labels = qualifiers.join(' ');
    const sourceBasis = String(
      priceObject?.basis ??
        priceObject?.unitText ??
        priceObject?.unitCode ??
        priceObject?.unit ??
        priceObject?.period ??
        '',
    );
    const basisContext = `${sourceBasis} ${labels} ${rawText}`;
    const basis: PriceRecord['basis'] = /deposit/i.test(labels)
      ? 'deposit'
      : /cleaning\s+fee/i.test(labels)
        ? 'cleaning_fee'
        : /service\s+fee|admin(?:istration)?\s+fee/i.test(labels)
          ? 'service_fee'
          : /\b(?:tax|fee|guest charge)\b/i.test(labels)
            ? 'other_fee'
            : /for\s+\d+\s+nights?|stay[_ ]?total|\btotal\b/i.test(basisContext)
              ? 'stay_total'
              : /\b(?:mon|month|monthly)\b|per\s+month|\/\s*month\b/i.test(
                    basisContext,
                  )
                ? 'monthly_rent'
                : /\b(?:wee|week|weekly)\b|per\s+week|\/\s*week\b/i.test(
                      basisContext,
                    )
                  ? 'weekly_rate'
                  : /nightly|per\s+night|\/\s*night\b/i.test(basisContext)
                    ? 'nightly_rate'
                    : 'unknown';
    const nights = labels.match(/for\s+(\d+)\s+nights?/i)?.[1];
    if (nights && context.nights && Number(nights) !== context.nights) {
      warnings.push(
        'A source price had incompatible booking dates or duration and was excluded.',
      );
      return;
    }
    const value: PriceRecord = {
      amount,
      currency:
        currency ??
        parsedTextPrice?.currency ??
        (typeof context.currency === 'string' ? context.currency : null),
      rawCurrency: typeof rawCurrency === 'string' ? rawCurrency : null,
      rawText: rawText || JSON.stringify(rawValue),
      basis,
      basisExplicit: basis !== 'unknown',
      role,
      ...(nights ? { nights: Number(nights) } : {}),
      ...(typeof context.checkIn === 'string'
        ? { checkIn: context.checkIn }
        : {}),
      ...(typeof context.checkOut === 'string'
        ? { checkOut: context.checkOut }
        : {}),
      ...(typeof context.guestCount === 'number'
        ? { guestCount: context.guestCount }
        : {}),
      includesFees: /including (?:fees|tax)|fees included/i.test(labels)
        ? true
        : /before (?:fees|tax)|excluding (?:fees|tax)/i.test(labels)
          ? false
          : null,
    };
    add(
      role === 'original'
        ? 'originalPrice'
        : role === 'ambiguous'
          ? 'ambiguousPrice'
          : 'price',
      value,
      rawValue,
      source,
      ref,
      rank,
      JSON.stringify({ value: rawValue, context: labels }),
    );
  };
  const processObject = (
    obj: Obj,
    source: SourceType,
    ref: string,
    rank: number,
    ancestors: Obj[] = [],
  ) => {
    const raw = JSON.stringify(obj);
    const put = (field: string, value: unknown) => {
      const entry = Object.entries(obj).find(([, input]) => input === value);
      const evidence = entry ? JSON.stringify({ [entry[0]]: entry[1] }) : raw;
      add(
        field,
        value,
        entry ? entry[1] : obj,
        source,
        entry ? ref + '.' + entry[0] : ref,
        rank,
        evidence,
      );
    };
    const priceContextMatchesRequest = [...ancestors, obj].every((record) => {
      const expected: Array<[string, string]> = [
        ['checkIn', 'checkIn'],
        ['check_in', 'checkIn'],
        ['checkin', 'checkIn'],
        ['check_in_date', 'checkIn'],
        ['checkOut', 'checkOut'],
        ['check_out', 'checkOut'],
        ['checkout', 'checkOut'],
        ['check_out_date', 'checkOut'],
        ['adults', 'adults'],
        ['children', 'children'],
        ['infants', 'infants'],
        ['pets', 'pets'],
        ['guestCount', 'guestCount'],
        ['guestCount', 'totalGuests'],
        ['guest_count', 'guestCount'],
        ['guest_count', 'totalGuests'],
        ['numberOfGuests', 'guestCount'],
        ['numberOfGuests', 'totalGuests'],
        ['number_of_guests', 'guestCount'],
        ['number_of_guests', 'totalGuests'],
        ['guests', 'guestCount'],
        ['guests', 'totalGuests'],
        ['nights', 'nights'],
      ];
      return expected.every(
        ([sourceKey, contextKey]) =>
          record[sourceKey] === undefined ||
          context[contextKey] === undefined ||
          String(record[sourceKey]) === String(context[contextKey]),
      );
    });
    const pricePath = /pricing|priceQuote|priceDetails/i.test(ref);
    if (
      (identity(obj) === listingId || pricePath) &&
      priceContextMatchesRequest
    ) {
      for (const key of ['priceCurrency', 'currencyCode', 'currency']) {
        const rawValue = obj[key];
        const currencyObject = object(rawValue);
        const rawCurrency =
          typeof rawValue === 'string'
            ? rawValue
            : (currencyObject?.code ??
              currencyObject?.currencyCode ??
              currencyObject?.name);
        if (typeof rawCurrency !== 'string') continue;
        const currency = normalizeCurrency(rawCurrency);
        if (currency)
          add(
            'currency',
            currency,
            rawValue,
            source,
            `${ref}.${key}`,
            rank,
            JSON.stringify({ [key]: rawValue }),
          );
      }
      if (pricePath) {
        const qualifiers = [...ancestors, obj]
          .flatMap((record) => [
            record.qualifier,
            record.name,
            record.description,
            record.priceType,
            record.priceRole,
            record.unitText,
            record.unitCode,
            record.basis,
            record.period,
          ])
          .filter((value): value is string => typeof value === 'string');
        const unit =
          qualifiers.find((value) =>
            /stay[_ ]?total|\btotal\b|for\s+\d+\s+nights?/i.test(value),
          ) ?? qualifiers.find((value) => /month|night|week/i.test(value));
        const basis = unit
          ? /stay[_ ]?total|\btotal\b|for\s+\d+\s+nights?/i.test(unit)
            ? 'stay_total'
            : /month/i.test(unit)
              ? 'monthly_rent'
              : /night/i.test(unit)
                ? 'nightly_rate'
                : /week/i.test(unit)
                  ? 'weekly_rate'
                  : /total/i.test(unit)
                    ? 'stay_total'
                    : null
          : null;
        if (
          basis &&
          !/original|strikethrough|discount|fee|deposit|tax/i.test(
            qualifiers.join(' '),
          )
        )
          add(
            'priceBasis',
            basis,
            unit,
            source,
            ref,
            rank,
            JSON.stringify({ context: qualifiers }),
          );

        const inheritedCurrency = [...ancestors, obj]
          .reverse()
          .map(
            (record) =>
              record.priceCurrency ?? record.currencyCode ?? record.currency,
          )
          .find((value) => value !== undefined);
        const discountRecord = object(obj.primaryLine) ?? obj;
        const currentKeys = [
          'discountedPrice',
          'payablePrice',
          'currentPrice',
          'totalPrice',
          'nightlyPrice',
          'monthlyPrice',
          'weeklyPrice',
          'price',
        ];
        const currentKey = currentKeys.find(
          (key) => discountRecord[key] !== undefined,
        );
        const originalRecord = discountRecord;
        const originalKey = [
          'originalPrice',
          'strikethroughPrice',
          'regularPrice',
        ].find((key) => originalRecord[key] !== undefined);
        const qualifierValues = [
          ...qualifiers,
          ...(typeof discountRecord.qualifier === 'string'
            ? [discountRecord.qualifier]
            : []),
        ];
        if (currentKey) {
          const currentRef = `${ref}.${
            obj.primaryLine ? `primaryLine.${currentKey}` : currentKey
          }`;
          addStructuredPrice(
            discountRecord[currentKey],
            'current',
            source,
            currentRef,
            currentKey === 'discountedPrice' || currentKey === 'payablePrice'
              ? rank + 15
              : rank,
            qualifierValues,
            discountRecord.currency ?? inheritedCurrency,
          );
        }
        if (originalKey)
          addStructuredPrice(
            originalRecord[originalKey],
            'original',
            source,
            `${ref}.${obj.primaryLine ? `primaryLine.${originalKey}` : originalKey}`,
            rank,
            qualifierValues,
            originalRecord.currency ?? inheritedCurrency,
          );
      }
    }
    for (const [key, field] of [
      ['numberOfBedrooms', 'bedroomCount'],
      ['bedrooms', 'bedroomCount'],
      ['numberOfBeds', 'bedCount'],
      ['beds', 'bedCount'],
      ['numberOfBathroomsTotal', 'bathroomCount'],
      ['bathrooms', 'bathroomCount'],
      ['personCapacity', 'maxGuests'],
      ['maxGuests', 'maxGuests'],
    ] as const) {
      if (typeof obj[key] === 'number') put(field, obj[key]);
    }
    const occupancy = object(obj.occupancy)?.value ?? obj.occupancy;
    if (typeof occupancy === 'number') put('maxGuests', occupancy);
    const host = object(obj.host);
    if (host) {
      if (typeof host.name === 'string') put('hostName', host.name);
      if (typeof host.isSuperhost === 'boolean')
        put('isSuperhost', host.isSuperhost);
    }
    const rating = object(obj.aggregateRating);
    if (rating) {
      if (Number.isFinite(Number(rating.ratingValue)))
        put('rating', Number(rating.ratingValue));
      if (Number.isFinite(Number(rating.reviewCount)))
        put('reviewCount', Number(rating.reviewCount));
    }
    const address = object(obj.address);
    if (address) {
      const parts: string[] = [];
      for (const [key, field] of [
        ['streetAddress', 'address'],
        ['addressLocality', 'locality'],
        ['addressRegion', 'region'],
        ['postalCode', 'postalCode'],
        ['addressCountry', 'country'],
      ] as const) {
        const value =
          typeof address[key] === 'string'
            ? address[key]
            : object(address[key])?.name;
        if (typeof value === 'string') {
          put(field, value);
          if (
            ['addressLocality', 'addressRegion', 'addressCountry'].includes(key)
          )
            parts.push(value);
        }
      }
      if (parts.length) put('location', [...new Set(parts)].join(', '));
    }
    const geo = object(obj.geo);
    if (
      geo &&
      typeof geo.latitude === 'number' &&
      Math.abs(geo.latitude) <= 90 &&
      typeof geo.longitude === 'number' &&
      Math.abs(geo.longitude) <= 180
    )
      put('coordinates', { latitude: geo.latitude, longitude: geo.longitude });
    for (const [key, field] of [
      ['amenityFeature', 'amenity'],
      ['amenities', 'amenity'],
      ['houseRules', 'houseRule'],
      ['rules', 'houseRule'],
      ['checkin', 'checkInInstructions'],
      ['checkout', 'checkOutInstructions'],
      ['accessibility', 'accessibility'],
      ['policies', 'listingPolicy'],
      ['cleaning', 'cleaningArrangements'],
    ] as const) {
      const values = Array.isArray(obj[key])
        ? (obj[key] as unknown[])
        : [obj[key]];
      for (const value of values) {
        const record = object(value);
        if (record?.value === false) continue;
        const label = text(record?.name ?? value);
        if (label) put(field, label);
      }
    }
    const listingScoped =
      source === 'json_ld' ||
      identity(obj) === listingId ||
      ancestors.some((record) => identity(record) === listingId);
    if (
      obj.price !== undefined &&
      !pricePath &&
      listingScoped &&
      priceContextMatchesRequest
    ) {
      const mismatch = [...ancestors, obj].some((record) => {
        const pairs = [
          ['checkIn', 'checkIn'],
          ['check_in', 'checkIn'],
          ['checkin', 'checkIn'],
          ['check_in_date', 'checkIn'],
          ['checkOut', 'checkOut'],
          ['check_out', 'checkOut'],
          ['checkout', 'checkOut'],
          ['check_out_date', 'checkOut'],
          ['adults', 'adults'],
          ['children', 'children'],
          ['infants', 'infants'],
          ['pets', 'pets'],
          ['guestCount', 'guestCount'],
          ['guestCount', 'totalGuests'],
          ['guest_count', 'guestCount'],
          ['guest_count', 'totalGuests'],
          ['numberOfGuests', 'guestCount'],
          ['numberOfGuests', 'totalGuests'],
          ['number_of_guests', 'guestCount'],
          ['number_of_guests', 'totalGuests'],
          ['guests', 'guestCount'],
          ['guests', 'totalGuests'],
          ['nights', 'nights'],
        ] as const;
        return pairs.some(
          ([sourceKey, contextKey]) =>
            record[sourceKey] !== undefined &&
            context[contextKey] !== undefined &&
            String(record[sourceKey]) !== String(context[contextKey]),
        );
      });
      if (mismatch) {
        warnings.push(
          'A source price had incompatible booking context and was excluded.',
        );
        return;
      }

      const qualifiers = [...ancestors, obj]
        .flatMap((record) => [
          record.name,
          record.description,
          record.priceType,
          record.priceRole,
          record.unitText,
          record.unitCode,
          record.basis,
          record.period,
        ])
        .filter((value): value is string => typeof value === 'string');
      const label = qualifiers.join(' ');
      const role: PriceRecord['role'] =
        /original|strikethrough|regular price/i.test(label)
          ? 'original'
          : /\b(?:monthly|weekly|promotional)\s+(?:discount|savings?)\b|\b(?:discount|savings?)\s+(?:amount|value)\b/i.test(
                label,
              )
            ? 'ambiguous'
            : /deposit|fee|tax|guest charge/i.test(label)
              ? 'fee'
              : 'current';
      const before = candidates.length;
      const inheritedPriceCurrency = [...ancestors, obj]
        .reverse()
        .map(
          (record) =>
            record.priceCurrency ?? record.currencyCode ?? record.currency,
        )
        .find((value) => value !== undefined);
      addStructuredPrice(
        obj.price,
        role,
        source,
        `${ref}.price`,
        rank,
        qualifiers,
        obj.priceCurrency ??
          obj.currencyCode ??
          obj.currency ??
          inheritedPriceCurrency,
      );
      if (candidates.length === before) {
        priceFailure = true;
        warnings.push('A listing-associated price could not be parsed.');
      }
    }
  };

  // JSON-LD: only listing roots; never walk every page object as a listing.
  const ldRoots: Array<{ obj: Obj; ref: string }> = [];
  $('script[type="application/ld+json"]').each((i, node) => {
    try {
      const root: unknown = JSON.parse($(node).text());
      walk(
        root,
        (obj, path) => {
          if (
            /VacationRental|Apartment|Accommodation|Lodging|House|Room|Hotel|Campground|BedAndBreakfast/i.test(
              String(obj['@type'] ?? ''),
            )
          )
            ldRoots.push({ obj, ref: `json_ld[${i}]${path}` });
        },
        listingId,
      );
    } catch {
      warnings.push('Malformed JSON-LD was ignored.');
    }
  });
  const associated = ldRoots.filter(({ obj }) => {
    const id = identity(obj) ?? String(obj.identifier ?? '');
    const link = String(obj.url ?? obj['@id'] ?? '');
    const linkId = link.match(/\/rooms\/(\d+)/)?.[1];
    return id === listingId || linkId === listingId;
  });
  const ld = associated.length
    ? associated
    : ldRoots.length === 1 &&
        !/\/rooms\/\d+/.test(
          String(ldRoots[0]!.obj.url ?? ldRoots[0]!.obj['@id'] ?? ''),
        ) &&
        !ldRoots[0]!.obj.identifier &&
        !ldRoots[0]!.obj.listingId
      ? ldRoots
      : [];
  for (const { obj, ref } of ld) {
    const rank = associated.length ? 80 : 50;
    addText('listingTitle', obj.name ?? obj.headline, 'json_ld', ref, rank);
    addText('description', obj.description, 'json_ld', ref, rank);
    if (
      !/^(VacationRental|Accommodation|LodgingBusiness)$/i.test(
        String(obj['@type']),
      )
    )
      addType(String(obj['@type']), 'json_ld', ref, rank);
    const imgs = Array.isArray(obj.image) ? obj.image : [obj.image];
    imgs.forEach((value) =>
      image(object(value)?.url ?? value, 'json_ld', ref, rank),
    );
    walk(
      obj,
      (record, path, ancestors) =>
        processObject(record, 'json_ld', `${ref}${path}`, rank, ancestors),
      listingId,
    );
  }

  $('script[type="application/json"]').each((i, node) => {
    try {
      const root: unknown = JSON.parse($(node).text());
      if ($(node).attr('id') === 'data-injector-instances')
        walk(
          root,
          (record, path) => {
            const rawCurrency = record.serverDeterminedCurrency;
            if (typeof rawCurrency !== 'string') return;
            const currency = normalizeCurrency(rawCurrency);
            if (currency)
              add(
                'currency',
                currency,
                rawCurrency,
                'embedded_json',
                `bootstrap[${i}]${path}.serverDeterminedCurrency`,
                75,
                JSON.stringify({ serverDeterminedCurrency: rawCurrency }),
              );
          },
          listingId,
        );
      const matched: Array<{ obj: Obj; ref: string }> = [];
      // Match a detail-page container only when its share/embed identity matches.
      walk(
        root,
        (obj, path) => {
          if (identity(obj) === listingId)
            matched.push({ obj, ref: `embedded[${i}]${path}` });
          const sections = object(obj.sections);
          if (Array.isArray(sections?.sections)) {
            const embeddedIds = new Set<string>();
            for (const entry of sections.sections) {
              const embed = object(
                object(object(object(entry)?.section)?.shareSave)?.embedData,
              );
              if (embed && identity(embed)) embeddedIds.add(identity(embed)!);
            }
            if (embeddedIds.size > 1) return;
            let matches = false;
            walk(
              sections.sections,
              (child) => {
                if (identity(child) === listingId) matches = true;
              },
              listingId,
            );
            if (matches) matched.push({ obj, ref: `embedded[${i}]${path}` });
          }
        },
        listingId,
      );
      const roots = matched.filter(
        ({ ref }) =>
          !matched.some(
            (other) => other.ref !== ref && ref.startsWith(other.ref + '.'),
          ),
      );
      for (const { obj, ref } of roots) {
        const descriptions: string[] = [];
        walk(
          obj,
          (record, path, ancestors) => {
            const reference = ref + path;
            processObject(record, 'embedded_json', reference, 100, ancestors);
            if (
              /^(DemandStayListing|StayListing)$/.test(
                String(record.__typename),
              ) &&
              identity(record) === listingId
            ) {
              const presentation = object(record.pdpPresentation);
              const source = 'embedded_json' as const;
              const titleContent = object(object(presentation?.title)?.content);
              addText(
                'listingTitle',
                titleContent?.localizedString ?? titleContent?.source,
                source,
                reference + '.pdpPresentation.title',
                120,
              );
              const descriptions = object(presentation?.descriptions);
              const fullDescription = object(descriptions?.longDescriptionHtml);
              addText(
                'description',
                fullDescription?.localizedStringWithTranslationPreference ??
                  fullDescription?.localizedString,
                source,
                reference + '.pdpPresentation.descriptions.longDescriptionHtml',
                120,
              );
              const location = object(presentation?.location);
              addText(
                'location',
                location?.subtitle,
                source,
                reference + '.pdpPresentation.location.subtitle',
                120,
              );
              const overview = object(presentation?.overview);
              if (typeof overview?.title === 'string') {
                const split = typeLocation(overview.title);
                if (split) {
                  addType(
                    split[1],
                    source,
                    reference + '.pdpPresentation.overview.title',
                    115,
                  );
                  addText(
                    'location',
                    split[2],
                    source,
                    reference + '.pdpPresentation.overview.title',
                    105,
                  );
                }
              }
              if (Array.isArray(overview?.items))
                for (const item of overview.items)
                  if (typeof item === 'string')
                    addCounts(
                      item,
                      source,
                      reference + '.pdpPresentation.overview.items',
                      120,
                    );
              const passport = object(
                object(presentation?.hostInfo)?.passportData,
              );
              if (passport) {
                addText(
                  'hostName',
                  passport.name,
                  source,
                  reference + '.pdpPresentation.hostInfo.passportData.name',
                  120,
                );
                if (typeof passport.isSuperhost === 'boolean')
                  add(
                    'isSuperhost',
                    passport.isSuperhost,
                    passport.isSuperhost,
                    source,
                    reference +
                      '.pdpPresentation.hostInfo.passportData.isSuperhost',
                    120,
                  );
              }
              const rating = object(
                object(record.listingRatingStats)?.overallRatingStats,
              );
              if (rating)
                for (const [key, field] of [
                  ['ratingAverage', 'rating'],
                  ['ratingCount', 'reviewCount'],
                ] as const) {
                  if (
                    rating[key] !== null &&
                    rating[key] !== undefined &&
                    Number.isFinite(Number(rating[key]))
                  )
                    add(
                      field,
                      Number(rating[key]),
                      rating[key],
                      source,
                      reference +
                        '.listingRatingStats.overallRatingStats.' +
                        key,
                      120,
                    );
                }
              const amenities = object(presentation?.amenities);
              if (amenities)
                walk(
                  amenities,
                  (amenity, path) => {
                    if (
                      amenity.__typename === 'AmenityItem' &&
                      amenity.available === true
                    )
                      addText(
                        'amenity',
                        amenity.title,
                        source,
                        reference + '.pdpPresentation.amenities' + path,
                        120,
                      );
                  },
                  listingId,
                );
              const rules = object(presentation?.rules);
              if (rules)
                walk(
                  rules,
                  (rule, path) => {
                    if (rule.__typename === 'StaysPdpDetailItem') {
                      const label = text(rule.title);
                      const detail = text(object(rule.description)?.text);
                      if (label)
                        addText(
                          /CHECK_IN/.test(String(rule.type))
                            ? 'checkInInstructions'
                            : /CHECK_OUT/.test(String(rule.type))
                              ? 'checkOutInstructions'
                              : 'houseRule',
                          [label, detail].filter(Boolean).join(': '),
                          source,
                          reference + '.pdpPresentation.rules' + path,
                          120,
                        );
                    }
                  },
                  listingId,
                );
              const sharing = object(presentation?.sharingConfig);
              addType(
                sharing?.propertyType,
                source,
                reference + '.pdpPresentation.sharingConfig.propertyType',
                120,
              );
              image(
                sharing?.imageUrl,
                source,
                reference + '.pdpPresentation.sharingConfig.imageUrl',
                120,
              );
            }

            if (identity(record) === listingId) {
              addText(
                'listingTitle',
                record.name ?? record.title,
                'embedded_json',
                reference,
                100,
              );
              addText(
                'description',
                record.description,
                'embedded_json',
                reference,
                100,
              );
              addType(
                record.propertyType ?? record.roomType,
                'embedded_json',
                reference,
                100,
              );
              const privacyLabel = String(
                record.spaceType ?? record.roomType ?? '',
              ).replaceAll('_', ' ');
              const privacy = /private room/i.test(privacyLabel)
                ? 'private_room'
                : /shared room/i.test(privacyLabel)
                  ? 'shared_room'
                  : /hotel room/i.test(privacyLabel)
                    ? 'hotel_room'
                    : /entire home|entire place/i.test(privacyLabel)
                      ? 'entire_place'
                      : null;
              add(
                'bookingType',
                privacy,
                privacyLabel,
                'embedded_json',
                reference + '.spaceType',
                115,
              );
              image(
                record.pictureUrl ?? record.coverPhotoUrl,
                'embedded_json',
                reference,
                110,
              );
              addText(
                'location',
                record.location ?? record.locationTitle,
                'embedded_json',
                reference,
                100,
              );
            }
            if (typeof record.title === 'string') {
              addCounts(record.title, 'embedded_json', reference, 90);
              const typeLocationMatch = typeLocation(record.title);
              if (
                typeLocationMatch &&
                normalizeAccommodation(typeLocationMatch[1]!).accommodationType
              ) {
                addType(typeLocationMatch[1], 'embedded_json', reference, 95);
                addText(
                  'location',
                  typeLocationMatch[2],
                  'embedded_json',
                  reference,
                  90,
                );
              }
            }
            if (
              typeof record.baseUrl === 'string' &&
              /mediaItems|photo|gallery/i.test(path)
            )
              image(record.baseUrl, 'embedded_json', reference, 90);
            if (
              record.__typename === 'GeneralListContentSection' &&
              Array.isArray(record.items)
            ) {
              for (const item of record.items) {
                const entry = object(item);
                const body = text(object(entry?.html)?.htmlText);
                if (body)
                  descriptions.push(
                    [text(entry?.title), body].filter(Boolean).join('\n'),
                  );
              }
            }
          },
          listingId,
        );
        if (descriptions.length)
          add(
            'description',
            [...new Set(descriptions)].join('\n\n'),
            [...new Set(descriptions)].join('\n\n'),
            'embedded_json',
            ref,
            110,
          );
      }
    } catch {
      warnings.push('Malformed embedded JSON was ignored.');
    }
  });

  // Metadata is page-scoped fallback; visible extraction excludes recommendations and navigation.
  for (const [selector, field] of [
    ['meta[property="og:title"]', 'listingTitle'],
    ['meta[name="twitter:title"]', 'listingTitle'],
    ['meta[property="og:description"]', 'description'],
    ['meta[name="description"]', 'description'],
  ] as const) {
    $(selector).each((i, node) =>
      addText(
        field,
        $(node).attr('content'),
        'metadata',
        `${selector}[${i}]`,
        20,
      ),
    );
  }
  for (const selector of [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
  ])
    $(selector).each((i, node) =>
      image(
        $(node).attr('content'),
        'metadata',
        `${selector}[${i}]`,
        selector.includes('twitter') ? 30 : 75,
      ),
    );
  // Airbnb exposes discounted booking totals in the price button's accessible
  // label, while omitting the amount from embedded listing JSON. Capture that
  // explicit price before controls are removed from visible-page extraction.
  $(
    '[data-testid="book-it-default"] button[aria-haspopup="dialog"], [data-xray-jira-component*="Price"] button[aria-haspopup="dialog"]',
  ).each((i, node) => {
    const label = $(node).attr('aria-label') ?? $(node).text();
    if (!label || label.length > 240) return;
    const discounted = label.match(
      /(.+?)\s+for\s+(\d+)\s+nights?,\s*originally\s+(.+)$/i,
    );
    const ref = `booking-price[${i}]`;
    if (discounted) {
      const [, currentAmount, nights, originalAmount] = discounted;
      const qualifier = `for ${nights} nights`;
      addPrices(
        `${currentAmount} ${qualifier}`,
        'visible_html',
        ref,
        90,
        'current',
      );
      addPrices(
        `${originalAmount} ${qualifier}`,
        'visible_html',
        ref,
        90,
        'original',
      );
      return;
    }
    if (
      /\bfor\s+\d+\s+nights?\b|per\s+(?:night|week|month)|\/\s*(?:night|week|month)\b|\btotal\b/i.test(
        label,
      ) &&
      !/original|strikethrough|saving|discount amount/i.test(label)
    )
      addPrices(label, 'visible_html', ref, 85, 'current');
  });
  $(
    'script, style, noscript, nav, footer, header, aside, form, button, [hidden], [aria-hidden="true"], [data-testid*="recommend"], [data-testid*="similar"]',
  ).remove();
  const main = $('main').length ? $('main').first() : $('body');
  addText(
    'listingTitle',
    main.find('h1').first().text(),
    'visible_html',
    'h1',
    85,
  );
  main.find('h1, h2, h3').each((i, heading) => {
    const label = $(heading).text().trim();
    if (
      /^(about this space|description|the space|other things to note)$/i.test(
        label,
      )
    ) {
      const section = $(heading).closest('section');
      if (section.length)
        addText(
          'description',
          section.text(),
          'visible_html',
          `section[${i}]`,
          40,
        );
    }
  });
  main
    .find(
      'p, [data-testid="listing-location"], [data-section-id="OVERVIEW_DEFAULT"]',
    )
    .each((i, node) => {
      const value = $(node).text().trim();
      const ref = `visible[${i}]`;
      if (!value || value.length > 1500) return;
      if (!/selected|booking|reservation|adults|children/i.test(value))
        addCounts(value, 'visible_html', ref, 60);
      const location = value.match(/^(?:location|located in)\s*:\s*(.+)$/i);
      if (location) addText('location', location[1], 'visible_html', ref, 60);
      const typeLocationMatch = typeLocation(value);
      if (
        typeLocationMatch &&
        (normalizeAccommodation(typeLocationMatch[1]!).accommodationType ||
          /private room|shared room|hotel room/i.test(typeLocationMatch[1]!))
      ) {
        addType(typeLocationMatch[1], 'visible_html', ref, 65);
        addText('location', typeLocationMatch[2], 'visible_html', ref, 65);
      }
      const host = value.match(/^Hosted by\s+(.+)$/i);
      if (host) addText('hostName', host[1], 'visible_html', ref, 60);
      if ($(node).is('[data-testid="listing-location"]'))
        addText('location', value, 'visible_html', ref, 65);
      const struck = $(node).find('s, del').text();
      if (struck) {
        addPrices(
          [struck, value.match(/for\s+\d+\s+nights?/i)?.[0]]
            .filter(Boolean)
            .join(' '),
          'visible_html',
          ref,
          65,
          'original',
        );
        const copy = $(node).clone();
        copy.find('s, del').remove();
        addPrices(copy.text(), 'visible_html', ref, 65);
      } else if (
        /night|week|month|total|price|deposit|fee|tax/i.test(value) &&
        extractPrices(value).length
      )
        addPrices(value, 'visible_html', ref, 60);
    });
  // Discounted Airbnb totals are sometimes rendered in nested non-paragraph
  // price rows. Pair the struck-through amount with the nearest compact
  // container's remaining amount and booking qualifier.
  main.find('s, del').each((i, node) => {
    const originalAmount = $(node).text().trim();
    if (!originalAmount || !extractPrices(originalAmount).length) return;
    let container = $(node).parent();
    for (let depth = 0; depth < 6 && container.length; depth += 1) {
      const content = container.text().replace(/\s+/g, ' ').trim();
      if (content.length > 360) break;
      const current = container.clone();
      current.find('s, del').remove();
      const currentText = current.text().replace(/\s+/g, ' ').trim();
      const hasPriceBasis =
        /for\s+\d+\s+nights?|per\s+(?:night|week|month)|\/\s*(?:night|week|month)\b|\btotal\b/i.test(
          content,
        );
      if (hasPriceBasis && extractPrices(currentText).length) {
        const ref = `discounted-price[${i}]`;
        const qualifier =
          content.match(/for\s+\d+\s+nights?/i)?.[0] ??
          content.match(/(?:per\s+)?(?:night|week|month)|\btotal\b/i)?.[0] ??
          '';
        addPrices(
          `${originalAmount} ${qualifier}`,
          'visible_html',
          ref,
          75,
          'original',
        );
        addPrices(currentText, 'visible_html', ref, 75, 'current');
        break;
      }
      container = container.parent();
    }
  });
  const visibleBaht = findBahtCurrencyEvidence(main.text());
  if (visibleBaht)
    add(
      'currency',
      visibleBaht.currency,
      visibleBaht.quote,
      'visible_html',
      'listing-text',
      60,
      visibleBaht.quote,
    );

  // Semantics beat source rank: generic SEO titles and generic types cannot override specifics.
  const genericTitle = (value: unknown) =>
    /(?: - Airbnb$)|^(?:rental unit|room|home|apartment|property|villa|farm stay)\s+in\b|\s·\s.*(?:bed|bath|★|airbnb)/i.test(
      String(value),
    );
  for (const candidate of candidates) {
    if (candidate.field === 'price') {
      const price = candidate.value as PriceRecord;
      if (price.basis === 'unknown') candidate.rank -= 40;
      else if (price.basis === 'stay_total') candidate.rank += 20;
    }
    if (candidate.field === 'listingTitle' && genericTitle(candidate.value))
      candidate.rank = 5;
  }
  if (Object.keys(context).length)
    add(
      'bookingContext',
      context,
      originalUrl.href,
      'url',
      'URL.searchParams',
      120,
    );
  if (typeof context.currency === 'string')
    add(
      'currency',
      context.currency,
      context.currency,
      'url',
      'URL.searchParams.currency',
      120,
    );
  const fields = [...new Set(candidates.map((candidate) => candidate.field))];
  const selected: Candidate[] = [];
  const conflicts: Array<{
    field: string;
    values: unknown[];
    resolution: string;
  }> = [];
  const multiple = new Set([
    'amenity',
    'houseRule',
    'listingImage',
    'listingPolicy',
    'accessibility',
  ]);
  const payablePricePriority = (candidate: Candidate) => {
    const price = candidate.value as PriceRecord;
    const basisPriority =
      price.basis === 'stay_total'
        ? 600
        : ['nightly_rate', 'weekly_rate', 'monthly_rent'].includes(price.basis)
          ? 500
          : price.basis === 'unknown'
            ? 300
            : 0;
    const rolePriority = price.role === 'current' ? 100 : 0;
    const explicitPriority = price.basisExplicit ? 25 : 0;
    return (
      basisPriority + rolePriority + explicitPriority + candidate.rank / 1000
    );
  };
  for (const field of fields) {
    const list = candidates
      .filter((candidate) => candidate.field === field)
      .sort((a, b) =>
        field === 'price'
          ? payablePricePriority(b) - payablePricePriority(a)
          : b.rank - a.rank,
      );
    const unique = list.filter(
      (candidate, i) =>
        list.findIndex(
          (other) =>
            JSON.stringify(other.value) === JSON.stringify(candidate.value),
        ) === i,
    );
    if (multiple.has(field)) {
      selected.push(...unique.slice(0, field === 'listingImage' ? 30 : 100));
      continue;
    }
    if (
      field === 'price' ||
      field === 'originalPrice' ||
      field === 'ambiguousPrice'
    ) {
      // Fees remain separate; competing payable amounts at the same rank require abstention.
      const fees = unique.filter(
        (candidate) => (candidate.value as PriceRecord).role === 'fee',
      );
      selected.push(...fees);
      const payable = unique.filter(
        (candidate) => (candidate.value as PriceRecord).role !== 'fee',
      );
      const bestPriority = payable[0]
        ? payablePricePriority(payable[0])
        : undefined;
      const best = payable.filter(
        (candidate) => payablePricePriority(candidate) === bestPriority,
      );
      const signatures = new Set(
        best.map((candidate) => {
          const p = candidate.value as PriceRecord;
          return `${p.amount}:${p.currency}:${p.basis}`;
        }),
      );
      if (signatures.size > 1) {
        conflicts.push({
          field,
          values: best.map((candidate) => candidate.value),
          resolution: 'abstained',
        });
        selected.push(
          ...best.map((candidate) => ({
            ...candidate,
            field: 'ambiguousPrice',
          })),
        );
        const disputedBases = new Set(
          best.map((candidate) => (candidate.value as PriceRecord).basis),
        );
        selected.push(
          ...payable.filter(
            (candidate) =>
              !best.includes(candidate) &&
              !disputedBases.has((candidate.value as PriceRecord).basis),
          ),
        );
      } else selected.push(...payable);
      continue;
    }
    if (unique.length > 1)
      conflicts.push({
        field,
        values: unique.slice(0, 5).map((candidate) => candidate.value),
        resolution:
          unique[0]!.rank === unique[1]!.rank
            ? 'abstained'
            : 'specific_source_precedence',
      });
    if (unique[0] && !(unique[1] && unique[0].rank === unique[1].rank))
      selected.push(unique[0]);
  }
  const get = (field: string) =>
    selected.find((candidate) => candidate.field === field)?.value;
  const original = get('originalPrice') as PriceRecord | undefined;
  const currentCandidate = selected.find(
    (candidate) =>
      candidate.field === 'price' &&
      (candidate.value as PriceRecord).role === 'current',
  );
  const current = currentCandidate?.value as PriceRecord | undefined;
  if (
    original &&
    current &&
    original.currency === current.currency &&
    original.amount > current.amount
  )
    current.discountPresent = true;
  // Only a current, explicit monthly claim populates the legacy monthly field.
  if (current?.basis === 'monthly_rent')
    selected.push({
      ...currentCandidate!,
      field: 'monthlyRent',
      value: current.amount,
    });
  if (current?.currency)
    selected.push({
      ...currentCandidate!,
      field: 'currency',
      value: current.currency,
    });
  const explicitPriceBasis = get('priceBasis');
  const deposits = selected.filter(
    (candidate) =>
      candidate.field === 'price' &&
      (candidate.value as PriceRecord).basis === 'deposit',
  );
  if (
    new Set(
      deposits.map((candidate) => {
        const p = candidate.value as PriceRecord;
        return `${p.amount}:${p.currency}`;
      }),
    ).size === 1
  ) {
    const candidate = deposits[0]!;
    const price = candidate.value as PriceRecord;
    selected.push({
      ...candidate,
      field: 'depositAmount',
      value: price.amount,
    });
    if (price.currency)
      selected.push({
        ...candidate,
        field: 'depositCurrency',
        value: price.currency,
      });
  }
  const sourceId = randomUUID();
  const evidence: string[] = [];
  let evidenceLength = 0;
  let factPayloadBytes = 0;
  const facts: ExtractedFact[] = [];
  for (const candidate of selected) {
    if (!candidate.quote) continue;
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate));
    if (factPayloadBytes + candidateBytes > 400_000) {
      warnings.push(
        'Normalized evidence payload limit excluded additional facts.',
      );
      continue;
    }
    factPayloadBytes += candidateBytes;
    if (
      candidate.quote.length > 60_000 ||
      evidenceLength + candidate.quote.length > 150_000
    ) {
      warnings.push(`Evidence payload limit excluded ${candidate.field}.`);
      continue;
    }
    if (!evidence.includes(candidate.quote)) {
      evidence.push(candidate.quote);
      evidenceLength += candidate.quote.length + 2;
    }
    facts.push({
      id: randomUUID(),
      sourceId,
      fieldName: candidate.field,
      normalizedValue: candidate.value,
      quotedEvidence: candidate.quote,
      extractionMethod:
        candidate.source === 'json_ld'
          ? 'json_ld'
          : candidate.source === 'metadata'
            ? 'metadata'
            : 'text',
      provenance: {
        sourceType: candidate.source,
        sourceReference: candidate.ref,
        rawValue: candidate.raw,
        explicit: true,
        quality: candidate.rank <= 50 ? 'page_fallback' : 'listing_specific',
      },
    });
  }
  const prices = facts
    .filter((fact) => fact.fieldName === 'price')
    .map((fact) => fact.normalizedValue as PriceRecord);
  const restricted =
    /captcha|access denied|verify you are human|not authorized/i.test(
      main.text(),
    );
  const priceStatus = prices.some(
    (price) =>
      price.role === 'current' &&
      Number.isFinite(price.amount) &&
      price.amount > 0 &&
      price.basisExplicit &&
      Boolean(price.currency) &&
      ['monthly_rent', 'nightly_rate', 'weekly_rate', 'stay_total'].includes(
        price.basis,
      ),
  )
    ? 'extracted'
    : selected.some((candidate) => candidate.field === 'ambiguousPrice')
      ? 'ambiguous'
      : restricted
        ? 'source_restricted'
        : priceFailure
          ? 'extraction_failed'
          : 'not_in_response';
  if (priceStatus !== 'extracted')
    warnings.push(
      `Booking price ${priceStatus.replaceAll('_', ' ')}; no booking total was inferred.`,
    );
  const description =
    typeof get('description') === 'string' ? String(get('description')) : null;
  const title =
    typeof get('listingTitle') === 'string'
      ? String(get('listingTitle'))
      : null;
  const imgs = selected
    .filter((candidate) => candidate.field === 'listingImage')
    .map((candidate) => String(candidate.value));
  const cover = selected.find(
    (candidate) => candidate.field === 'listingImage',
  );
  const descriptionCandidate = selected.find(
    (candidate) => candidate.field === 'description',
  );
  return {
    source: sealEvidenceSource({
      id: sourceId,
      type: 'listing_url',
      name: title ?? url.hostname,
      normalizedFacts: facts,
      originalUrl: originalUrl.href,
      retrievedAt: new Date().toISOString(),
      extractedText:
        evidence.join('\n\n') || main.text().trim().slice(0, 20_000) || null,
      extractionStatus: 'complete',
    }),
    facts,
    listingId,
    listingTitle: title,
    fallbackTitle: title && genericTitle(title) ? title : null,
    titleIsFallback: title ? genericTitle(title) : false,
    canonicalUrl: url.origin + `/rooms/${listingId}`,
    description,
    descriptionIsFallback: descriptionCandidate?.source === 'metadata',
    descriptionSource:
      descriptionCandidate?.source === 'embedded_json'
        ? ('airbnb_public_data' as const)
        : descriptionCandidate?.source === 'json_ld'
          ? ('json_ld' as const)
          : descriptionCandidate?.source === 'visible_html'
            ? ('visible_section' as const)
            : description
              ? ('meta_description' as const)
              : null,
    descriptionTruncated:
      descriptionTruncated ||
      (descriptionCandidate?.source === 'metadata' &&
        /(?:\.\.\.|…)\s*$/.test(description ?? '')),
    ...(descriptionOriginalLength ? { descriptionOriginalLength } : {}),
    imageUrl: imgs[0] ?? null,
    images: imgs,
    ...(cover
      ? {
          listingImage: {
            url: String(cover.value),
            source:
              cover.source === 'embedded_json'
                ? ('airbnb_public_data' as const)
                : cover.source === 'json_ld'
                  ? ('json_ld' as const)
                  : cover.ref.includes('twitter')
                    ? ('twitter:image' as const)
                    : ('og:image' as const),
            extractionMethod:
              cover.source === 'embedded_json'
                ? ('embedded_json' as const)
                : cover.source === 'json_ld'
                  ? ('json_ld' as const)
                  : ('metadata' as const),
          },
        }
      : {}),
    hostName:
      typeof get('hostName') === 'string' ? String(get('hostName')) : null,
    guestCapacity:
      typeof get('maxGuests') === 'number' ? Number(get('maxGuests')) : null,
    accommodationType:
      typeof get('accommodationType') === 'string'
        ? String(get('accommodationType'))
        : null,
    bookingType:
      typeof get('bookingType') === 'string'
        ? String(get('bookingType'))
        : null,
    currency:
      typeof get('currency') === 'string'
        ? String(get('currency'))
        : (current?.currency ?? null),
    priceBasis:
      current?.basis ??
      (typeof explicitPriceBasis === 'string'
        ? (explicitPriceBasis as PriceRecord['basis'])
        : null),
    amenities: facts
      .filter((fact) => fact.fieldName === 'amenity')
      .map((fact) => String(fact.normalizedValue)),
    houseRules: facts
      .filter((fact) => fact.fieldName === 'houseRule')
      .map((fact) => String(fact.normalizedValue)),
    bookingContext: context,
    prices,
    priceStatus,
    extractionWarnings: [...new Set(warnings)],
    conflicts,
  };
}

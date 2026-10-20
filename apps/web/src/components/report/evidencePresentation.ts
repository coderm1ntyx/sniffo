import { safeSourceUrl } from './reportPresentation';
import type { ExtractedFact } from '@sniffo/shared';

export function evidenceFieldKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const fieldLabels: Record<string, string> = {
  accommodationtype: 'Property type',
  address: 'Address',
  amenity: 'Amenity',
  amenities: 'Amenities',
  bathroomcount: 'Bathrooms',
  bedcount: 'Beds',
  bedroomcount: 'Bedrooms',
  bookingcontext: 'Booking dates',
  checkin: 'Check-in',
  checkinInstructions: 'Check-in instructions',
  checkout: 'Check-out',
  checkoutinstructions: 'Check-out instructions',
  city: 'City',
  currency: 'Currency',
  guestcapacity: 'Maximum guests',
  houseRule: 'House rules',
  hostName: 'Host',
  listingimage: 'Property photo',
  listingtitle: 'Listing title',
  location: 'Location',
  maxguests: 'Maximum guests',
  monthlyrent: 'Monthly rent',
  neighborhood: 'Neighborhood',
  price: 'Price',
  priceamount: 'Price',
  propertytype: 'Property type',
  rating: 'Rating',
  ratingaverage: 'Rating',
  reviewcount: 'Reviews',
  title: 'Listing title',
};

const labelByKey = Object.fromEntries(
  Object.entries(fieldLabels).map(([key, label]) => [
    evidenceFieldKey(key),
    label,
  ]),
);

export function evidenceFieldLabel(fieldName: string) {
  return (
    labelByKey[evidenceFieldKey(fieldName)] ??
    fieldName
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
  );
}

export function safeEvidenceLink(value: unknown) {
  return typeof value === 'string' ? safeSourceUrl(value) : undefined;
}

const sourceContextParameters = new Set([
  'adults',
  'amenities',
  'check_in',
  'check_out',
  'checkin',
  'checkout',
  'children',
  'date_picker_type',
  'dynamic_product_ids',
  'federated_search_id',
  'infants',
  'map_toggle',
  'omni_page_id',
  'photo_id',
  'previous_page_section_name',
  'room_types',
  'lat',
  'lng',
  'place_id',
  'query',
  'search',
  'search_mode',
  'source_impression_id',
  'pets',
]);

export function cleanSourceUrl(value: string | null) {
  const safeUrl = value ? safeSourceUrl(value) : undefined;
  if (!safeUrl) return undefined;

  const url = new URL(safeUrl);
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLocaleLowerCase().replace(/\[\]$/, '');
    if (
      sourceContextParameters.has(normalizedKey) ||
      normalizedKey.startsWith('utm_') ||
      ['fbclid', 'gclid', 'msclkid'].includes(normalizedKey)
    ) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

export function evidenceCurrencyCode(value: unknown): string | undefined {
  if (typeof value === 'string' && /^[A-Z]{3}$/i.test(value.trim()))
    return value.trim().toUpperCase();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (/currency/i.test(key) && typeof nested === 'string') {
      const code = nested.match(/\b[A-Z]{3}\b/i)?.[0];
      if (code) return code.toUpperCase();
    }
  }
  return undefined;
}

export function formatCurrencyCode(value: unknown) {
  const code = evidenceCurrencyCode(value);
  if (!code) return null;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

export function formatEvidenceDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  )
    return null;
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function bookingDateSummary(value: unknown) {
  let booking: Record<string, unknown> | undefined;
  if (typeof value === 'string') {
    const sourceUrl = safeEvidenceLink(value);
    if (sourceUrl) {
      try {
        const params = new URL(sourceUrl).searchParams;
        booking = {
          checkIn:
            params.get('check_in') ??
            params.get('checkIn') ??
            params.get('checkin'),
          checkOut:
            params.get('check_out') ??
            params.get('checkOut') ??
            params.get('checkout'),
        };
      } catch {
        return null;
      }
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    booking = value as Record<string, unknown>;
  }
  if (!booking) return null;
  const get = (key: string) =>
    Object.entries(booking!).find(
      ([name]) => evidenceFieldKey(name) === evidenceFieldKey(key),
    )?.[1];
  const checkIn = formatEvidenceDate(get('checkIn'));
  const checkOut = formatEvidenceDate(get('checkOut'));
  const nights = Number(get('nights'));
  const dates =
    checkIn && checkOut
      ? `${checkIn} – ${checkOut}`
      : checkIn
        ? `From ${checkIn}`
        : checkOut
          ? `Until ${checkOut}`
          : '';
  const nightCount =
    nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '';
  return [dates, nightCount].filter(Boolean).join(' · ') || null;
}

export function formatEvidenceValue(
  value: unknown,
  fieldName = '',
): string | null {
  if (value === null || value === undefined) return null;
  const key = evidenceFieldKey(fieldName);
  if (/bookingcontext/.test(key)) return bookingDateSummary(value);
  if (/currency/.test(key)) return formatCurrencyCode(value);
  if (typeof value === 'string') {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (!clean || safeEvidenceLink(clean)) return null;
    if (/^(?:checkin|checkout|arrival|departure)$/.test(key))
      return formatEvidenceDate(clean) ?? clean;
    return clean;
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return (
      value
        .map((item) => formatEvidenceValue(item, fieldName))
        .filter((item): item is string => Boolean(item))
        .join(' · ') || null
    );
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const photo = record.url ?? record.imageUrl;
    if (/listingimage|photo|image/.test(key) && safeEvidenceLink(photo))
      return null;
    if ('amount' in record && typeof record.amount === 'number') {
      const code = evidenceCurrencyCode(record.currency);
      if (!code) return record.amount.toLocaleString('en');
      try {
        return new Intl.NumberFormat('en', {
          style: 'currency',
          currency: code,
          maximumFractionDigits: 2,
        }).format(record.amount);
      } catch {
        return `${code} ${record.amount.toLocaleString('en')}`;
      }
    }
    const currency = formatCurrencyCode(record);
    if (currency && Object.keys(record).every((name) => /currency/i.test(name)))
      return currency;
    return (
      Object.entries(record)
        .map(([name, nested]) => {
          if (safeEvidenceLink(nested)) return null;
          const text = formatEvidenceValue(nested, name);
          return text ? `${evidenceFieldLabel(name)}: ${text}` : null;
        })
        .filter((item): item is string => Boolean(item))
        .join(' · ') || null
    );
  }
  return null;
}

export function sourcePlatformLabel(
  sourceType: string,
  originalUrl: string | null,
) {
  const url = safeEvidenceLink(originalUrl);
  if (!url) return sourceType;
  const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  const platform = hostname.includes('airbnb.')
    ? 'Airbnb'
    : hostname.includes('booking.com')
      ? 'Booking.com'
      : hostname.includes('agoda.')
        ? 'Agoda'
        : hostname;
  return `${platform} [${sourceType}]`;
}

export function groupSourceEvidenceFacts(facts: ExtractedFact[]) {
  const photos = new Map<string, ExtractedFact>();
  const amenities = new Set<string>();
  const rules = new Set<string>();

  for (const fact of facts) {
    const key = evidenceFieldKey(fact.fieldName);
    const values = Array.isArray(fact.normalizedValue)
      ? fact.normalizedValue
      : [fact.normalizedValue];

    if (/listingimage|photo|image/.test(key)) {
      for (const value of values) {
        const url =
          typeof value === 'string'
            ? safeEvidenceLink(value)
            : value && typeof value === 'object' && !Array.isArray(value)
              ? safeEvidenceLink(
                  (value as Record<string, unknown>).url ??
                    (value as Record<string, unknown>).imageUrl,
                )
              : undefined;
        if (url && !photos.has(url)) photos.set(url, fact);
      }
    } else if (/^(amenity|amenities)$/.test(key)) {
      values.forEach((value) => {
        const text = formatEvidenceValue(value, fact.fieldName);
        if (text) amenities.add(text);
      });
    } else if (/^(houserule|houserules)$/.test(key)) {
      values.forEach((value) => {
        const text = formatEvidenceValue(value, fact.fieldName);
        if (text) rules.add(text);
      });
    }
  }

  return {
    photos: [...photos.entries()].map(([url, fact]) => ({ url, fact })),
    amenities: [...amenities],
    rules: [...rules],
  };
}

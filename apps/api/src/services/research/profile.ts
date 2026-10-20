import type {
  EvidenceSource,
  ExtractedFact,
  PriceRecord,
} from '@sniffo/shared';
import { PriceRecordSchema } from '@sniffo/shared';
import { normalize } from '../verification/claims.js';
import { canonicalKey } from './cache.js';

export type PropertyProfile = {
  source: EvidenceSource;
  facts: ExtractedFact[];
  title: string;
  description: string;
  category: string;
  transaction: 'sale' | 'rent' | 'unknown';
  arrangement: 'nightly' | 'monthly' | 'unknown';
  privacy: string;
  location: string;
  address: string;
  unit: string;
  listingId: string | null;
  canonicalUrl: string | null;
  images: string[];
  prices: PriceRecord[];
};
export function profile(
  source: EvidenceSource,
  facts = source.normalizedFacts ?? [],
): PropertyProfile {
  const get = (key: string) =>
    facts.find((f) => f.fieldName === key)?.normalizedValue;
  const text = source.extractedText ?? '';
  const classify = (value: string) =>
    /\bhotel\b|\bserviced\b|โรงแรม/i.test(value)
      ? 'hotel'
      : /private room|shared room|ห้องส่วนตัว/i.test(value)
        ? 'room'
        : /\bland\b|ที่ดิน/i.test(value)
          ? 'land'
          : /\boffice\b|\bshop\b|\bcommercial\b|สำนักงาน/i.test(value)
            ? 'commercial'
            : /\bvilla\b|\bhouse\b|\btownhouse\b|\bbungalow\b|บ้าน|วิลล่า/i.test(
                  value,
                )
              ? 'house'
              : /\bcondo(?:minium)?\b|\bapartment\b|\bflat\b|คอนโด|อพาร์ท/i.test(
                    value,
                  )
                ? 'apartment'
                : 'unknown';
  const explicitCategory = classify(String(get('propertyType') ?? ''));
  const category =
    explicitCategory !== 'unknown'
      ? explicitCategory
      : classify(
          `${source.name}\n${String(get('listingTitle') ?? '')}\n${text.split(/[.!?]/)[0] ?? ''}`,
        );
  const prices = facts
    .filter((f) => f.fieldName === 'price')
    .flatMap((f) => {
      const p = PriceRecordSchema.safeParse(f.normalizedValue);
      return p.success ? [p.data] : [];
    });
  const unit =
    text
      .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
      .match(
        /(?:\bunit\b|\broom\s+(?:number|no\.?|#)|ห้องเลขที่)\s*(?:no\.?|number|#|:)?\s*([A-Z]?\d+[A-Z]?[-/]?\d*)/i,
      )?.[1] ?? '';
  return {
    source,
    facts,
    title: String(
      get('listingTitle') ??
        text
          .match(/^(?:property title|listing title|title)\s*:\s*(.+)$/im)?.[1]
          ?.trim() ??
        source.name,
    ),
    description: text,
    category,
    transaction: /\bfor sale\b|ขาย/i.test(text)
      ? /\bfor rent\b|ให้เช่า/i.test(text)
        ? 'unknown'
        : 'sale'
      : /rent|lease|night|เช่า|คืน/i.test(text)
        ? 'rent'
        : 'unknown',
    arrangement: prices.some((p) =>
      ['nightly_rate', 'stay_total'].includes(p.basis),
    )
      ? 'nightly'
      : prices.some((p) => p.basis === 'monthly_rent')
        ? 'monthly'
        : 'unknown',
    privacy: /private room|ห้องส่วนตัว/i.test(text)
      ? 'private'
      : /shared room|ห้องรวม/i.test(text)
        ? 'shared'
        : /entire (?:place|home|property)/i.test(text)
          ? 'entire'
          : '',
    location: String(
      get('location') ??
        ['locality', 'city', 'country']
          .map(get)
          .filter((v) => typeof v === 'string')
          .join(', '),
    ),
    address: String(get('address') ?? ''),
    unit,
    listingId: source.publicListing?.listingId ?? null,
    canonicalUrl: source.publicListing?.canonicalUrl ?? source.originalUrl,
    images: source.publicListing?.images ?? [],
    prices,
  };
}
const publicText = (text: string) =>
  text
    .replace(
      /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)|@[\w.-]+/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
export function buildQueries(p: PropertyProfile): string[] {
  const title = publicText(p.title).slice(0, 110);
  const location = publicText(p.location).slice(0, 80);
  const queries: string[] = [];
  if (
    title.length >= 10 &&
    (!p.canonicalUrl ||
      title.toLowerCase() !== new URL(p.canonicalUrl).hostname.toLowerCase()) &&
    !/^(manually entered|pasted|listing details|property details)/i.test(title)
  )
    queries.push(`"${title.replace(/"/g, '')}" ${location}`.trim());
  const phrase = p.description
    .split(/[\n.!?]/)
    .map(publicText)
    .find(
      (s) =>
        s.length >= 55 &&
        s.length < 160 &&
        !/payment|transfer|passport|bank|contact|โทร|line\s*:/i.test(s),
    );
  if (phrase && location)
    queries.push(`"${phrase.replace(/"/g, '').slice(0, 100)}" ${location}`);
  if (p.listingId && p.canonicalUrl)
    queries.push(`"${p.listingId}" ${new URL(p.canonicalUrl).hostname}`);
  return [...new Set(queries)].slice(0, 3);
}
export type Identity =
  | 'exact_listing'
  | 'likely_same_property'
  | 'same_building_or_development'
  | 'possible_match'
  | 'unrelated'
  | 'insufficient_evidence';
export function matchProperty(
  a: PropertyProfile,
  b: PropertyProfile,
): { identity: Identity; reasons: string[] } {
  if (
    a.transaction !== 'unknown' &&
    b.transaction !== 'unknown' &&
    a.transaction !== b.transaction
  )
    return {
      identity: 'possible_match',
      reasons: ['Different transaction types; offers cannot be compared.'],
    };
  if (
    a.canonicalUrl &&
    b.canonicalUrl &&
    canonicalKey(a.canonicalUrl) === canonicalKey(b.canonicalUrl)
  )
    return {
      identity: 'exact_listing',
      reasons: ['Same canonical listing URL.'],
    };
  if (
    a.listingId &&
    a.listingId === b.listingId &&
    a.canonicalUrl &&
    b.canonicalUrl &&
    new URL(a.canonicalUrl).hostname === new URL(b.canonicalUrl).hostname
  )
    return {
      identity: 'exact_listing',
      reasons: ['Same platform and listing identifier.'],
    };
  const sameTitle =
    normalize(a.title).length >= 12 &&
    normalize(a.title) === normalize(b.title);
  const exactAddress =
    normalize(a.address).length >= 18 &&
    /[0-9๐-๙]/.test(a.address) &&
    normalize(a.address) === normalize(b.address);
  const sameUnit = Boolean(
    a.unit && b.unit && normalize(a.unit) === normalize(b.unit),
  );
  const sameCategory = a.category !== 'unknown' && a.category === b.category;
  const locationA = normalize(a.location),
    locationB = normalize(b.location);
  const geographicCompatibility =
    !locationA ||
    !locationB ||
    locationA.includes(locationB) ||
    locationB.includes(locationA);
  const locationPrecision = Boolean(
    (locationA && locationB && geographicCompatibility) ||
    (a.address.includes(',') && b.address.includes(',')),
  );
  const distinctive = a.description
    .split(/[\n.!?]/)
    .some(
      (s) =>
        s.trim().length >= 65 &&
        s.trim().length <= 180 &&
        normalize(b.description).includes(normalize(s)),
    );
  const unitRequired = ['hotel', 'apartment', 'room', 'commercial'].includes(
    a.category,
  );
  if (
    exactAddress &&
    geographicCompatibility &&
    locationPrecision &&
    sameCategory &&
    (sameTitle || distinctive) &&
    (unitRequired ? sameUnit : distinctive)
  )
    return {
      identity: 'likely_same_property',
      reasons: [
        'Precise matching address, property category and distinctive identity evidence.',
        ...(sameUnit ? ['Matching explicit unit/room identifier.'] : []),
      ],
    };
  if (exactAddress)
    return {
      identity: 'same_building_or_development',
      reasons: [
        'A shared name or address does not identify the same unit or hotel room.',
      ],
    };
  if (sameTitle)
    return {
      identity: 'possible_match',
      reasons: [
        'A matching title alone does not establish the same building, room or property.',
      ],
    };
  if (a.category !== 'unknown' && b.category !== 'unknown' && !sameCategory)
    return {
      identity: 'unrelated',
      reasons: ['Different property categories.'],
    };
  if (
    normalize(a.location).length > 3 &&
    normalize(a.location) === normalize(b.location) &&
    sameCategory
  )
    return {
      identity: 'possible_match',
      reasons: ['Only location and category overlap; identity is unconfirmed.'],
    };
  return {
    identity: 'insufficient_evidence',
    reasons: ['Not enough nonvisual identity evidence.'],
  };
}

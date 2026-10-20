import {
  PriceRecordSchema,
  type EvidenceSource,
  type ExtractedFact,
  type PriceRecord,
} from '@sniffo/shared';
import { stableId, quoteExists } from '../evidenceIntegrity.js';
import { extractPrices } from '../prices.js';

export type ClaimContext = {
  rentalType: 'short_term' | 'long_term' | 'hotel' | 'unknown';
  ambiguousProperty?: boolean;
  platform?: 'airbnb' | 'booking' | 'agoda';
  privacy?: string;
  unitId?: string;
  roomVariant?: string;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  guestCount?: number;
  currency?: string;
  scope: 'unit' | 'building' | 'unknown';
  locationPrecision?: string;
  addressRole?: 'property' | 'business';
};
export type Claim = {
  id: string;
  sourceId: string;
  field: string;
  rawValue: unknown;
  normalizedValue: unknown;
  quote: string;
  structuredPath?: string;
  factId?: string;
  extractionMethod: string;
  provenance: 'server_extracted' | 'user_source' | 'user_assertion' | 'derived';
  inputClaimIds?: string[];
  context: ClaimContext;
};
export type Statement = {
  source: EvidenceSource;
  quote: string;
  line: number;
  context: ClaimContext;
  actionable: boolean;
  issueKey?: string;
};
export const LIMITS = {
  claims: 1000,
  statements: 2000,
  comparisons: 10_000,
  findings: 60,
  links: 40,
} as const;
export function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(/กรุงเทพมหานคร|กรุงเทพฯ|กรุงเทพ/g, 'bangkok')
    .replace(/เชียงใหม่|chiangmai/g, 'chiang mai')
    .replace(/สุขุมวิท/g, 'sukhumvit')
    .replace(/ห้วยขวาง/g, 'huai khwang')
    .replace(/พระโขนง|prakanong/g, 'phra khanong')
    .replace(/อโศก|asoke/g, 'asok')
    .replace(/เขต|แขวง|ถนน| road\b| rd\b/g, ' ')
    .replace(/ซอย/g, ' soi ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function evidenceKind(source: EvidenceSource): Claim['provenance'] {
  // Legacy signed corrections remain assertions, even before explicit purpose was added.
  if (
    source.evidenceKind === 'user_assertion' ||
    /renter corrections|manually entered|renter-supplied/i.test(
      source.name + '\n' + (source.extractedText ?? '').slice(0, 100),
    )
  )
    return 'user_assertion';
  return (
    source.evidenceKind ??
    (source.type === 'listing_url' ? 'server_extracted' : 'user_source')
  );
}
export function sourceContext(source: EvidenceSource): ClaimContext {
  const text = source.extractedText ?? '';
  let host = '';
  let query = new URLSearchParams();
  try {
    const u = new URL(source.originalUrl ?? '');
    host = u.hostname.toLowerCase();
    query = u.searchParams;
  } catch {
    /* Pasted evidence has no URL. */
  }
  const official = (domain: string) =>
    host === domain || host.endsWith('.' + domain);
  const platformText = text
    .split('\n')
    .filter(
      (line) =>
        !/\b(?:warn(?:s|ing)?|scammers?|article|example|beware)\b/i.test(line),
    )
    .join('\n');
  const platform =
    official('airbnb.com') || /\bairbnb\b/i.test(platformText)
      ? 'airbnb'
      : official('booking.com') || /booking\.com/i.test(platformText)
        ? 'booking'
        : official('agoda.com') || /\bagoda\b/i.test(platformText)
          ? 'agoda'
          : undefined;
  const hotel = /\bhotel|serviced apartment|room categories\b/i.test(text);
  const long = /monthly|per month|\/month|เดือน|月額|월세|月租/i.test(text);
  const privacy = text
    .match(
      /\b(entire (?:place|home|rental unit)|private room|shared room)\b/i,
    )?.[1]
    ?.toLowerCase()
    .replace(/entire (home|rental unit)/, 'entire place');
  const issued = (field: string) =>
    source.normalizedFacts?.find((f) => f.fieldName === field)?.normalizedValue;
  const issuedUnit = issued('unitId') ?? issued('listingId');
  const unitId =
    typeof issuedUnit === 'string'
      ? issuedUnit
      : (text.match(
          /(?:property id|listing id|unit id)\s*[:#]\s*([\w-]+)/i,
        )?.[1] ??
        (() => {
          try {
            return new URL(source.originalUrl ?? '').pathname.match(
              /\/rooms\/(\d+)/,
            )?.[1];
          } catch {
            return undefined;
          }
        })());
  const roomVariant = text
    .match(/(?:room|unit)\s+(?:type|category)\s*:\s*([^\n.,;]+)/i)?.[1]
    ?.toLowerCase()
    .replace(/\s+room\b/g, '')
    .trim();
  const date = (key: string, label: string) => {
    const value =
      query.get(key) ??
      text.match(
        new RegExp(`${label}\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'i'),
      )?.[1];
    return value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value
      ? value
      : undefined;
  };
  const range = text.match(
    /(?:total|stay|dates)[^\n]{0,30}(\d{4}-\d{2}-\d{2})\s*(?:to|through|–|—)\s*(\d{4}-\d{2}-\d{2})/i,
  );
  const checkIn = date('check_in', 'check[ -]?in') ?? range?.[1];
  const checkOut = date('check_out', 'check[ -]?out') ?? range?.[2];
  const duration =
    checkIn && checkOut
      ? (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000
      : undefined;
  const nights =
    duration && duration > 0 && duration < 3660
      ? duration
      : Number(text.match(/(?:for\s+)?(\d+)\s+nights?/i)?.[1]) || undefined;
  const party = [
    query.get('adults'),
    query.get('children'),
    query.get('infants'),
  ];
  const partyTotal = party.some((v) => v !== null)
    ? party.reduce<number>((n, v) => n + Number(v ?? 0), 0)
    : undefined;
  const guests =
    query.get('guests') ??
    (partyTotal === undefined ? null : String(partyTotal)) ??
    text.match(
      /(?:booking guests|selected guests|reservation for)\s*:?\s*(\d+)/i,
    )?.[1];
  return {
    rentalType: hotel
      ? 'hotel'
      : long
        ? 'long_term'
        : platform || nights || /nightly|vacation|short.term/i.test(text)
          ? 'short_term'
          : 'unknown',
    platform,
    privacy,
    unitId,
    roomVariant,
    checkIn,
    checkOut,
    nights,
    guestCount: guests && Number(guests) > 0 ? Number(guests) : undefined,
    scope: 'unit',
  };
}
export function isActionable(quote: string): boolean {
  quote = quote.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, '');
  // Apply attribution guards before detecting positive instructions. Negated platform bypass
  // ("Don't pay through Airbnb") is handled separately from protective negation.
  if (
    /\b(?:scammers?|fraudsters?|article|example|hypothetical|someone|a stranger)\b|\b(?:i|we) (?:already paid|refused|reported)|\bif (?:anyone|someone)|\b(?:warns?|warning|beware|avoid|never)\b|asked me to|told me to|\b(?:someone|a friend|another tenant) said\b/i.test(
      quote,
    )
  )
    return false;
  if (
    /(?:do not|don['’]t|must not|should not|we do not|cannot|can['’]t|not)\s+(?:ever\s+)?(?:pay|send|transfer|buy|use|accept)\b(?![^.!?]{0,25}(?:through|via|on)\s+(?:airbnb|booking\.com|agoda))/i.test(
      quote,
    )
  )
    return false;
  if (
    /อย่า|ห้าม|ไม่ต้องโอน|ไม่รับคริปโต|送金しない|支払わない|払わない|支払わないで|送金しないで|결제하지|송금하지|보내지 마|不要|切勿|请勿|不接受/.test(
      quote,
    )
  )
    return false;
  return true;
}
export function statementsFor(
  source: EvidenceSource,
  context = sourceContext(source),
): Statement[] {
  if (
    source.extractionStatus !== 'complete' ||
    source.publicListing?.fieldComparisonOnly ||
    evidenceKind(source) === 'user_assertion'
  )
    return [];
  return (source.extractedText ?? '')
    .split('\n')
    .slice(0, LIMITS.statements)
    .flatMap((line, index) => {
      const sentences = line
        .split(/(?<=[.!?])\s+|(?<=[。！？])\s*/u)
        .filter((s) => s.trim());
      const result: Statement[] = [];
      for (
        let i = 0;
        i < sentences.length && result.length < LIMITS.statements;
        i++
      ) {
        let quote = sentences[i]!.trim();
        if (
          /(?:(?:don't|don’t|do not).{0,25}pay.{0,25}(?:through|via|on).{0,15}(?:airbnb|booking\.com|agoda)|(?:airbnb|platform).{0,40}(?:broken|not working))/i.test(
            quote,
          ) &&
          sentences[i + 1] &&
          /send|pay|transfer|use/i.test(sentences[i + 1]!)
        ) {
          const first = line.indexOf(sentences[i]!);
          const end =
            line.indexOf(sentences[i + 1]!, first + sentences[i]!.length) +
            sentences[i + 1]!.length;
          quote = line.slice(first, end).trim();
          i++;
        }
        result.push({
          source,
          quote,
          line: index + 1,
          context,
          actionable: isActionable(quote),
          issueKey: normalize(line),
        });
      }
      return result;
    });
}
export function normalizeClaims(
  sources: EvidenceSource[],
  facts: ExtractedFact[],
): {
  claims: Claim[];
  contexts: Map<string, ClaimContext>;
  statements: Statement[];
  truncated: boolean;
} {
  const contexts = new Map(sources.map((s) => [s.id, sourceContext(s)]));
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const lines = new Map(
    sources.map((s) => [s.id, (s.extractedText ?? '').split('\n')]),
  );
  const quoteLines = new Map<string, string>();
  const containingLine = (source: EvidenceSource, quote: string) => {
    const key = source.id + '\0' + quote;
    if (!quoteLines.has(key))
      quoteLines.set(
        key,
        lines.get(source.id)!.find((l) => l.includes(quote)) ?? quote,
      );
    return quoteLines.get(key)!;
  };
  const claims: Claim[] = [];
  const keys = new Set<string>();
  let truncated = false;
  const add = (
    source: EvidenceSource,
    field: string,
    value: unknown,
    quote: string,
    fact?: ExtractedFact,
  ) => {
    if (field === 'bookingType' && /entire|private|shared/i.test(String(value)))
      field = 'privacyType';
    const key = stableId(source.id, field, value, quote);
    if (keys.has(key)) return;
    if (claims.length >= LIMITS.claims) {
      truncated = true;
      return;
    }
    keys.add(key);
    const context = { ...contexts.get(source.id)! };
    const line = containingLine(source, quote);
    if (/business address|registered office|host(?:'s)? address/i.test(line))
      context.addressRole = 'business';
    else context.addressRole = 'property';
    if (
      /overall (?:home|house|property)|whole building|building has|\d+.bedroom house/i.test(
        line,
      ) &&
      context.privacy === 'private room'
    )
      context.scope = 'building';
    if (
      field === 'maxGuests' &&
      /booking|reservation|selected/i.test(
        fact?.provenance?.sourceReference ?? '',
      )
    )
      return;
    if (
      field === 'maxGuests' &&
      !/maximum|max[ .-]?guests|sleeps|capacity|up to/i.test(line) &&
      !fact?.provenance
    )
      return;
    claims.push({
      id: `claim-${key}`,
      sourceId: source.id,
      field,
      rawValue: fact?.provenance?.rawValue ?? value,
      normalizedValue: value,
      quote,
      structuredPath: fact?.provenance?.sourceReference,
      factId: fact?.id,
      extractionMethod: fact?.extractionMethod ?? 'text',
      provenance: evidenceKind(source),
      context,
    });
  };
  for (const fact of facts) {
    const source = sourceMap.get(fact.sourceId);
    if (!source) continue;
    if (fact.fieldName === 'price') {
      const parsed = PriceRecordSchema.safeParse(fact.normalizedValue);
      if (!parsed.success) continue;
      const line = containingLine(source, fact.quotedEvidence);
      const price: PriceRecord = enrichPrice(
        parsed.data,
        line,
        contexts.get(source.id)!,
      );
      add(source, 'price', price, fact.quotedEvidence, fact);
    } else
      add(
        source,
        fact.fieldName,
        fact.normalizedValue,
        fact.quotedEvidence,
        fact,
      );
  }
  for (const claim of [...claims]) {
    if (
      claim.field !== 'monthlyRent' ||
      !/monthly|month|เดือน/.test(claim.quote.toLowerCase())
    )
      continue;
    if (
      claims.some(
        (c) =>
          c.sourceId === claim.sourceId &&
          c.field === 'price' &&
          (c.normalizedValue as PriceRecord).basis === 'monthly_rent',
      )
    )
      continue;
    const currency = claims.find(
      (c) => c.sourceId === claim.sourceId && c.field === 'currency',
    );
    if (
      !currency ||
      typeof currency.normalizedValue !== 'string' ||
      typeof claim.normalizedValue !== 'number'
    )
      continue;
    if (claims.length >= LIMITS.claims) {
      truncated = true;
      break;
    }
    claims.push({
      ...claim,
      id: `claim-${stableId(claim.id, 'monthly_price')}`,
      field: 'price',
      normalizedValue: enrichPrice(
        {
          amount: claim.normalizedValue,
          currency: currency.normalizedValue,
          rawCurrency: currency.normalizedValue,
          rawText: claim.quote,
          basis: 'monthly_rent',
          basisExplicit: true,
        },
        claim.quote,
        claim.context,
      ),
      provenance:
        claim.provenance === 'user_assertion' ? 'user_assertion' : 'derived',
      inputClaimIds: [claim.id, currency.id],
      extractionMethod: 'scalar_price_normalization',
    });
  }
  const listingUnits = [
    ...new Set(
      sources
        .filter(
          (s) =>
            s.type.startsWith('listing') &&
            evidenceKind(s) !== 'user_assertion',
        )
        .flatMap((s) =>
          contexts.get(s.id)?.unitId ? [contexts.get(s.id)!.unitId!] : [],
        ),
    ),
  ];
  if (listingUnits.length > 1)
    for (const context of contexts.values())
      if (!context.unitId) context.ambiguousProperty = true;
  for (const claim of claims)
    claim.context.ambiguousProperty = contexts.get(
      claim.sourceId,
    )?.ambiguousProperty;
  const establishedPlatforms = [
    ...new Set(
      sources
        .filter((s) => evidenceKind(s) !== 'user_assertion')
        .flatMap((s) => {
          const c = contexts.get(s.id)!;
          return c.platform ? [c.platform] : [];
        }),
    ),
  ];
  if (establishedPlatforms.length === 1)
    for (const context of contexts.values())
      context.platform ??= establishedPlatforms[0];
  const allStatements = sources.flatMap((source) =>
    statementsFor(source, contexts.get(source.id)!),
  );
  if (
    allStatements.length >= LIMITS.statements ||
    [...lines.values()].some((l) => l.length > LIMITS.statements)
  )
    truncated = true;
  const statements = allStatements.slice(0, LIMITS.statements);
  for (const statement of statements) {
    const { source, quote, context } = statement;
    if (!statement.actionable) continue;
    const multilingual = quote
      .replace(/月額|월세|月租/g, 'monthly rent ')
      .replace(/円/g, ' JPY ')
      .replace(/元/g, ' CNY ')
      .replace(/원/g, ' KRW ')
      .replace(/每月|ต่อเดือน|\/เดือน/g, '/month');
    for (const { price } of extractPrices(multilingual)) {
      if (
        claims.some(
          (c) =>
            c.sourceId === source.id &&
            c.field === 'price' &&
            (c.normalizedValue as PriceRecord).amount === price.amount &&
            (c.normalizedValue as PriceRecord).basis === price.basis,
        )
      )
        continue;
      if (price.amount === null || !Number.isFinite(price.amount)) continue;
      add(
        source,
        'price',
        enrichPrice({ ...price, rawText: quote }, quote, context),
        quote,
      );
    }
    for (const [amenity, pattern] of [
      ['pool', /\b(?:private )?pool\b/i],
      ['wifi', /\bwi[ -]?fi\b/i],
      ['parking', /\bparking\b/i],
      ['elevator', /\belevator\b/i],
    ] as const) {
      if (
        !pattern.test(quote) ||
        /building|shared|communal|nearby/i.test(quote)
      )
        continue;
      const no = /\b(?:no|without|not available|not included)\b/i.test(quote);
      const yes =
        /\b(?:included|available|provided|unit has|apartment has|private)\b/i.test(
          quote,
        );
      if (no || yes) add(source, `amenity:${amenity}`, !no, quote);
    }
    for (const [field, pattern] of [
      [
        'privacyType',
        /\b(entire (?:place|home|rental unit)|private room|shared room)\b/i,
      ],
      [
        'city',
        /^(?:property\s+)?(?:city|location|address)\s*:\s*(Bangkok|Chiang Mai|Tokyo|Osaka|Seoul|Busan|London|Paris|เชียงใหม่|กรุงเทพมหานคร)\b/i,
      ],
      [
        'depositPolicy',
        /\bno (?:security )?deposit (?:is )?(?:required|needed)|\bno (?:security )?deposit\b/i,
      ],
      ['cleaningPolicy', /\bcleaning fee (?:is )?included\b/i],
    ] as const) {
      const match = quote.match(pattern);
      if (match)
        add(
          source,
          field,
          field === 'depositPolicy'
            ? 'none'
            : field === 'cleaningPolicy'
              ? 'included'
              : match[1]!,
          quote,
        );
    }
  }
  for (const claim of [...claims]) {
    if (claim.field !== 'price' || claim.provenance === 'user_assertion')
      continue;
    const price = claim.normalizedValue as PriceRecord;
    if (
      price.basis !== 'nightly_rate' ||
      !price.nights ||
      !price.checkIn ||
      !price.checkOut ||
      price.includesFees === null ||
      price.includesFees === undefined
    )
      continue;
    if (claims.length >= LIMITS.claims) {
      truncated = true;
      break;
    }
    claims.push({
      ...claim,
      id: `claim-${stableId(claim.id, 'stay_total')}`,
      field: 'price',
      normalizedValue: {
        ...price,
        basis: 'stay_total',
        amount: (Math.round(price.amount * 100) * price.nights) / 100,
      },
      provenance: 'derived',
      inputClaimIds: [claim.id],
      extractionMethod: 'decimal_unit_conversion',
    });
  }
  // Never allow normalized values with untraceable text into derived comparisons.
  return {
    claims: claims.filter(
      (c) =>
        c.structuredPath ||
        quoteExists(sourceMap.get(c.sourceId)?.extractedText ?? '', c.quote),
    ),
    contexts,
    statements,
    truncated,
  };
}
function enrichPrice(
  price: PriceRecord,
  line: string,
  context: ClaimContext,
): PriceRecord {
  const amountIndex = line.indexOf(price.rawText);
  const localPrefix =
    amountIndex >= 0
      ? line.slice(Math.max(0, amountIndex - 45), amountIndex)
      : line;
  const label = localPrefix.match(
    /(?:original|crossed.out|was|now|current|discounted)(?:[^\d]{0,25})$/i,
  )?.[0];
  return {
    ...price,
    ...(price.basis === 'unknown' && context.nights && /\btotal\b/i.test(line)
      ? { basis: 'stay_total' as const, basisExplicit: true }
      : {}),
    checkIn: price.checkIn ?? context.checkIn,
    checkOut: price.checkOut ?? context.checkOut,
    nights: price.nights ?? context.nights,
    guestCount: price.guestCount ?? context.guestCount,
    unitId: price.unitId ?? context.unitId,
    roomVariant: price.roomVariant ?? context.roomVariant,
    role:
      price.role ??
      (label && /original|crossed.out|was/i.test(label)
        ? 'original'
        : 'current'),
    includesFees:
      price.includesFees ??
      (/excluding|excludes|before (?:tax|fees)|fees? excluded/i.test(line)
        ? false
        : /all.inclusive|including (?:all )?(?:fees|utilities|tax)|fees? included|no additional fees/i.test(
              line,
            )
          ? true
          : null),
    estimate:
      price.estimate ??
      /estimate|approx(?:imately)?|from\s+[฿$€£]|starting (?:at|from)/i.test(
        line,
      ),
    feeType:
      price.feeType ??
      (price.basis === 'deposit'
        ? /holding|reservation/i.test(line)
          ? 'holding_deposit'
          : /security/i.test(line)
            ? 'security_deposit'
            : 'deposit'
        : price.basis === 'other_fee'
          ? /utility|utilities/i.test(line)
            ? 'utility'
            : /booking|reservation/i.test(line)
              ? 'booking'
              : /administrat|admin/i.test(line)
                ? 'administrative'
                : undefined
          : price.basis === 'service_fee' && /admin/i.test(line)
            ? 'administrative'
            : price.basis),
    mandatory: price.mandatory ?? !/optional/i.test(line),
    recurring:
      price.recurring ??
      (/monthly|per month/i.test(line) &&
      ['deposit', 'cleaning_fee', 'service_fee', 'other_fee'].includes(
        price.basis,
      )
        ? 'monthly'
        : 'one_time'),
  };
}

import { airbnbListingId, extractAirbnb } from './airbnb.js';
import { sealEvidenceSource } from './sourceSignature.js';
import {
  extractPrices,
  findBahtCurrencyEvidence,
  normalizeCurrency,
} from './prices.js';
import { randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { load } from 'cheerio';
import { performance } from 'node:perf_hooks';
import type {
  EvidenceSource,
  EvidenceSourceType,
  ExtractedFact,
  PriceRecord,
} from '@sniffo/shared';

const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_EXTRACTION_BUDGET_MS = 8_000;
type ExtractionTimings = {
  dnsMs: number;
  httpMs: number;
  redirects: number;
  parsingMs: number;
  normalizationMs: number;
  payloadBytes: number;
  httpStatus?: number;
};

function bookingContextFromUrl(url: URL) {
  const context: Record<string, string | number> = {};
  const readDate = (names: string[]) =>
    names
      .map((name) => url.searchParams.get(name))
      .find(
        (value) =>
          value &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value,
      );
  const checkIn = readDate(['check_in', 'checkIn', 'checkin', 'arrival']);
  const checkOut = readDate(['check_out', 'checkOut', 'checkout', 'departure']);
  if (checkIn) context.checkIn = checkIn;
  if (checkOut) context.checkOut = checkOut;
  if (checkIn && checkOut) {
    const nights =
      (Date.parse(`${checkOut}T00:00:00Z`) -
        Date.parse(`${checkIn}T00:00:00Z`)) /
      86_400_000;
    if (Number.isInteger(nights) && nights > 0 && nights <= 60)
      context.nights = nights;
  }
  for (const [params, key] of [
    [['adults', 'guests', 'guest_count', 'numberOfGuests'], 'adults'],
    [['children'], 'children'],
    [['infants'], 'infants'],
    [['pets'], 'pets'],
  ] as const) {
    const raw = params.map((name) => url.searchParams.get(name)).find(Boolean);
    if (raw && /^\d{1,2}$/.test(raw)) context[key] = Number(raw);
  }
  const adults = context.adults;
  const children = context.children;
  if (typeof adults === 'number' || typeof children === 'number')
    context.guestCount =
      (typeof adults === 'number' ? adults : 0) +
      (typeof children === 'number' ? children : 0);
  const currency = url.searchParams.get('currency');
  const normalizedCurrency = currency ? normalizeCurrency(currency) : null;
  if (normalizedCurrency) context.currency = normalizedCurrency;
  const locale = url.searchParams.get('locale');
  if (locale && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale))
    context.locale = locale;
  return context;
}

function reliablePrice(price: PriceRecord | null | undefined): boolean {
  return Boolean(
    price &&
    Number.isFinite(price.amount) &&
    price.amount > 0 &&
    ['monthly_rent', 'nightly_rate', 'weekly_rate', 'stay_total'].includes(
      price.basis,
    ) &&
    price.basisExplicit &&
    price.currency,
  );
}

function reliableCurrentPrice(facts: ExtractedFact[]) {
  const prices = facts
    .filter((fact) => fact.fieldName === 'price')
    .map((fact) => fact.normalizedValue as PriceRecord | null)
    .filter(
      (price) =>
        price &&
        price.role !== 'original' &&
        price.role !== 'fee' &&
        price.role !== 'ambiguous' &&
        reliablePrice(price),
    );
  const current = prices.filter((price) => price?.role === 'current');
  const candidates = current.length
    ? current
    : prices.filter((price) => !price?.role);
  const stayTotals = candidates.filter(
    (price) => price?.basis === 'stay_total',
  );
  const preferred = stayTotals.length ? stayTotals : candidates;
  return new Set(
    preferred.map(
      (price) => `${price?.amount}:${price?.basis}:${price?.currency}`,
    ),
  ).size === 1
    ? preferred[0]
    : undefined;
}

function extractionBudgetMs() {
  const configured = Number(process.env.LISTING_EXTRACTION_BUDGET_MS);
  return Number.isFinite(configured)
    ? Math.min(30_000, Math.max(1_000, configured))
    : DEFAULT_EXTRACTION_BUDGET_MS;
}

function withinExtractionBudget<T>(
  operation: Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<T> {
  const remaining = deadlineAt - performance.now();
  if (remaining <= 0)
    return Promise.reject(
      fail(
        504,
        'FETCH_TIMEOUT',
        'Listing extraction exceeded its time budget.',
      ),
    );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      callback();
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            fail(
              504,
              'FETCH_TIMEOUT',
              'Listing extraction exceeded its time budget.',
            ),
          ),
        ),
      remaining,
    );
    const abort = () =>
      finish(() =>
        reject(
          fail(499, 'REQUEST_CANCELLED', 'Listing extraction was cancelled.'),
        ),
      );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

type SafeError = Error & { status: number; code: string };
function fail(status: number, code: string, message: string): SafeError {
  return Object.assign(new Error(message), { status, code });
}

function isPublicIPv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b, c] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export async function resolvePublicIPv4(
  hostname: string,
  timings?: ExtractionTimings,
  deadlineAt = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted)
    throw fail(499, 'REQUEST_CANCELLED', 'Listing extraction was cancelled.');
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isIP(normalized)
  ) {
    throw fail(
      400,
      'URL_NOT_ALLOWED',
      'That address cannot be fetched. Use a public HTTP or HTTPS listing URL.',
    );
  }
  let addresses: Array<{ address: string; family: number }>;
  const dnsStartedAt = performance.now();
  try {
    const lookup = dnsLookup(normalized, {
      all: true,
      family: 4,
      verbatim: true,
    });
    const remaining = deadlineAt - performance.now();
    if (remaining <= 0) throw new Error('budget exhausted');
    addresses = await new Promise((resolve, reject) => {
      let settled = false;
      const resources: {
        timeout?: ReturnType<typeof setTimeout>;
        abort?: () => void;
      } = {};
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (resources.timeout) clearTimeout(resources.timeout);
        if (resources.abort)
          signal?.removeEventListener('abort', resources.abort);
        callback();
      };
      resources.timeout = setTimeout(
        () => finish(() => reject(new Error('DNS budget exceeded'))),
        remaining,
      );
      resources.abort = () =>
        finish(() =>
          reject(
            fail(499, 'REQUEST_CANCELLED', 'Listing extraction was cancelled.'),
          ),
        );
      signal?.addEventListener('abort', resources.abort, { once: true });
      if (signal?.aborted) resources.abort();
      lookup.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  } catch {
    if (signal?.aborted)
      throw fail(499, 'REQUEST_CANCELLED', 'Listing extraction was cancelled.');
    if (performance.now() >= deadlineAt)
      throw fail(
        504,
        'FETCH_TIMEOUT',
        'Listing extraction exceeded its time budget.',
      );
    throw fail(
      422,
      'HOST_NOT_FOUND',
      'The listing host could not be reached. Check the URL and try again.',
    );
  } finally {
    if (timings) timings.dnsMs += performance.now() - dnsStartedAt;
  }
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicIPv4(address))
  ) {
    throw fail(
      400,
      'URL_NOT_ALLOWED',
      'That address cannot be fetched. Use a public HTTP or HTTPS listing URL.',
    );
  }
  return addresses[0]!.address;
}

function validateUrl(input: URL): void {
  if (
    !['http:', 'https:'].includes(input.protocol) ||
    input.username ||
    input.password ||
    (input.port && input.port !== (input.protocol === 'https:' ? '443' : '80'))
  ) {
    throw fail(
      400,
      'URL_NOT_ALLOWED',
      'Only public HTTP or HTTPS listing URLs on the standard port are supported.',
    );
  }
}

export async function readPage(
  url: URL,
  redirects = 0,
  timings?: ExtractionTimings,
  deadlineAt = performance.now() + extractionBudgetMs(),
  signal?: AbortSignal,
  resource?: {
    contentTypes: string[];
    maxBytes: number;
    beforeRequest?: (url: URL) => Promise<void>;
  },
  transport?: {
    resolve?: typeof resolvePublicIPv4;
    request?: typeof httpRequest;
  },
): Promise<{
  body: string;
  contentType: string;
  url: URL;
  status?: number;
  bytes?: Buffer;
}> {
  validateUrl(url);
  await resource?.beforeRequest?.(url);
  const pinnedAddress = await (transport?.resolve ?? resolvePublicIPv4)(
    url.hostname,
    timings,
    deadlineAt,
    signal,
  );
  const requestImpl =
    transport?.request ??
    (url.protocol === 'https:' ? httpsRequest : httpRequest);
  const lookup = ((_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: pinnedAddress, family: 4 }]);
    else callback(null, pinnedAddress, 4);
  }) as LookupFunction;

  return new Promise((resolve, reject) => {
    const httpStartedAt = performance.now();
    let httpTimeRecorded = false;
    const recordHttpTime = () => {
      if (timings && !httpTimeRecorded) {
        timings.httpMs += performance.now() - httpStartedAt;
        httpTimeRecorded = true;
      }
    };
    const remainingBudget = deadlineAt - httpStartedAt;
    if (remainingBudget <= 0) {
      reject(
        fail(
          504,
          'FETCH_TIMEOUT',
          'Listing extraction exceeded its time budget.',
        ),
      );
      return;
    }
    const request = requestImpl(
      url,
      {
        method: 'GET',
        lookup,
        servername: url.hostname,
        headers: {
          accept:
            resource?.contentTypes.join(', ') ?? 'text/html, text/plain;q=0.9',
          'accept-encoding': 'identity',
          'user-agent': 'SniffoRentalCheck/1.0 (+local listing verification)',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (timings) timings.httpStatus = status;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirects >= MAX_REDIRECTS)
            return reject(
              fail(
                422,
                'TOO_MANY_REDIRECTS',
                'The listing redirected too many times.',
              ),
            );
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            return reject(
              fail(
                422,
                'INVALID_REDIRECT',
                'The listing returned an invalid redirect.',
              ),
            );
          }
          if (timings) timings.redirects += 1;
          void readPage(
            next,
            redirects + 1,
            timings,
            deadlineAt,
            signal,
            resource,
            transport,
          ).then(resolve, reject);
          return;
        }
        if (status === 429) {
          response.resume();
          return reject(
            fail(
              429,
              'LISTING_RATE_LIMITED',
              'This listing site is rate-limiting automatic requests (HTTP 429). The link can still be saved, but paste the listing text or add a screenshot/PDF to read its details.',
            ),
          );
        }
        if (status === 403) {
          response.resume();
          return reject(
            fail(
              403,
              'LISTING_ACCESS_BLOCKED',
              'This listing site blocks automatic access (HTTP 403). The link can still be saved; use pasted listing text or a screenshot/PDF to read its details.',
            ),
          );
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return reject(
            fail(
              422,
              'LISTING_FETCH_FAILED',
              `The listing site returned HTTP ${status}.`,
            ),
          );
        }
        const contentType =
          response.headers['content-type']
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() ?? '';
        if (
          !(
            resource?.contentTypes ?? [
              'text/html',
              'application/xhtml+xml',
              'text/plain',
            ]
          ).includes(contentType)
        ) {
          response.resume();
          return reject(
            fail(
              415,
              'UNSUPPORTED_CONTENT_TYPE',
              'This URL does not appear to contain a web page or plain-text listing.',
            ),
          );
        }
        const declaredLength = Number(response.headers['content-length']);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > (resource?.maxBytes ?? MAX_PAGE_BYTES)
        ) {
          response.destroy();
          return reject(
            fail(
              413,
              'PAGE_TOO_LARGE',
              'The listing page is too large to process safely.',
            ),
          );
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (timings) timings.payloadBytes += buffer.length;
          if (bytes > (resource?.maxBytes ?? MAX_PAGE_BYTES)) {
            response.destroy(
              fail(
                413,
                'PAGE_TOO_LARGE',
                'The listing page is too large to process safely.',
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          recordHttpTime();
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            ...(resource ? { bytes: Buffer.concat(chunks) } : {}),
            contentType,
            url,
            status,
          });
        });
        response.on('error', (error) => reject(toListingTransportError(error)));
      },
    );
    const timeoutError = fail(
      504,
      'FETCH_TIMEOUT',
      'The listing site took too long to respond.',
    );
    const deadline = setTimeout(
      () => request.destroy(timeoutError),
      Math.min(REQUEST_TIMEOUT_MS, remainingBudget),
    );
    const abortRequest = () =>
      request.destroy(
        fail(499, 'REQUEST_CANCELLED', 'Listing extraction was cancelled.'),
      );
    request.on('close', () => {
      clearTimeout(deadline);
      recordHttpTime();
      signal?.removeEventListener('abort', abortRequest);
    });
    request.setTimeout(Math.min(REQUEST_TIMEOUT_MS, remainingBudget), () =>
      request.destroy(timeoutError),
    );
    request.on('error', (error) => {
      recordHttpTime();
      reject(toListingTransportError(error));
    });
    signal?.addEventListener('abort', abortRequest, { once: true });
    if (signal?.aborted) abortRequest();
    request.end();
  });
}

function toListingTransportError(
  error: Error,
): Error & { status: number; code: string } {
  if (
    'status' in error &&
    typeof error.status === 'number' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error as Error & { status: number; code: string };
  }
  return fail(
    502,
    'LISTING_CONNECTION_FAILED',
    'The listing site could not be reached by the verifier. The link has been saved; paste the listing text or upload a screenshot/PDF to continue.',
  );
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    lt: '<',
    gt: '>',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|nbsp|lt|gt);/gi,
    (entity, code: string) => {
      if (code[0] === '#') {
        const number =
          code[1]?.toLowerCase() === 'x'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isInteger(number) &&
          number >= 0 &&
          number <= 0x10ffff &&
          !(number >= 0xd800 && number <= 0xdfff)
          ? String.fromCodePoint(number)
          : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}

// Legacy HTML/text consumers share the same Airbnb parser as URL extraction.
function extractAirbnbPublicData(html: string, pageUrl?: string) {
  const empty = {
    title: null as string | null,
    description: null as string | null,
    images: [] as string[],
    guestCapacity: null as number | null,
    propertyType: null as string | null,
    factsText: '',
  };
  if (!pageUrl) return empty;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return empty;
  }
  if (!airbnbListingId(url)) return empty;
  const result = extractAirbnb(html, url, url);
  const propertyType = result.facts.find(
    (fact) => fact.fieldName === 'propertyType',
  )?.normalizedValue;
  return {
    title: result.listingTitle,
    description: result.description,
    images: result.images,
    guestCapacity: result.guestCapacity,
    propertyType: typeof propertyType === 'string' ? propertyType : null,
    factsText: [
      ...new Set(
        result.facts
          .filter((fact) =>
            [
              'propertyType',
              'bedroomCount',
              'bedCount',
              'bathroomCount',
            ].includes(fact.fieldName),
          )
          .map((fact) => fact.quotedEvidence),
      ),
      ...(result.guestCapacity === null
        ? []
        : [`${result.guestCapacity} guests`]),
    ].join('\n'),
  };
}

export function htmlToText(
  html: string,
  pageUrl?: string,
): {
  text: string;
  title: string | null;
  listingTitle: string | null;
  fallbackTitle: string | null;
  titleIsFallback: boolean;
  canonicalUrl: string | null;
  description: string | null;
  descriptionIsFallback: boolean;
  descriptionSource:
    | 'airbnb_public_data'
    | 'json_ld'
    | 'visible_section'
    | 'meta_description'
    | null;
  images: string[];
  hostName: string | null;
  guestCapacity: number | null;
  amenities: string[];
  houseRules: string[];
  extractionWarnings: string[];
  image?: {
    url: string;
    source: 'og:image' | 'twitter:image' | 'json_ld' | 'airbnb_public_data';
    extractionMethod: 'metadata' | 'json_ld' | 'embedded_json';
  };
} {
  const $ = load(html);
  const airbnb = extractAirbnbPublicData(html, pageUrl);
  const ldObjects: Record<string, unknown>[] = [];
  const ldLines: string[] = [];
  $('script[type="application/ld+json"]').each((_index, node) => {
    try {
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') {
          const object = value as Record<string, unknown>;
          ldObjects.push(object);
          Object.values(object).forEach(visit);
        }
      };
      const raw = JSON.parse($(node).text()) as unknown;
      ldLines.push(JSON.stringify(raw));
      visit(raw);
    } catch {
      /* Ignore malformed JSON-LD and continue with visible page text. */
    }
  });
  const isGenericTitle = (value: string) =>
    /^(?:rental unit|room|home|apartment|property)\s+in\b/i.test(value) ||
    /\s·\s.*(?:bedrooms?|beds?|baths?|★|airbnb)/i.test(value);
  const h1Title = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const ldTitle = ldObjects
    .filter((item) =>
      /apartment|accommodation|lodging|vacationrental|house|room/i.test(
        String(item['@type'] ?? ''),
      ),
    )
    .map((item) => item.name ?? item.headline)
    .find(
      (value): value is string =>
        typeof value === 'string' && !isGenericTitle(value),
    );
  const ogTitle =
    $('meta[property="og:title"]').first().attr('content')?.trim() ||
    $('meta[name="twitter:title"], meta[property="twitter:title"]')
      .first()
      .attr('content')
      ?.trim() ||
    null;
  const pageTitle =
    $('title').first().text().replace(/\s+/g, ' ').trim() || null;
  let canonicalUrl: string | null = null;
  const canonicalHref = $('link[rel="canonical"]').first().attr('href');
  if (canonicalHref) {
    try {
      const canonical = new URL(canonicalHref, pageUrl);
      if (['http:', 'https:'].includes(canonical.protocol))
        canonicalUrl = canonical.href;
    } catch {
      /* Ignore malformed canonical metadata. */
    }
  }
  const listingTitle =
    [h1Title, airbnb.title, ldTitle, ogTitle].find((value): value is string =>
      Boolean(value && !isGenericTitle(value)),
    ) ?? null;
  const title = listingTitle ?? ogTitle ?? pageTitle ?? ldTitle ?? null;
  const titleIsFallback = !listingTitle && Boolean(title);
  const isListingImage = (candidate: unknown): candidate is string => {
    if (typeof candidate !== 'string' || !candidate.trim()) return false;
    try {
      if (
        /^[a-z][a-z\d+.-]*:/i.test(candidate.trim()) &&
        !/^https?:/i.test(candidate.trim())
      )
        return false;
      if (!pageUrl && !/^https?:\/\//i.test(candidate.trim())) return false;
      const image = new URL(candidate.trim(), pageUrl);
      if (!['http:', 'https:'].includes(image.protocol)) return false;
      if (
        /avatar|profile|icon|logo|sprite|pixel|tracking|spacer|placeholder|default-image/i.test(
          image.pathname,
        )
      )
        return false;
      if (/[.](?:svg|ico)$/i.test(image.pathname)) return false;
      return true;
    } catch {
      return false;
    }
  };
  const jsonLdImages = ldObjects.flatMap((item) => {
    const image = item.image;
    if (typeof image === 'string') return [image];
    if (Array.isArray(image))
      return image.flatMap((entry) =>
        typeof entry === 'string'
          ? [entry]
          : entry &&
              typeof entry === 'object' &&
              typeof (entry as Record<string, unknown>).url === 'string'
            ? [(entry as Record<string, string>).url]
            : [],
      );
    if (
      image &&
      typeof image === 'object' &&
      typeof (image as Record<string, unknown>).url === 'string'
    )
      return [(image as Record<string, string>).url];
    return [];
  });
  const imageCandidates: Array<{
    value: string | undefined;
    source: 'og:image' | 'twitter:image' | 'json_ld' | 'airbnb_public_data';
    extractionMethod: 'metadata' | 'json_ld' | 'embedded_json';
  }> = [
    ...$('meta[property="og:image"]')
      .map((_i, node) => $(node).attr('content'))
      .get()
      .map((value) => ({
        value,
        source: 'og:image' as const,
        extractionMethod: 'metadata' as const,
      })),
    ...$('meta[property="og:image:secure_url"]')
      .map((_i, node) => $(node).attr('content'))
      .get()
      .map((value) => ({
        value,
        source: 'og:image' as const,
        extractionMethod: 'metadata' as const,
      })),
    ...jsonLdImages.map((value) => ({
      value,
      source: 'json_ld' as const,
      extractionMethod: 'json_ld' as const,
    })),
    ...airbnb.images.map((value) => ({
      value,
      source: 'airbnb_public_data' as const,
      extractionMethod: 'embedded_json' as const,
    })),
    ...$('meta[name="twitter:image"], meta[property="twitter:image"]')
      .map((_i, node) => $(node).attr('content'))
      .get()
      .map((value) => ({
        value,
        source: 'twitter:image' as const,
        extractionMethod: 'metadata' as const,
      })),
  ];
  const images = [
    ...new Set(
      imageCandidates
        .filter((candidate) => isListingImage(candidate.value))
        .map((candidate) => new URL(candidate.value!, pageUrl).href),
    ),
  ];
  const image = images[0];
  const imageCandidate = imageCandidates.find(
    (candidate) =>
      isListingImage(candidate.value) &&
      new URL(candidate.value, pageUrl).href === image,
  );
  // Preserve exact JSON as evidence instead of manufacturing visible listing copy.
  $(
    'script, style, noscript, svg, nav, footer, header, aside, form, button, [hidden], [aria-hidden="true"]',
  ).remove();
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, tr, section, article').each(
    (_index, element) => {
      $(element).append('\n');
    },
  );
  const visible = ($('body').text() || $.root().text())
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const metadata = $(
    'meta[property="og:description"], meta[name="twitter:description"], meta[property="twitter:description"], meta[name="description"]',
  )
    .map((_i, node) => $(node).attr('content') ?? '')
    .get()
    .filter(Boolean)
    .join('\n');
  const cleanText = (value: string) =>
    decodeEntities(value)
      .replace(/\\n/g, '\n')
      .replace(/\r/g, '')
      .replace(/[\t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const jsonDescription = ldObjects
    .map((item) => item.description)
    .find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 40,
    );
  const metaDescription =
    $('meta[property="og:description"]').first().attr('content') ||
    $('meta[name="twitter:description"], meta[property="twitter:description"]')
      .first()
      .attr('content') ||
    $('meta[name="description"]').first().attr('content') ||
    '';
  const headingSections: string[] = [];
  const visibleAmenities: string[] = [];
  const visibleHouseRules: string[] = [];
  $('h1, h2, h3').each((_index, heading) => {
    const headingText = $(heading).text().replace(/\s+/g, ' ').trim();
    if (
      !/^(about this space|description|the space|amenities|house rules|other things to note)$/i.test(
        headingText,
      )
    )
      return;
    const section = $(heading).closest('section').length
      ? $(heading).closest('section')
      : $(heading).parent();
    const sectionText = cleanText(section.text());
    const siblingText = cleanText(
      $(heading)
        .nextUntil('h1, h2, h3')
        .toArray()
        .map((node) => $(node).text())
        .join('\n'),
    );
    const content =
      sectionText.length > headingText.length + 20 ? sectionText : siblingText;
    if (content.length > headingText.length + 20) headingSections.push(content);
    const listItems = section
      .find('li')
      .toArray()
      .map((item) => cleanText($(item).text()))
      .filter(Boolean);
    if (/^amenities$/i.test(headingText))
      visibleAmenities.push(
        ...(listItems.length
          ? listItems
          : siblingText.split('\n').filter(Boolean)),
      );
    if (/^house rules$/i.test(headingText))
      visibleHouseRules.push(
        ...(listItems.length ? listItems : [siblingText || sectionText]),
      );
  });
  const visibleDescription = headingSections.join('\n\n');
  const descriptionSource = airbnb.description
    ? 'airbnb_public_data'
    : jsonDescription
      ? 'json_ld'
      : visibleDescription
        ? 'visible_section'
        : metaDescription
          ? 'meta_description'
          : null;
  const descriptionIsFallback = descriptionSource === 'meta_description';
  const description =
    cleanText(
      airbnb.description ||
        jsonDescription ||
        visibleDescription ||
        metaDescription,
    ).slice(0, 12_000) || null;
  const hostName =
    ldObjects
      .map((item) => item.host)
      .map((host) =>
        host && typeof host === 'object'
          ? (host as Record<string, unknown>).name
          : null,
      )
      .find((value): value is string => typeof value === 'string') ?? null;
  const guestCapacityValue = ldObjects
    .map(
      (item) =>
        item.occupancy ?? item.maximumAttendeeCapacity ?? item.maxGuests,
    )
    .find((value) => Number.isFinite(Number(value)));
  const guestCapacity =
    airbnb.guestCapacity ??
    (guestCapacityValue === undefined ? null : Number(guestCapacityValue));
  const amenities = [
    ...new Set(
      ldObjects.flatMap((item) => {
        const value = item.amenityFeature ?? item.amenities;
        const list = Array.isArray(value)
          ? value
          : value === undefined
            ? []
            : [value];
        return list
          .map((entry) =>
            typeof entry === 'string'
              ? cleanText(entry)
              : entry && typeof entry === 'object'
                ? cleanText(
                    String((entry as Record<string, unknown>).name ?? ''),
                  )
                : '',
          )
          .filter(Boolean);
      }),
    ),
    ...visibleAmenities,
  ].slice(0, 100);
  const houseRules = [
    ...new Set(
      ldObjects.flatMap((item) => {
        const rules = item.houseRules ?? item.rules;
        return Array.isArray(rules)
          ? rules
              .filter((rule): rule is string => typeof rule === 'string')
              .map(cleanText)
          : typeof rules === 'string'
            ? [cleanText(rules)]
            : [];
      }),
    ),
    ...visibleHouseRules,
  ].slice(0, 30);
  const extractionWarnings = [
    titleIsFallback
      ? 'A listing-specific title was not present; showing the available page title.'
      : null,
    descriptionIsFallback
      ? 'Only a page summary was available; the full listing description was not returned.'
      : description
        ? null
        : 'A listing description was not available in the fetched page.',
    images.length
      ? null
      : 'A listing image was not available in the fetched page.',
    !hostName || !amenities.length
      ? 'Some listing details, such as host or amenities, were not available in the fetched page.'
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  const listingImageMetadata = image ? `Listing image: ${image}` : '';
  const structured = [...new Set(ldLines)].join('\n');
  return {
    text: [
      visible,
      titleIsFallback && title ? `Listing page title: ${title}` : '',
      metadata ? `Listing metadata:\n${metadata}` : '',
      description ? `Listing description:\n${description}` : '',
      listingImageMetadata,
      airbnb.factsText ? `Public listing details:\n${airbnb.factsText}` : '',
      structured ? `Structured listing data:\n${structured}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 20_000),
    title: title ? decodeEntities(title).slice(0, 180) : null,
    listingTitle: listingTitle ? cleanText(listingTitle).slice(0, 180) : null,
    fallbackTitle:
      titleIsFallback && title ? cleanText(title).slice(0, 180) : null,
    titleIsFallback,
    canonicalUrl,
    description,
    descriptionIsFallback,
    descriptionSource,
    images,
    hostName,
    guestCapacity,
    amenities,
    houseRules,
    extractionWarnings,
    ...(image && imageCandidate
      ? {
          image: {
            url: new URL(image, pageUrl).href,
            source: imageCandidate.source,
            extractionMethod: imageCandidate.extractionMethod,
          },
        }
      : {}),
  };
}

type FactField =
  | 'listingTitle'
  | 'propertyType'
  | 'location'
  | 'monthlyRent'
  | 'depositAmount'
  | 'currency'
  | 'bedroomCount'
  | 'bathroomCount'
  | 'address'
  | string;
export function extractFacts(
  text: string,
  sourceId: string,
  title: string | null,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const hasPageMarkers = /(?:^|\f)Page \d+\n/.test(text);
  const add = (
    fieldName: FactField,
    normalizedValue: unknown,
    quotedEvidence: string,
  ) => {
    const quote = quotedEvidence.trim();
    const index = text.indexOf(quote);
    const preceding = index >= 0 ? text.slice(0, index) : '';
    const pageNumber = preceding.split('\f').length;
    const line = preceding
      .slice(preceding.lastIndexOf('\f') + 1)
      .split('\n').length;
    facts.push({
      id: randomUUID(),
      sourceId,
      fieldName,
      normalizedValue,
      quotedEvidence: quote,
      textLocation: `Line ${line}`,
      extractionMethod: preceding.includes('Structured listing data:')
        ? 'json_ld'
        : preceding.includes('Listing metadata:')
          ? 'metadata'
          : 'text',
      ...(hasPageMarkers ? { pageNumber } : {}),
    });
  };
  if (title && text.includes(title)) add('listingTitle', title, title);
  const explicitTitle = text.match(
    /(?:property|listing)\s+title\s*:\s*([^\n]+)/i,
  );
  if (explicitTitle)
    add('listingTitle', explicitTitle[1]!.trim(), explicitTitle[0]);
  const explicitCurrency = text.match(/^currency\s*:\s*([A-Z]{3})\s*$/im);
  if (explicitCurrency)
    add(
      'currency',
      normalizeCurrency(explicitCurrency[1]!),
      explicitCurrency[0],
    );

  const structuredStart = text.indexOf('Structured listing data:');
  const safeText = structuredStart < 0 ? text : text.slice(0, structuredStart);
  const propertyType = safeText.match(
    /\b(entire rental unit|apartment|condo(?:minium)?|townhouse|house|studio|room|villa|flat)\b/i,
  );
  if (propertyType)
    add('propertyType', propertyType[1]!.toLowerCase(), propertyType[0]);

  const amountPattern = '([\\d,]+(?:\\.\\d{1,2})?\\s*[kK]?)';
  const parseAmount = (value: string) => {
    const cleaned = value
      .replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
      .replaceAll(',', '')
      .replace(/\s/g, '');
    return (
      Number(cleaned.replace(/k$/i, '')) * (/k$/i.test(cleaned) ? 1000 : 1)
    );
  };
  const currencyFor = (code?: string) =>
    code ? normalizeCurrency(code) : null;
  const structuredIndex = structuredStart;
  const factText = safeText.replace(/^Listing page title:.*$/gim, '');
  const visibleText = factText;
  if (!explicitCurrency) {
    const bahtEvidence = findBahtCurrencyEvidence(visibleText);
    if (bahtEvidence)
      add('currency', bahtEvidence.currency, bahtEvidence.quote);
  }
  const prices = extractPrices(visibleText);
  if (structuredIndex >= 0) {
    const visit = (
      input: unknown,
      quote: string,
      inheritedCurrency?: string,
    ): void => {
      if (Array.isArray(input)) {
        input.forEach((item) => visit(item, quote, inheritedCurrency));
        return;
      }
      if (!input || typeof input !== 'object') return;
      const object = input as Record<string, unknown>;
      const objectType = Array.isArray(object['@type'])
        ? object['@type'].join(' ')
        : String(object['@type'] ?? '');
      if (
        /\b(apartment|condo|house|room|villa|townhouse|studio|vacationrental)\b/i.test(
          objectType,
        )
      )
        add(
          'propertyType',
          objectType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
          quote,
        );
      if (object.price !== undefined && Number.isFinite(Number(object.price))) {
        const rawCurrency =
          typeof object.priceCurrency === 'string'
            ? object.priceCurrency
            : (inheritedCurrency ?? null);
        const currency = rawCurrency ? normalizeCurrency(rawCurrency) : null;
        const unit = String(
          object.unitText ?? object.unitCode ?? object.priceType ?? '',
        );
        const basis = /^(month|monthly|MON|per month)$/i.test(unit)
          ? 'monthly_rent'
          : /^(night|nightly|per night)$/i.test(unit)
            ? 'nightly_rate'
            : /^(week|weekly|WEE|per week)$/i.test(unit)
              ? 'weekly_rate'
              : 'unknown';
        const amount = Number(object.price);
        if (amount >= 0) {
          // Matching explicit visible evidence refines a generic metadata amount.
          const corroborated = prices.some(
            (item) =>
              item.price.amount === amount &&
              item.price.currency === currency &&
              (basis === 'unknown' || item.price.basis === basis),
          );
          if (!corroborated)
            prices.push({
              quote,
              price: {
                amount,
                currency,
                rawCurrency,
                rawText: quote,
                basis,
                basisExplicit: basis !== 'unknown',
              },
            });
        }
      }
      for (const [key, field] of [
        ['numberOfBedrooms', 'bedroomCount'],
        ['numberOfBeds', 'bedCount'],
        ['numberOfBathroomsTotal', 'bathroomCount'],
      ] as const) {
        if (object[key] !== undefined && Number.isFinite(Number(object[key])))
          add(field, Number(object[key]), quote);
      }
      if (object.address && typeof object.address === 'object') {
        const address = object.address as Record<string, unknown>;
        if (typeof address.streetAddress === 'string')
          add('address', address.streetAddress, quote);
        for (const [key, field] of [
          ['addressLocality', 'locality'],
          ['addressRegion', 'city'],
          ['postalCode', 'postalCode'],
          ['addressCountry', 'country'],
        ] as const) {
          if (typeof address[key] === 'string') add(field, address[key], quote);
        }
      }
      if (typeof object.description === 'string' && object.description.trim())
        add('description', object.description.trim(), quote);
      if (
        typeof object.name === 'string' &&
        /apartment|accommodation|lodging|vacationrental|house|room/i.test(
          String(object['@type'] ?? ''),
        )
      )
        add('listingTitle', object.name, quote);
      const host = object.host;
      if (
        host &&
        typeof host === 'object' &&
        typeof (host as Record<string, unknown>).name === 'string'
      )
        add('hostName', (host as Record<string, string>).name, quote);
      const capacity =
        object.occupancy ?? object.maximumAttendeeCapacity ?? object.maxGuests;
      if (Number.isFinite(Number(capacity)))
        add('maxGuests', Number(capacity), quote);
      const amenityList = object.amenityFeature ?? object.amenities;
      for (const amenity of Array.isArray(amenityList)
        ? amenityList
        : amenityList === undefined
          ? []
          : [amenityList]) {
        const name =
          typeof amenity === 'string'
            ? amenity
            : amenity && typeof amenity === 'object'
              ? (amenity as Record<string, unknown>).name
              : null;
        if (typeof name === 'string' && name.trim())
          add('amenity', name.trim(), quote);
      }
      const rules = object.houseRules ?? object.rules;
      for (const rule of Array.isArray(rules)
        ? rules
        : typeof rules === 'string'
          ? [rules]
          : [])
        if (typeof rule === 'string' && rule.trim())
          add('houseRule', rule.trim(), quote);
      Object.values(object).forEach((value) =>
        visit(
          value,
          quote,
          typeof object.priceCurrency === 'string'
            ? object.priceCurrency
            : inheritedCurrency,
        ),
      );
    };
    for (const line of text.slice(structuredIndex).split('\n').slice(1)) {
      try {
        visit(JSON.parse(line), line);
      } catch {
        /* Malformed metadata is ignored. */
      }
    }
  }
  for (let i = prices.length - 1; i >= 0; i--) {
    const item = prices[i]!;
    if (
      item.price.basis === 'unknown' &&
      prices.some(
        (other) =>
          other.price.basis !== 'unknown' &&
          other.price.amount === item.price.amount &&
          other.price.currency === item.price.currency,
      )
    )
      prices.splice(i, 1);
  }
  for (const { price, quote } of prices) add('price', price, quote);
  for (const [basis, field, currencyField] of [
    ['monthly_rent', 'monthlyRent', 'currency'],
    ['deposit', 'depositAmount', 'depositCurrency'],
  ] as const) {
    const candidates = prices.filter(({ price }) => price.basis === basis);
    // Legacy scalar fields are safe only when the claim is unambiguous.
    const unique = new Set(
      candidates.map(({ price }) => `${price.amount}:${price.currency}`),
    );
    if (unique.size === 1) {
      const item = candidates[0]!;
      add(field, item.price.amount, item.quote);
      if (item.price.currency)
        add(currencyField, item.price.currency, item.quote);
    }
  }
  const range = factText.match(
    /(?:THB|฿|USD|EUR|GBP)\s*([\d,]+)\s*[-–]\s*([\d,]+)\s*\/\s*month\b/i,
  );
  if (range) {
    add('monthlyRentMin', parseAmount(range[1]!), range[0]);
    add('monthlyRentMax', parseAmount(range[2]!), range[0]);
    add('monthlyRent', parseAmount(range[1]!), range[0]);
    add(
      'currency',
      currencyFor(range[0].match(/THB|฿|USD|EUR|GBP/i)?.[0]),
      range[0],
    );
  }
  const upfrontTotal = factText.match(
    new RegExp(
      `(?:move[- ]in\\s+total|total\\s+(?:due|upfront|to\\s+move[- ]in|at\\s+move[- ]in))\\s*(?:is|of|:|-|=)?\\s*(USD|EUR|GBP|THB|CAD|AUD|SGD|[$€£฿])?\\s*${amountPattern}`,
      'i',
    ),
  );
  if (upfrontTotal) {
    add('upfrontTotalAmount', parseAmount(upfrontTotal[2]!), upfrontTotal[0]);
    const trailing = factText
      .slice((upfrontTotal.index ?? 0) + upfrontTotal[0].length)
      .match(/^\s*(USD|EUR|GBP|THB|CAD|AUD|SGD|baht|บาท)\b/i)?.[0]
      ?.trim();
    const totalCurrency = upfrontTotal[1] ?? trailing;
    if (totalCurrency)
      add(
        'upfrontTotalCurrency',
        currencyFor(
          totalCurrency === 'บาท' || totalCurrency.toLowerCase() === 'baht'
            ? 'THB'
            : totalCurrency,
        ),
        upfrontTotal[0] + (trailing ?? ''),
      );
  }
  const depositMonths = factText.match(
    /(\d+)\s+months?\s+(?:security\s+)?deposit/i,
  );
  if (depositMonths)
    add('depositMonths', Number(depositMonths[1]), depositMonths[0]);
  const advanceMonths = factText.match(
    /(\d+)\s+months?\s+(?:advance(?:\s+rent(?:al)?)?|upfront(?:\s+rent)?)\b/i,
  );
  if (advanceMonths)
    add('advanceRentMonths', Number(advanceMonths[1]), advanceMonths[0]);
  const countText =
    title && /luxury|best|5.star|superhost/i.test(title)
      ? factText.replace(title, '')
      : factText;
  const beds =
    countText.match(/(\d+(?:\.5)?)[ \t]*(?:bedrooms?|br)\b/i) ??
    countText.match(/(?:bedrooms?)[ \t]*[:-]?[ \t]*(\d+(?:\.5)?)/i);
  if (beds) add('bedroomCount', Number(beds[1]), beds[0]);
  for (const [field, pattern] of [
    ['bedCount', /(?:\b(\d+)\s+beds?\b|\bbeds?\s*:\s*(\d+))/i],
    [
      'maxGuests',
      /(?:\b(\d+)\s+guests?\b|(?:maximum guests|guests)\s*:\s*(\d+))/i,
    ],
    ['areaSquareMeters', /\b(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm|square meters)/i],
    ['hostName', /(?:hosted by|host\s*:)\s*([^\n,;]+)/i],
    ['houseRule', /\bNo cooking[^\n.]*/i],
  ] as const) {
    const match = factText.match(pattern);
    if (match)
      add(
        field,
        field === 'hostName'
          ? match[1]!.trim()
          : field === 'houseRule'
            ? match[0]
            : Number(match[1] ?? match[2]),
        match[0],
      );
  }
  const baths =
    factText.match(/(\d+(?:\.5)?)[ \t]*(?:bathrooms?|baths?)\b/i) ??
    factText.match(/(?:bathrooms?|baths?)[ \t]*[:-]?[ \t]*(\d+(?:\.5)?)/i);
  if (baths) add('bathroomCount', Number(baths[1]), baths[0]);
  const roomType =
    factText.match(
      /(?:room\s+type|unit\s+type)\s*[:-]?\s*(standard(?:\s+city\s+view)?|superior(?:\s+city\s+view)?|deluxe|studio|family\s+1?\s*bedroom|one[- ]bedroom|1[- ]bedroom)/i,
    ) ??
    factText.match(
      /\b(standard(?:\s+city\s+view)?|superior(?:\s+city\s+view)?|deluxe|family\s+1\s+bedroom)\s+room\b/i,
    );
  if (roomType)
    add(
      'roomType',
      roomType[1]!.trim().toLocaleLowerCase().replace(/\s+/g, ' '),
      roomType[0],
    );
  const datePattern =
    '(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})';
  for (const [field, pattern] of [
    [
      'listingDate',
      new RegExp(
        `(?:listed|posted|published)\\s+(?:on)?\\s*[: -]?\\s*${datePattern}`,
        'i',
      ),
    ],
    [
      'availableFrom',
      new RegExp(
        `(?:available|move[- ]in)\\s+(?:from|date|on)?\\s*[: -]?\\s*${datePattern}`,
        'i',
      ),
    ],
    [
      'leaseStartDate',
      new RegExp(
        `(?:lease|contract)\\s+(?:starts?|start date|from)\\s*[: -]?\\s*${datePattern}`,
        'i',
      ),
    ],
    [
      'leaseEndDate',
      new RegExp(
        `(?:lease|contract)\\s+(?:ends?|end date|until|to)\\s*[: -]?\\s*${datePattern}`,
        'i',
      ),
    ],
  ] as const) {
    const match = factText.match(pattern);
    if (match) {
      const parsed = new Date(match[1]!);
      add(
        field,
        Number.isNaN(parsed.getTime())
          ? match[1]
          : parsed.toISOString().slice(0, 10),
        match[0],
      );
    }
  }
  const leaseTerm = factText.match(
    /(?:minimum\s+)?(\d+)\s*(months?|years?)\s+(?:lease|contract)|(?:minimum\s+)?(?:lease|contract)(?:\s+term)?\s*(?:of|:)?\s*(\d+)\s*(months?|years?)/i,
  );
  if (leaseTerm) {
    const count = leaseTerm[1] ?? leaseTerm[3]!;
    const unit = leaseTerm[2] ?? leaseTerm[4]!;
    add(
      'leaseTermMonths',
      Number(count) * (/year/i.test(unit) ? 12 : 1),
      leaseTerm[0],
    );
  }
  const paymentRequestPatterns: Array<[string, RegExp]> = [
    [
      'payment_before_viewing',
      /(?:pay|send|transfer|deposit)[^\n.]{0,70}(?:before (?:viewing|seeing)|to secure|before viewing)/i,
    ],
    [
      'security_deposit',
      /(?:\d+\s+months?\s+)?(?:security\s+)?deposit(?:\s+of\s+[\w฿$,. ]+)?/i,
    ],
    ['advance_rent', /(?:\d+\s+months?\s+)?advance\s+rent(?:al)?/i],
    ['booking_fee', /(?:booking|reservation|application)\s+fee/i],
  ];
  for (const [kind, pattern] of paymentRequestPatterns) {
    const match = factText.match(pattern);
    if (match) add('paymentRequest', kind, match[0]);
  }
  const paymentMethods: Array<[string, RegExp]> = [
    ['cryptocurrency', /\b(?:cryptocurrency|crypto|bitcoin|btc|ethereum)\b/i],
    ['wire_transfer', /\bwire transfer\b/i],
    ['bank_transfer', /\b(?:bank transfer|bank account|direct deposit)\b/i],
    ['promptpay', /\bprompt\s*pay\b/i],
    ['gift_card', /\bgift cards?\b/i],
    ['western_union', /\bwestern union\b/i],
    ['moneygram', /\bmoneygram\b/i],
    ['cash', /\bcash\b/i],
    ['paypal', /\bpaypal\b/i],
  ];
  for (const [method, pattern] of paymentMethods) {
    const match = factText.match(pattern);
    if (match) add('paymentMethod', method, match[0]);
  }
  const recipient = factText.match(
    /(?:account\s*(?:name|holder)|beneficiary|recipient|payee|transfer\s+to|pay\s+to)\s*[:=-]?\s*([^\n,;]{2,100})/i,
  );
  if (recipient)
    add(
      'paymentRecipient',
      recipient[1]!.trim().replace(/[.\s]+$/, ''),
      recipient[0],
    );
  const feePatterns: Array<[string, RegExp]> = [
    [
      'reservationFeeAmount',
      new RegExp(
        `(?:reservation|booking|holding|application)\\s+fee\\s*(?:is|of|:|-|=)?\\s*(USD|EUR|GBP|THB|CAD|AUD|SGD|[$€£฿])?\\s*${amountPattern}`,
        'i',
      ),
    ],
    [
      'cleaningFeeAmount',
      new RegExp(
        `cleaning\\s+fee\\s*(?:is|of|:|-|=)?\\s*(USD|EUR|GBP|THB|CAD|AUD|SGD|[$€£฿])?\\s*${amountPattern}`,
        'i',
      ),
    ],
    [
      'administrativeFeeAmount',
      new RegExp(
        `(?:admin(?:istration)?|service)\\s+fee\\s*(?:is|of|:|-|=)?\\s*(USD|EUR|GBP|THB|CAD|AUD|SGD|[$€£฿])?\\s*${amountPattern}`,
        'i',
      ),
    ],
  ];
  for (const [field, pattern] of feePatterns) {
    const match = factText.match(pattern);
    if (match) {
      add(field, parseAmount(match[2]!), match[0]);
      if (match[1]) {
        const code =
          match[1] === 'บาท' || match[1].toLowerCase() === 'baht'
            ? 'THB'
            : match[1];
        add(field.replace('Amount', 'Currency'), currencyFor(code), match[0]);
      }
    }
  }
  for (const [field, pattern] of [
    [
      'landlordName',
      /(?:landlord|lessor|property owner)\s*[:-]\s*([^\n,;]{2,100})/i,
    ],
    ['tenantName', /(?:tenant|lessee|renter)\s*[:-]\s*([^\n,;]{2,100})/i],
  ] as const) {
    const match = factText.match(pattern);
    if (match) add(field, match[1]!.trim(), match[0]);
  }
  const obligations =
    factText.match(
      /[^\n.]{0,35}\b(?:shall|must|agrees? to|responsible for|may not|is prohibited from)\b[^\n.]{0,140}/gi,
    ) ?? [];
  for (const obligation of obligations.slice(0, 12))
    add('leaseObligation', obligation.trim(), obligation.trim());
  const location = factText.match(
    /(?:located in|neighborhood|neighbourhood|city|location)\s*[:-]\s*([^\n.;]{2,60})/i,
  );
  if (location) add('location', location[1]!.trim(), location[0]);
  const namedCity = factText.match(
    /\b(?:neighborhood of|located in)\s+([A-Z][A-Za-z -]{1,40}?)(?=[.,])/,
  );
  if (namedCity) add('city', namedCity[1]!.trim(), namedCity[0]);
  const address = factText.match(
    /(?:(?:full\s+)?address|located at)\s*[:-]\s*([^\n.;]{8,120})/i,
  );
  if (address && /[0-9๐-๙]/.test(address[1]!))
    add('address', address[1]!.trim(), address[0]);
  else {
    const streetAddress = factText.match(
      /^\s*(\d{1,5}\s+[^\n,]{3,80},\s*[^\n,]{2,60},\s*Bangkok(?: \d{5})?)\s*$/im,
    );
    if (streetAddress)
      add('address', streetAddress[1]!.trim(), streetAddress[0]);
  }
  const locationLine = factText
    .split('\n')
    .find(
      (line) =>
        /rental unit in/i.test(line) ||
        /^[A-Za-z][A-Za-z .'-]{1,40},\s*[A-Za-z .'-]+,\s*Thailand$/i.test(line),
    );
  if (locationLine) {
    const placeMatch = locationLine.match(/rental unit in\s+([^·,]+)/i);
    const raw = (placeMatch?.[1] ?? locationLine).trim();
    add('location', raw, locationLine);
    if (/Thailand/i.test(locationLine))
      add('country', 'Thailand', locationLine);
    if (/Bangkok/i.test(locationLine)) add('city', 'Bangkok', locationLine);
    add('locality', raw.split(',')[0]!.trim(), locationLine);
  }
  const postal = factText.match(/\bBangkok\s+(\d{5})\b/i);
  if (postal) add('postalCode', postal[1], postal[0]);
  const description = text.match(
    /Listing description:\n([\s\S]*?)(?=\nListing image:|\nStructured listing data:|$)/,
  );
  if (
    description?.[1]?.trim() &&
    !facts.some((fact) => fact.fieldName === 'description')
  )
    add('description', description[1].trim(), description[1].trim());
  const image = text.match(/Listing image:\s*(https?:\/\/[^\s]+)/i);
  if (image) add('listingImage', image[1], image[0]);
  return facts.filter(
    (fact, index) =>
      facts.findIndex(
        (other) =>
          other.fieldName === fact.fieldName &&
          JSON.stringify(other.normalizedValue) ===
            JSON.stringify(fact.normalizedValue) &&
          other.quotedEvidence === fact.quotedEvidence,
      ) === index,
  );
}

function makeSource(
  type: EvidenceSourceType,
  name: string,
  originalUrl: string | null,
  text: string,
  titleOverride: string | null = null,
): { source: EvidenceSource; facts: ExtractedFact[] } {
  const id = randomUUID();
  const titleMatch = text.match(/^([^\n.!?]{5,100})/);
  const title =
    type === 'listing_url'
      ? titleOverride
      : type === 'listing_text'
        ? (titleOverride ??
          (/correction|manually entered/i.test(name)
            ? null
            : (titleMatch?.[1]?.trim() ?? null)))
        : null;
  const sourceText =
    title && !text.includes(title) ? `${title}\n${text}` : text;
  const source: EvidenceSource = {
    id,
    type,
    name,
    originalUrl,
    extractedText: sourceText.slice(0, 20_000),
    extractionStatus: 'complete',
  };
  const sealedSource = sealEvidenceSource(source);
  return {
    source: sealedSource,
    facts: extractFacts(sealedSource.extractedText!, id, title),
  };
}

export function extractPastedText(
  text: string,
  type: EvidenceSourceType,
  name: string,
  evidenceKind: 'user_source' | 'user_assertion' = 'user_source',
) {
  const result = makeSource(type, name, null, text);
  result.source = sealEvidenceSource({
    ...result.source,
    evidenceKind,
    extractionMethod: 'text',
  });
  return result;
}

export async function extractListingUrl(
  rawUrl: string,
  options: {
    fetchPage?: typeof readPage;
    signal?: AbortSignal;
    budgetMs?: number;
  } = {},
) {
  const startedAt = performance.now();
  const timings: ExtractionTimings = {
    dnsMs: 0,
    httpMs: 0,
    redirects: 0,
    parsingMs: 0,
    normalizationMs: 0,
    payloadBytes: 0,
  };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw fail(400, 'INVALID_URL', 'Enter a valid public listing URL.');
  }
  const deadlineAt = startedAt + (options.budgetMs ?? extractionBudgetMs());
  const page = await withinExtractionBudget(
    (options.fetchPage ?? readPage)(
      url,
      0,
      timings,
      deadlineAt,
      options.signal,
    ),
    deadlineAt,
    options.signal,
  );
  const requestedAirbnbId = airbnbListingId(url);
  if (requestedAirbnbId && airbnbListingId(page.url) !== requestedAirbnbId)
    throw fail(
      422,
      'LISTING_ID_MISMATCH',
      'The source redirected away from the requested Airbnb listing.',
    );
  if (
    (requestedAirbnbId || airbnbListingId(page.url)) &&
    page.contentType !== 'text/plain'
  ) {
    const parseStart = performance.now();
    const result = extractAirbnb(page.body, page.url, url);
    timings.parsingMs = performance.now() - parseStart;
    if (performance.now() > deadlineAt)
      throw fail(
        504,
        'FETCH_TIMEOUT',
        'Listing extraction exceeded its time budget while parsing.',
      );
    const currentPrice = reliableCurrentPrice(result.facts);
    return {
      ...result,
      currency: currentPrice?.currency ?? null,
      priceBasis: currentPrice?.basis ?? null,
      extractionDurationMs: performance.now() - startedAt,
      timings,
    };
  }
  const isHtml = page.contentType !== 'text/plain';
  const parseStartedAt = performance.now();
  const parsed = isHtml
    ? htmlToText(page.body, page.url.toString())
    : {
        text: page.body.trim().slice(0, 20_000),
        title: null,
        listingTitle: null,
        fallbackTitle: null,
        titleIsFallback: false,
        canonicalUrl: null,
        listingId: null,
        description: null,
        descriptionIsFallback: false,
        descriptionSource: null,
        images: [],
        hostName: null,
        guestCapacity: null,
        amenities: [],
        houseRules: [],
        extractionWarnings: [
          'This response did not include HTML listing metadata.',
        ],
        image: undefined,
      };
  timings.parsingMs = performance.now() - parseStartedAt;
  if (performance.now() > deadlineAt)
    throw fail(
      504,
      'FETCH_TIMEOUT',
      'Listing extraction exceeded its time budget while parsing.',
    );
  if (parsed.text.length < 20)
    throw fail(
      422,
      'NO_LISTING_TEXT',
      'We could not find enough readable listing text on that page. Paste the listing text instead.',
    );
  const normalizeStartedAt = performance.now();
  const extracted = makeSource(
    'listing_url',
    parsed.listingTitle || parsed.title || page.url.hostname,
    page.url.toString(),
    parsed.text,
    parsed.listingTitle,
  );
  timings.normalizationMs = performance.now() - normalizeStartedAt;
  if (performance.now() > deadlineAt)
    throw fail(
      504,
      'FETCH_TIMEOUT',
      'Listing extraction exceeded its time budget while preparing the result.',
    );
  const extractionDurationMs = performance.now() - startedAt;
  const listingId = /(?:^|\.)airbnb\.[a-z.]+$/i.test(url.hostname)
    ? (url.pathname.match(/\/rooms\/([0-9]+)/)?.[1] ?? null)
    : null;
  const factValue = (field: string) =>
    extracted.facts.find((fact) => fact.fieldName === field)?.normalizedValue;
  const mergeTextValues = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = value
        .toLocaleLowerCase()
        .replace(/[.,;:!?]+$/g, '')
        .trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const result = {
    ...extracted,
    ...(parsed.image ? { listingImage: parsed.image } : {}),
    listingTitle: parsed.listingTitle,
    fallbackTitle: parsed.fallbackTitle,
    titleIsFallback: parsed.titleIsFallback,
    canonicalUrl: parsed.canonicalUrl,
    listingId,
    description: parsed.description,
    descriptionIsFallback: parsed.descriptionIsFallback,
    descriptionSource: parsed.descriptionSource,
    imageUrl: parsed.image?.url ?? null,
    images: parsed.images,
    hostName:
      parsed.hostName ??
      (typeof factValue('hostName') === 'string'
        ? String(factValue('hostName'))
        : null),
    guestCapacity:
      parsed.guestCapacity ??
      (typeof factValue('maxGuests') === 'number'
        ? Number(factValue('maxGuests'))
        : null),
    amenities: mergeTextValues([
      ...parsed.amenities,
      ...extracted.facts
        .filter((fact) => fact.fieldName === 'amenity')
        .map((fact) => String(fact.normalizedValue)),
    ]),
    houseRules: mergeTextValues([
      ...parsed.houseRules,
      ...extracted.facts
        .filter((fact) => fact.fieldName === 'houseRule')
        .map((fact) => String(fact.normalizedValue)),
    ]),
    extractionWarnings: parsed.extractionWarnings,
    bookingContext: bookingContextFromUrl(url),
    prices: extracted.facts
      .filter((fact) => fact.fieldName === 'price')
      .map((fact) => fact.normalizedValue as PriceRecord),
    currency:
      (typeof factValue('currency') === 'string'
        ? normalizeCurrency(String(factValue('currency')))
        : null) ??
      bookingContextFromUrl(url).currency ??
      null,
    priceBasis: reliableCurrentPrice(extracted.facts)?.basis ?? null,
    priceStatus: reliableCurrentPrice(extracted.facts)
      ? 'extracted'
      : extracted.facts.some((fact) => fact.fieldName === 'price')
        ? 'ambiguous'
        : 'not_in_response',
    extractionDurationMs,
    timings,
  };
  return result;
}

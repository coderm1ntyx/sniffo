import type {
  EvidenceSource,
  ExtractedFact,
  ResearchResult,
  ResearchStage,
} from '@sniffo/shared';
import { env } from '../../config/env.js';
import { stableId } from '../evidenceIntegrity.js';
import { sealEvidenceSource } from '../sourceSignature.js';
import { canonicalKey } from './cache.js';
import { buildQueries, matchProperty, profile } from './profile.js';
import {
  configuredSearch,
  publicDomain,
  retrievePublicPage,
  type PublicPage,
  type SearchProvider,
  type SearchResult,
} from './publicSources.js';
import { compareProfiles } from './comparator.js';
import { compareImages, skippedVision } from './vision.js';

let activeResearch = 0;
export type ResearchDeps = {
  search?: SearchProvider;
  retrieve?: typeof retrievePublicPage;
  vision?: typeof compareImages;
  timeoutMs?: number;
  candidateTimeoutMs?: number;
  signal?: AbortSignal;
};

export function classifyCandidateFetchFailure(
  error: unknown,
  scanAborted = false,
) {
  const err = error as {
    name?: string;
    code?: string;
    status?: number;
    message?: string;
  };
  const code = String(err?.code ?? '').toUpperCase();
  const message = String(err?.message ?? '').toLowerCase();
  if (scanAborted)
    return {
      status: 'timed_out' as const,
      reason: 'Candidate-processing deadline reached.',
    };
  if (
    err?.name === 'TimeoutError' ||
    code === 'FETCH_TIMEOUT' ||
    /timed? ?out|time budget/.test(message)
  )
    return {
      status: 'timed_out' as const,
      reason: 'Request timed out while fetching the candidate page.',
    };
  if (
    ['LISTING_ACCESS_BLOCKED', 'LISTING_RATE_LIMITED'].includes(code) ||
    err?.status === 403 ||
    err?.status === 429
  )
    return {
      status: 'fetch_failed' as const,
      reason: 'Website blocked or rate-limited automated access.',
    };
  if (
    /robots|disallow|public access policy|safe|private ip|unsafe|not allowed/.test(
      message,
    ) ||
    ['URL_NOT_ALLOWED', 'PUBLIC_ACCESS_POLICY'].includes(code)
  )
    return {
      status: 'fetch_failed' as const,
      reason: 'Safe-access restriction prevented retrieval.',
    };
  if (
    code === 'UNSUPPORTED_CONTENT_TYPE' ||
    /content type|does not appear to contain a web page/.test(message)
  )
    return {
      status: 'fetch_failed' as const,
      reason: 'Unsupported content type.',
    };
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|HOST_NOT_FOUND|DNS/.test(
      code,
    ) ||
    /resolve|dns|network/.test(message)
  )
    return {
      status: 'fetch_failed' as const,
      reason: 'Network or DNS failure.',
    };
  return {
    status: 'fetch_failed' as const,
    reason: 'Candidate page could not be fetched or processed.',
  };
}
export function unavailableResearch(
  reason: string,
  status: ResearchResult['status'] = 'unavailable',
): ResearchResult {
  return {
    enabled: true,
    status,
    summary: 'No independently matching public listings could be confirmed.',
    queriesAttempted: 0,
    candidatesDiscovered: 0,
    candidatesReviewed: 0,
    searchResults: [],
    independentSources: 0,
    sourceSummaries: [],
    comparisons: [],
    visualAnalysis: skippedVision(reason),
    evidenceSources: [],
    limitations: [
      reason,
      'Research does not verify ownership, authority to rent or property safety.',
    ],
    elapsedMs: 0,
    stages: [],
  };
}
export async function runResearch(
  sources: EvidenceSource[],
  facts: ExtractedFact[],
  progress: (stage: ResearchStage) => void = () => {},
  deps: ResearchDeps = {},
): Promise<ResearchResult> {
  if (env.DEEP_RESEARCH_ENABLED !== 'true')
    return unavailableResearch(
      'Deep Research is disabled on this server.',
      'skipped',
    );
  if (activeResearch >= env.DEEP_RESEARCH_MAX_ACTIVE)
    return unavailableResearch(
      'Research is busy. Standard verification is available.',
    );
  const started = performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signal?.addEventListener('abort', abort, { once: true });
  if (deps.signal?.aborted) abort();
  const result = unavailableResearch(
    'No credible external comparison listing was confirmed.',
    'partial',
  );
  result.limitations = [
    'Public advertisements are claims; signatures prove API issuance, not truth or ownership.',
  ];
  const stage = (next: ResearchStage) => {
    if (!controller.signal.aborted) {
      result.stages.push(next);
      progress(next);
      if (env.NODE_ENV === 'development') {
        const now = performance.now();
        console.info(
          '[deep-research-stage]',
          JSON.stringify({ stage: next, elapsedMs: Math.round(now - started) }),
        );
      }
    }
  };
  const search = deps.search ?? configuredSearch();
  const retrieve = deps.retrieve ?? retrievePublicPage;
  result.searchProvider = search.name;
  result.searchQueries = [];
  const source =
    sources.find((s) => s.type === 'listing_url') ??
    sources.find((s) => s.type === 'listing_text');
  if (source?.originalUrl) {
    const originalUrl = canonicalKey(source.originalUrl);
    result.sourceSummaries.push({
      id: source.id,
      url: originalUrl,
      title: source.name,
      domain: new URL(originalUrl).hostname,
      discoveryMethod: 'direct',
      provider: 'direct',
      retrievedAt:
        source.publicListing?.retrievedAt ?? new Date().toISOString(),
      availability:
        source.extractionStatus === 'complete' ? 'readable' : 'inaccessible',
      extractionMethod: 'public_html',
      contentDigest: null,
      identity: 'exact_listing',
      identityReasons: [
        'Original listing supplied for this scan; it is not independent corroboration.',
      ],
      independence: 'original',
      excerpt: '',
      source,
    });
  }
  if (!search.available) {
    result.status = 'search_unavailable';
    result.summary =
      'Broader public search is not configured. No external listings were searched.';
    result.limitations = [
      'Configure a permitted public SearXNG JSON endpoint to enable broader discovery.',
      'Research does not verify ownership, authority to rent or property safety.',
    ];
    result.visualAnalysis = skippedVision(
      'No external comparison listing can be discovered without a search provider.',
    );
    result.elapsedMs = Math.round(performance.now() - started);
    deps.signal?.removeEventListener('abort', abort);
    return result;
  }
  let timer: ReturnType<typeof setTimeout>;
  activeResearch++;
  const work = async () => {
    stage('checking');
    // Never build public queries from private conversations, agreements or uploaded documents.
    if (!source) {
      result.status = 'unavailable';
      result.limitations.push(
        'No public listing URL or manually entered listing details were available for research.',
      );
      return;
    }
    const original = profile(
      source,
      facts.filter((f) => f.sourceId === source.id),
    );
    const seen = new Set<string>();
    const digests = new Set<string>();
    const reviewedUrls = new Set(
      [original.canonicalUrl, source.originalUrl]
        .filter((url): url is string => Boolean(url))
        .map(canonicalKey),
    );
    const candidates: Array<
      SearchResult & { method: 'direct' | 'canonical' | 'search' }
    > = [];
    const searchResultIndexes = new Map<string, number>();
    const recordSearchResult = (hit: SearchResult) => {
      let url: string;
      try {
        url = canonicalKey(hit.url);
      } catch {
        return;
      }
      const records = result.searchResults ?? (result.searchResults = []);
      if (records.length >= 10) return;
      const index = records.length;
      const originalMatch = reviewedUrls.has(url);
      const duplicate = searchResultIndexes.has(url);
      records.push({
        url,
        domain: new URL(url).hostname,
        title: hit.title.slice(0, 200),
        snippet: hit.snippet.slice(0, 500),
        query: hit.query.slice(0, 500),
        status: originalMatch || duplicate ? 'rejected' : 'queued',
        classification: originalMatch ? 'original_listing' : 'unverifiable',
        ...(originalMatch
          ? {
              rejectionReason:
                'Original listing or canonical mirror; not independent corroboration.',
            }
          : duplicate
            ? { rejectionReason: 'Duplicate source URL.' }
            : {}),
      });
      if (originalMatch || duplicate) return;
      searchResultIndexes.set(url, index);
      add({ ...hit, url, method: 'search' });
    };
    const add = (
      item: SearchResult & { method: 'direct' | 'canonical' | 'search' },
    ) => {
      try {
        const key = canonicalKey(item.url);
        if (seen.has(key) || reviewedUrls.has(key)) return;
        seen.add(key);
        candidates.push({ ...item, url: key });
        result.candidatesDiscovered = candidates.filter(
          (c) => c.method === 'search',
        ).length;
      } catch {
        /* unsupported discovery hint */
      }
    };
    if (source.originalUrl)
      add({
        url: source.originalUrl,
        title: source.name,
        snippet: '',
        query: '',
        provider: 'direct',
        discoveredAt: new Date().toISOString(),
        method: 'direct',
      });
    const check = async (item: (typeof candidates)[number]) => {
      let include = true;
      const resultIndex = searchResultIndexes.get(item.url);
      const summary: ResearchResult['sourceSummaries'][number] = {
        id: `research-${stableId(item.url)}`,
        url: item.url,
        title: item.title,
        domain: new URL(item.url).hostname,
        discoveryMethod: item.method,
        provider: item.provider,
        retrievedAt: new Date().toISOString(),
        availability: 'inaccessible',
        extractionMethod: 'public_html',
        contentDigest: null,
        identity: 'insufficient_evidence',
        identityReasons: ['Page could not be independently read.'],
        independence: 'unverified',
        excerpt: '',
        ...(item.method === 'search'
          ? {
              searchMetadata: {
                snippet: item.snippet,
                query: item.query,
                discoveredAt: item.discoveredAt,
              },
            }
          : {}),
      };
      try {
        controller.signal.throwIfAborted();
        const candidateSignal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(
            deps.candidateTimeoutMs ?? env.DEEP_RESEARCH_CANDIDATE_TIMEOUT_MS,
          ),
        ]);
        const page: PublicPage = await retrieve(item.url, candidateSignal);
        controller.signal.throwIfAborted();
        const candidate = profile(page.source);
        const canonical = canonicalKey(candidate.canonicalUrl ?? item.url);
        if (reviewedUrls.has(canonical)) {
          include = false;
          if (resultIndex !== undefined && result.searchResults?.[resultIndex])
            Object.assign(result.searchResults[resultIndex]!, {
              status: 'rejected',
              rejectionReason:
                'Fetched page resolves to the original listing or its canonical mirror.',
              classification: 'original_listing',
            });
          return;
        }
        reviewedUrls.add(canonical);
        const identity = matchProperty(original, candidate);
        const originalDomain = original.canonicalUrl
          ? publicDomain(original.canonicalUrl)
          : null;
        const duplicateText = page.digest && digests.has(page.digest);
        const copiedPhrase = original.description
          .split(/[\n.!?]/)
          .some(
            (s) =>
              s.trim().length >= 80 && candidate.description.includes(s.trim()),
          );
        if (page.digest) digests.add(page.digest);
        const independence =
          item.method !== 'search'
            ? 'original'
            : originalDomain === publicDomain(item.url) ||
                duplicateText ||
                copiedPhrase
              ? 'derived'
              : 'unverified';
        Object.assign(summary, {
          id: page.source.id,
          title: page.source.name,
          retrievedAt:
            page.source.publicListing?.retrievedAt ?? summary.retrievedAt,
          url: page.source.originalUrl ?? item.url,
          availability: 'readable',
          contentDigest: page.digest,
          identity: identity.identity,
          identityReasons: identity.reasons,
          independence,
          excerpt: (page.source.extractedText ?? '').slice(0, 2000),
          source: page.source,
        });
        if (resultIndex !== undefined && result.searchResults?.[resultIndex]) {
          Object.assign(result.searchResults[resultIndex]!, {
            status: 'reviewed',
            identity: identity.identity,
            classification:
              original.unit &&
              candidate.unit &&
              original.unit.trim().toLocaleLowerCase() !==
                candidate.unit.trim().toLocaleLowerCase() &&
              identity.identity === 'same_building_or_development'
                ? 'same_building_different_unit'
                : identity.identity === 'exact_listing' ||
                    identity.identity === 'likely_same_property'
                  ? 'possible_same_unit'
                  : identity.identity === 'unrelated'
                    ? 'unrelated_listing'
                    : 'unverifiable',
          });
        }
        if (item.method === 'direct') {
          if (!original.images.length) original.images = candidate.images;
          if (!original.listingId) original.listingId = candidate.listingId;
          if (
            candidate.canonicalUrl &&
            new URL(candidate.canonicalUrl).origin === new URL(item.url).origin
          )
            add({ ...item, url: candidate.canonicalUrl, method: 'canonical' });
        } else {
          const comparisons = compareProfiles(
            original,
            candidate,
            identity.identity,
          );
          result.comparisons.push(...comparisons);
          // Feed only explicit, physical claim differences for strong property matches into existing rules.
          // Reposts, missing facts, prices and Vision never independently enable scoring.
          const fields = new Set(
            comparisons
              .filter(
                (c) =>
                  c.status === 'confirmed_inconsistency' &&
                  ['bedroomCount', 'bathroomCount', 'propertyType'].includes(
                    c.field,
                  ),
              )
              .map((c) => c.field),
          );
          if (
            independence === 'unverified' &&
            !sources.some((s) => s.id === page.source.id) &&
            !result.evidenceSources.some((s) => s.id === page.source.id) &&
            fields.size &&
            result.evidenceSources.length < Math.max(0, 20 - sources.length)
          ) {
            const selected = candidate.facts.filter(
              (f) =>
                fields.has(f.fieldName) ||
                ['listingTitle', 'address', 'location'].includes(f.fieldName),
            );
            result.evidenceSources.push(
              sealEvidenceSource({
                ...page.source,
                extractedText: [
                  ...new Set(selected.map((f) => f.quotedEvidence)),
                ].join('\n'),
                normalizedFacts: selected,
                publicListing: {
                  ...page.source.publicListing!,
                  fieldComparisonOnly: true,
                },
              }),
            );
          }
          return { candidate, identity: identity.identity, independence };
        }
        if (page.digest) digests.add(page.digest);
      } catch (error) {
        const failure = classifyCandidateFetchFailure(
          error,
          controller.signal.aborted,
        );
        if (resultIndex !== undefined && result.searchResults?.[resultIndex])
          Object.assign(result.searchResults[resultIndex]!, {
            status: failure.status,
            rejectionReason: failure.reason,
          });
        if (controller.signal.aborted) return;
        result.limitations.push(
          'A discovered public page was inaccessible, restricted, or could not be safely retrieved.',
        );
      } finally {
        if (include) result.sourceSummaries.push(summary);
      }
    };
    if (search.available) {
      const queries = buildQueries(original).slice(
        0,
        search.name === 'openai' ? 1 : env.DEEP_RESEARCH_MAX_QUERIES,
      );
      result.searchQueries = queries.map((query) => ({
        query,
        provider: search.name,
        status: 'planned',
        candidatesReturned: 0,
        referencesReturned: 0,
      }));
      if (queries.length) stage('searching');
      else
        result.limitations.push(
          'The listing did not contain a distinctive, privacy-safe public search query.',
        );
      for (const [queryIndex, query] of queries.entries()) {
        controller.signal.throwIfAborted();
        result.queriesAttempted++;
        const queryRecord = result.searchQueries[queryIndex]!;
        try {
          const hits = await search.search(query, controller.signal);
          if (search.usage) result.searchUsage = search.usage;
          queryRecord.status = 'attempted';
          queryRecord.candidatesReturned = hits.length;
          queryRecord.referencesReturned =
            search.resultCounts?.referencesReturned ?? hits.length;
          for (const hit of hits) recordSearchResult(hit);
        } catch (error) {
          if (search.usage) result.searchUsage = search.usage;
          const message = error instanceof Error ? error.message : '';
          result.status = /429|rate.?limit/i.test(message)
            ? 'rate_limited'
            : /timeout|timed out|aborted/i.test(message)
              ? 'timed_out'
              : 'provider_error';
          result.limitations.push(
            result.status === 'rate_limited'
              ? 'The public search provider rate-limited this scan.'
              : result.status === 'timed_out'
                ? 'The search request timed out; standard verification was preserved.'
                : 'The public search provider returned an error; standard verification was preserved.',
          );
          queryRecord.status = 'failed';
          queryRecord.error =
            result.status === 'rate_limited'
              ? 'Provider rate limit'
              : message.slice(0, 120) || 'Provider request failed';
          if (result.status === 'rate_limited' || result.status === 'timed_out')
            break;
        }
      }
    } else
      result.limitations.push(
        search.unavailableReason ??
          'Broader web discovery is not configured. Only the supplied public URL and its canonical link can be checked.',
      );
    controller.signal.throwIfAborted();
    const reviewLimit =
      search.name === 'openai'
        ? Math.min(3, env.DEEP_RESEARCH_MAX_CANDIDATES)
        : env.DEEP_RESEARCH_MAX_CANDIDATES;
    const review = candidates
      .filter((c) => c.method === 'search')
      .slice(0, reviewLimit);
    for (const candidate of candidates
      .filter((item) => item.method === 'search')
      .slice(reviewLimit)) {
      const index = searchResultIndexes.get(candidate.url);
      if (index !== undefined && result.searchResults?.[index])
        Object.assign(result.searchResults[index]!, {
          status: 'not_reviewed',
          rejectionReason: 'Candidate review limit reached.',
        });
    }
    result.candidatesDiscovered = candidates.filter(
      (c) => c.method === 'search',
    ).length;
    if (review.length) stage('comparing');
    const matches: Awaited<ReturnType<typeof check>>[] = [];
    let cursor = 0;
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            search.name === 'openai' ? 2 : env.DEEP_RESEARCH_CONCURRENCY,
            review.length,
          ),
        },
        async () => {
          while (cursor < review.length && !controller.signal.aborted) {
            const next = review[cursor++]!;
            matches.push(await check(next));
          }
        },
      ),
    );
    controller.signal.throwIfAborted();
    const eligible = matches
      .filter((m): m is NonNullable<typeof m> =>
        Boolean(
          m &&
          ['exact_listing', 'likely_same_property'].includes(m.identity) &&
          m.candidate.images.length,
        ),
      )
      .slice(0, 2);
    if (eligible[0])
      result.visualAnalysis = await (deps.vision ?? compareImages)(
        original,
        eligible[0].candidate,
        controller.signal,
        stage,
      );
    else if (
      matches.some(
        (m) =>
          m && ['exact_listing', 'likely_same_property'].includes(m.identity),
      )
    )
      result.visualAnalysis = skippedVision(
        'A potentially matching listing was reviewed, but it did not provide usable public photos.',
      );
    result.candidatesReviewed = (result.searchResults ?? []).filter(
      (item) => item.status === 'reviewed',
    ).length;
    // Different publishers do not by themselves establish independent evidence. Keep independence unverified.
    result.independentSources = 0;
    const strong = result.sourceSummaries.filter(
      (s) =>
        s.discoveryMethod === 'search' &&
        s.availability === 'readable' &&
        ['exact_listing', 'likely_same_property'].includes(s.identity),
    );
    result.matchingCandidates = strong.length;
    result.summary = strong.length
      ? `Reviewed ${result.candidatesReviewed} public candidate source${result.candidatesReviewed === 1 ? '' : 's'} and found ${strong.length} strongly matching listing${strong.length === 1 ? '' : 's'}. ${result.comparisons.some((c) => c.status === 'confirmed_inconsistency') ? 'Review the cited claim differences.' : 'No additional inconsistencies were confirmed in the sources reviewed.'}`
      : review.length && result.candidatesReviewed === 0
        ? 'Search found public source URLs, but no candidate page could be independently fetched and validated.'
        : result.searchResults?.length
          ? 'Search found public source URLs, but no independently matching listing could be confirmed.'
          : 'Search completed without verifiable public source URLs.';
    stage('preparing');
    if (
      !['provider_error', 'rate_limited', 'timed_out'].includes(result.status)
    )
      result.status =
        search.available &&
        result.queriesAttempted > 0 &&
        result.candidatesDiscovered > 0 &&
        Boolean(result.searchResults?.length) &&
        !result.searchResults?.some((item) =>
          ['fetch_failed', 'timed_out', 'not_reviewed'].includes(item.status),
        )
          ? 'completed'
          : 'partial';
    if (
      !result.sourceSummaries.some((s) => s.availability === 'readable') &&
      !result.queriesAttempted
    )
      result.status = 'unavailable';
  };
  const task = work().finally(() => {
    activeResearch--;
  });
  try {
    await Promise.race([
      task,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          for (const item of result.searchResults ?? []) {
            if (item.status === 'queued')
              Object.assign(item, {
                status: 'not_reviewed',
                rejectionReason:
                  'Research deadline expired before candidate review completed.',
              });
          }
          reject(new Error('deadline'));
        }, deps.timeoutMs ?? env.DEEP_RESEARCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    const searchSucceeded = result.searchQueries?.some(
      (query) => query.status === 'attempted',
    );
    result.status = deps.signal?.aborted
      ? 'cancelled'
      : controller.signal.aborted
        ? searchSucceeded
          ? 'partial'
          : 'timed_out'
        : 'partial';
    result.summary =
      result.status === 'cancelled'
        ? 'Research was cancelled. Standard verification is available.'
        : result.status === 'timed_out'
          ? 'Research reached its time limit. Results collected before the timeout are shown.'
          : result.status === 'partial' && searchSucceeded
            ? 'Search completed, but candidate review reached the time limit. Results collected so far are shown.'
            : 'Research could not finish. Standard verification is available.';
    result.limitations.push(
      result.status === 'cancelled'
        ? 'Research was cancelled; standard verification was retained.'
        : 'Research reached its time limit; results collected before the deadline were retained.',
    );
    for (const item of result.searchResults ?? []) {
      if (item.status === 'queued')
        Object.assign(item, {
          status: 'not_reviewed',
          rejectionReason: 'Research deadline expired before candidate review.',
        });
    }
  } finally {
    clearTimeout(timer!);
    controller.abort();
    deps.signal?.removeEventListener('abort', abort);
  }
  result.candidatesReviewed = (result.searchResults ?? []).filter(
    (item) => item.status === 'reviewed',
  ).length;
  if (result.status === 'rate_limited')
    result.summary =
      'Public search was rate-limited. Any results collected before the limit are shown.';
  else if (result.status === 'provider_error')
    result.summary =
      'The public search provider could not complete this scan. Any results collected are shown.';
  else if (
    result.status === 'partial' &&
    result.queriesAttempted > 0 &&
    result.searchQueries?.some((query) => query.status === 'attempted')
  )
    result.summary =
      result.candidatesDiscovered > 0 && result.candidatesReviewed === 0
        ? 'Search completed, but no candidate page could be independently fetched and validated.'
        : 'Search completed with partial results. The available sources and their review status are shown.';
  else if (
    result.status === 'partial' &&
    result.queriesAttempted === 0 &&
    result.sourceSummaries.length === 0
  )
    result.summary =
      'No privacy-safe search query could be generated from the supplied listing.';
  result.limitations = [...new Set(result.limitations)];
  result.elapsedMs = Math.round(performance.now() - started);
  return structuredClone(result);
}

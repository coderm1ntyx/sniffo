import { z } from 'zod';
import { getDomain } from 'tldts';
import { env } from '../../config/env.js';
import { extractListingUrl, readPage } from '../extraction.js';
import { sealEvidenceSource } from '../sourceSignature.js';
import { ResearchCache, canonicalKey, fingerprint } from './cache.js';
import { EvidenceSourceSchema, type EvidenceSource } from '@sniffo/shared';
import { stableId } from '../evidenceIntegrity.js';

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  provider: string;
  query: string;
  discoveredAt: string;
};
export interface SearchProvider {
  available: boolean;
  name: string;
  unavailableReason?: string;
  resultCounts?: {
    referencesReturned: number;
    uniqueUrlsReturned: number;
    cacheHit: boolean;
  };
  usage?: {
    model: string;
    tool: 'web_search';
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    cacheHit?: boolean;
  };
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
}
const searches = new ResearchCache<SearchResult[]>(300_000);
const openAISearches = new ResearchCache<{
  results: SearchResult[];
  referencesReturned: number;
}>(300_000);
const robots = new ResearchCache<string>(300_000);
export const publicDomain = (url: string) =>
  getDomain(new URL(url).hostname) ?? new URL(url).hostname;
export function robotsAllowed(text: string, path: string): boolean {
  if (path.length > 8192 || text.length > 32000) return false;
  const groups: Array<{
    agents: string[];
    rules: Array<{ allow: boolean; path: string }>;
  }> = [];
  let group = {
    agents: [] as string[],
    rules: [] as Array<{ allow: boolean; path: string }>,
  };
  let readingRules = false;
  for (const line of text.split(/\r?\n/)) {
    const m = line
      .replace(/#.*$/, '')
      .trim()
      .match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase(),
      value = m[2]!.trim();
    if (key === 'user-agent') {
      if (readingRules) {
        groups.push(group);
        group = { agents: [], rules: [] };
        readingRules = false;
      }
      if (value) group.agents.push(value.toLowerCase());
    } else {
      readingRules = true;
      if (value && group.agents.length)
        group.rules.push({ allow: key === 'allow', path: value });
    }
  }
  groups.push(group);
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && 'snifforentalcheck/1.0'.startsWith(a)),
  );
  const applicable = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);
  if (rules.length > 500 || rules.some((r) => r.path.length > 2048))
    return false;
  const globMatches = (pattern: string, target: string) => {
    const end = pattern.endsWith('$');
    const parts = (end ? pattern.slice(0, -1) : pattern).split('*');
    if (!target.startsWith(parts[0]!)) return false;
    let cursor = parts[0]!.length;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      const at =
        end && i === parts.length - 1
          ? target.length - part.length
          : target.indexOf(part, cursor);
      if (at < cursor || !target.startsWith(part, at)) return false;
      cursor = at + part.length;
    }
    return !end || cursor === target.length;
  };
  const matching = rules
    .filter((r) => globMatches(r.path, path))
    .sort(
      (a, b) =>
        b.path.replace(/[*$]/g, '').length -
          a.path.replace(/[*$]/g, '').length ||
        Number(b.allow) - Number(a.allow),
    );
  return matching[0]?.allow ?? true;
}
async function respectRobots(url: URL, signal: AbortSignal, deadline: number) {
  const key = url.origin;
  let text = robots.get(key);
  if (text === undefined) {
    try {
      text = (
        await readPage(
          new URL('/robots.txt', url),
          0,
          undefined,
          deadline,
          signal,
          { contentTypes: ['text/plain', 'text/html'], maxBytes: 32_000 },
        )
      ).body;
      robots.set(key, text);
    } catch (error) {
      if (error instanceof Error && /HTTP 404|HTTP 410/.test(error.message))
        text = '';
      else throw new Error('Public access policy could not be checked.');
    }
  }
  if (!robotsAllowed(text, url.pathname + url.search))
    throw new Error('This page disallows automated research.');
}
export async function readPublicResource(
  url: string,
  signal: AbortSignal,
  contentTypes = ['text/html', 'application/xhtml+xml', 'text/plain'],
  maxBytes = 1_000_000,
) {
  const deadline =
    performance.now() + Math.min(env.DEEP_RESEARCH_TIMEOUT_MS, 6000);
  return readPage(new URL(url), 0, undefined, deadline, signal, {
    contentTypes,
    maxBytes,
    beforeRequest: (next) => respectRobots(next, signal, deadline),
  });
}
export function configuredSearch(
  settings: {
    provider: 'none' | 'searxng' | 'openai';
    endpoint?: string;
    openaiEnabled?: boolean;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
  } = {
    provider: env.DEEP_RESEARCH_SEARCH_PROVIDER,
    endpoint: env.DEEP_RESEARCH_SEARCH_URL,
    openaiEnabled: env.DEEP_RESEARCH_OPENAI_WEB_SEARCH_ENABLED === 'true',
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    timeoutMs: env.DEEP_RESEARCH_OPENAI_SEARCH_TIMEOUT_MS,
  },
  transport: typeof readPage = readPage,
  request: typeof fetch = fetch,
): SearchProvider {
  if (settings.provider === 'openai') {
    const enabled = settings.openaiEnabled === true;
    const apiKey = settings.apiKey?.trim();
    const model = settings.model?.trim() || 'gpt-4.1-mini';
    const timeoutMs =
      settings.timeoutMs ?? env.DEEP_RESEARCH_OPENAI_SEARCH_TIMEOUT_MS;
    let used = false;
    const available = Boolean(enabled && apiKey);
    return {
      available,
      name: 'openai',
      ...(!available
        ? {
            unavailableReason: enabled
              ? 'OpenAI web search was not attempted because the server API key is not configured.'
              : 'OpenAI web search is disabled by server configuration.',
          }
        : {}),
      async search(query, signal) {
        if (!available)
          throw new Error(
            enabled
              ? 'OpenAI web search is unavailable because the server API key is not configured.'
              : 'OpenAI web search is disabled by server configuration.',
          );
        if (used) throw new Error('OpenAI web search request limit reached.');
        used = true;
        const cacheKey = fingerprint(['openai', model, query]);
        const cached = openAISearches.get(cacheKey);
        if (cached) {
          this.resultCounts = {
            referencesReturned: cached.referencesReturned,
            uniqueUrlsReturned: cached.results.length,
            cacheHit: true,
          };
          this.usage = {
            model,
            tool: 'web_search',
            latencyMs: 0,
            estimatedCostUsd: 0,
            cacheHit: true,
          };
          return cached.results;
        }
        const started = performance.now();
        let response: Response;
        try {
          response = await request('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              input: `Search the public web for listings matching this property: ${query}. Return only public source results with their source titles and concise relevant snippets. Do not infer ownership or claim any listing is the same unit.`,
              tools: [{ type: 'web_search' }],
              tool_choice: 'required',
              include: [
                'web_search_call.action.sources',
                'web_search_call.results',
              ],
              max_output_tokens: 300,
            }),
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          });
        } catch (error) {
          if (error instanceof Error && error.name === 'TimeoutError')
            throw new Error('OpenAI web search timed out.');
          throw error;
        }
        const latencyMs = Math.round(performance.now() - started);
        const raw = await response.text();
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new Error(
            `OpenAI web search returned HTTP ${response.status} with an invalid response.`,
          );
        }
        if (!response.ok) {
          const error = payload.error as
            { message?: unknown; code?: unknown } | undefined;
          const detail =
            typeof error?.message === 'string'
              ? error.message.slice(0, 90)
              : typeof error?.code === 'string'
                ? error.code.slice(0, 90)
                : 'request rejected';
          throw new Error(
            `OpenAI web search HTTP ${response.status}: ${detail}`,
          );
        }
        const usage = payload.usage as
          | {
              input_tokens?: unknown;
              output_tokens?: unknown;
              total_tokens?: unknown;
            }
          | undefined;
        const inputTokens =
          typeof usage?.input_tokens === 'number'
            ? usage.input_tokens
            : undefined;
        const outputTokens =
          typeof usage?.output_tokens === 'number'
            ? usage.output_tokens
            : undefined;
        const totalTokens =
          typeof usage?.total_tokens === 'number'
            ? usage.total_tokens
            : undefined;
        // The current web-search price includes a fixed 8,000 input-token block
        // for gpt-4.1-mini, plus its standard input/output token rates.
        const estimatedCostUsd =
          model === 'gpt-4.1-mini' && outputTokens !== undefined
            ? 0.01 +
              (Math.max(inputTokens ?? 0, 8000) * 0.4 + outputTokens * 1.6) /
                1_000_000
            : undefined;
        this.usage = {
          model,
          tool: 'web_search',
          latencyMs,
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(totalTokens !== undefined ? { totalTokens } : {}),
          ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
        };
        const output = Array.isArray(payload.output) ? payload.output : [];
        const sourceReferences: Array<{
          url: string;
          title: string;
          content: string;
        }> = [];
        const pushReference = (reference: unknown) => {
          if (!reference || typeof reference !== 'object') return;
          const record = reference as Record<string, unknown>;
          if (typeof record.url !== 'string') return;
          sourceReferences.push({
            url: record.url,
            title:
              typeof record.title === 'string'
                ? record.title.slice(0, 200)
                : 'Public source',
            content:
              typeof record.snippet === 'string'
                ? record.snippet.slice(0, 500)
                : typeof record.content === 'string'
                  ? record.content.slice(0, 500)
                  : typeof record.description === 'string'
                    ? record.description.slice(0, 500)
                    : '',
          });
        };
        const flattenReferences = (value: unknown) => {
          if (Array.isArray(value)) value.forEach(flattenReferences);
          else pushReference(value);
        };
        const searchCalls = output.filter(
          (item) =>
            Boolean(item) &&
            typeof item === 'object' &&
            (item as Record<string, unknown>).type === 'web_search_call',
        );
        for (const item of searchCalls) {
          const record = item as Record<string, unknown>;
          const action = record.action as Record<string, unknown> | undefined;
          if (action?.type === 'search') flattenReferences(action.sources);
          flattenReferences(record.results);
        }
        const citations = output.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          if (record.type !== 'message' || !Array.isArray(record.content))
            return [];
          return record.content.flatMap((content) => {
            if (!content || typeof content !== 'object') return [];
            const annotations = (content as Record<string, unknown>)
              .annotations;
            if (!Array.isArray(annotations)) return [];
            return annotations.flatMap((annotation) => {
              if (!annotation || typeof annotation !== 'object') return [];
              const citation = annotation as Record<string, unknown>;
              if (citation.type !== 'url_citation') return [];
              const citationData =
                citation.url_citation &&
                typeof citation.url_citation === 'object'
                  ? (citation.url_citation as Record<string, unknown>)
                  : citation;
              if (
                typeof citationData.url !== 'string' ||
                !/^https?:\/\//i.test(citationData.url)
              )
                return [];
              const textValue = (content as Record<string, unknown>).text;
              const text = typeof textValue === 'string' ? textValue : '';
              const start = citationData.start_index;
              const end = citationData.end_index;
              const snippet =
                typeof start === 'number' && typeof end === 'number'
                  ? text.slice(
                      Math.max(0, start - 160),
                      Math.min(text.length, end + 160),
                    )
                  : '';
              return [
                {
                  url: citationData.url,
                  title:
                    typeof citationData.title === 'string'
                      ? citationData.title
                      : 'Public source',
                  content: snippet,
                },
              ];
            });
          });
        });
        if (
          !searchCalls.some((item) => {
            const action = (item as Record<string, unknown>).action;
            return (
              Boolean(action) &&
              typeof action === 'object' &&
              (action as Record<string, unknown>).type === 'search'
            );
          })
        )
          throw new Error(
            'OpenAI Responses returned without a completed web search call or verifiable source citations.',
          );
        const references = [...sourceReferences, ...citations];
        const merged = new Map<string, SearchResult>();
        for (const reference of references) {
          const normalized = normalizeSearchResults(
            [
              {
                url: reference.url,
                title: reference.title,
                content: reference.content,
              },
            ],
            query,
            'openai',
          )[0];
          if (!normalized) continue;
          const previous = merged.get(normalized.url);
          if (!previous) merged.set(normalized.url, normalized);
          else
            merged.set(normalized.url, {
              ...previous,
              title:
                previous.title === 'Public source' &&
                normalized.title !== 'Public source'
                  ? normalized.title
                  : previous.title,
              snippet: previous.snippet || normalized.snippet,
            });
        }
        const results = [...merged.values()].slice(0, 10);
        this.resultCounts = {
          referencesReturned: references.length,
          uniqueUrlsReturned: results.length,
          cacheHit: false,
        };
        openAISearches.set(cacheKey, {
          results,
          referencesReturned: references.length,
        });
        return results;
      },
    };
  }
  const endpoint =
    settings.provider === 'searxng' ? settings.endpoint : undefined;
  return {
    available: Boolean(endpoint),
    name: endpoint ? 'searxng' : 'none',
    async search(query, signal) {
      if (!endpoint) return [];
      const key = fingerprint([endpoint, query]);
      const cached = searches.get(key);
      if (cached) return cached;
      const url = new URL('/search', endpoint);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      const page = await transport(
        url,
        0,
        undefined,
        performance.now() + 4000,
        signal,
        { contentTypes: ['application/json'], maxBytes: 200_000 },
      );
      const data = z
        .object({
          results: z
            .array(
              z.object({
                url: z.string().url(),
                title: z.string().max(500).default('Public listing'),
                content: z.string().max(2000).default(''),
              }),
            )
            .max(100),
        })
        .parse(JSON.parse(page.body));
      const results = normalizeSearchResults(data.results, query, 'searxng');
      searches.set(key, results);
      return results;
    },
  };
}
export function normalizeSearchResults(
  results: Array<{ url: string; title: string; content?: string }>,
  query: string,
  provider: string,
): SearchResult[] {
  const seen = new Set<string>();
  return results
    .flatMap((result) => {
      try {
        const key = canonicalKey(result.url);
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            url: key,
            title: result.title.slice(0, 200),
            snippet: (result.content ?? '').slice(0, 500),
            query,
            provider,
            discoveredAt: new Date().toISOString(),
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 5);
}
export function attachPublicListing(
  data: Awaited<ReturnType<typeof extractListingUrl>>,
) {
  const original = data.source.originalUrl;
  const canonical =
    data.canonicalUrl &&
    original &&
    new URL(data.canonicalUrl).origin === new URL(original).origin
      ? data.canonicalUrl
      : original;
  return {
    ...data,
    source: sealEvidenceSource({
      ...data.source,
      normalizedFacts: data.facts,
      publicListing: {
        canonicalUrl: canonical,
        listingId: data.listingId ?? null,
        images: [...new Set(data.images ?? [])].slice(0, 12),
        retrievedAt: new Date().toISOString(),
      },
    }),
  };
}
export type PublicPage = { source: EvidenceSource; digest: string };
const pages = new ResearchCache<PublicPage>(60_000);
export async function retrievePublicPage(
  url: string,
  signal: AbortSignal,
): Promise<PublicPage> {
  const key = canonicalKey(url);
  const cached = pages.get(key);
  if (cached) return cached;
  let digest = '';
  const data = await extractListingUrl(url, {
    signal,
    budgetMs: 6000,
    fetchPage: async (requested) => {
      const result = await readPublicResource(requested.href, signal);
      digest = fingerprint(result.body);
      return result;
    },
  });
  const issued = attachPublicListing(data).source;
  const id = `public-${stableId(canonicalKey(issued.publicListing?.canonicalUrl ?? url), canonicalKey(url))}`;
  const source = sealEvidenceSource({
    ...issued,
    id,
    normalizedFacts: issued.normalizedFacts?.map((f) => ({
      ...f,
      sourceId: id,
      id: `fact-${stableId(id, f.fieldName, f.normalizedValue, f.quotedEvidence)}`,
    })),
  });
  EvidenceSourceSchema.parse(source);
  const result = { source, digest };
  pages.set(key, result);
  return result;
}

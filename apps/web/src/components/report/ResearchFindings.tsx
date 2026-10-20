import * as React from 'react';
import type { ResearchResult } from '@sniffo/shared';
import { safeSourceUrl } from './reportPresentation';

void React;

function platformName(domain: string) {
  const host = domain.toLowerCase().replace(/^www\./, '');
  if (host.endsWith('booking.com')) return 'Booking.com';
  if (host.endsWith('rentbyowner.com')) return 'RentByOwner';
  if (host.endsWith('vrbo.com')) return 'Vrbo';
  if (host.includes('airbnb.')) return 'Airbnb';
  return domain.replace(/^www\./i, '');
}

function propertyIdentifier(urlValue: string) {
  try {
    const url = new URL(urlValue);
    if (url.hostname.toLowerCase().endsWith('vrbo.com')) {
      const id = url.pathname.match(/(?:^|\/)p(\d+)(?:vb)?(?:\/|$)/i)?.[1];
      if (id) return `vrbo:${id}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function selectAdvertisements(research: ResearchResult) {
  if (research.searchProvider !== 'openai') return [];
  const originalAirbnb = new Set(
    research.sourceSummaries
      .filter((source) => source.discoveryMethod === 'direct')
      .map((source) => {
        try {
          return new URL(source.url).pathname.match(/\/rooms\/(\d+)/)?.[1];
        } catch {
          return undefined;
        }
      })
      .filter((id): id is string => Boolean(id)),
  );
  const eligible = (research.searchResults ?? [])
    .filter(
      (item) =>
        item.classification !== 'original_listing' &&
        item.classification !== 'unrelated_listing' &&
        item.identity !== 'exact_listing' &&
        item.identity !== 'unrelated' &&
        !(
          item.domain.toLowerCase().includes('airbnb.') &&
          originalAirbnb.has(
            (() => {
              try {
                return (
                  new URL(item.url).pathname.match(/\/rooms\/(\d+)/)?.[1] ?? ''
                );
              } catch {
                return '';
              }
            })(),
          )
        ),
    )
    .filter((item) => safeSourceUrl(item.url));

  const seenUrls = new Set<string>();
  const seenProperties = new Set<string>();
  const unique = eligible.filter((item) => {
    const url = safeSourceUrl(item.url)!;
    const property = propertyIdentifier(url);
    if (seenUrls.has(url) || (property && seenProperties.has(property)))
      return false;
    seenUrls.add(url);
    if (property) seenProperties.add(property);
    return true;
  });
  const selected: typeof unique = [];
  const platforms = new Set<string>();
  for (const item of unique) {
    const platform = platformName(item.domain);
    if (platforms.has(platform)) continue;
    selected.push(item);
    platforms.add(platform);
    if (selected.length === 3) return selected;
  }
  for (const item of unique) {
    if (selected.includes(item)) continue;
    selected.push(item);
    if (selected.length === 3) break;
  }
  return selected;
}

export function ResearchFindings({ research }: { research?: ResearchResult }) {
  if (!research?.enabled) return null;
  const advertisements = selectAdvertisements(research);
  const status =
    research.status === 'completed'
      ? 'Research completed'
      : research.status === 'partial'
        ? 'Partial results'
        : 'Research unavailable';
  return (
    <section className="research-findings" aria-labelledby="research-title">
      <div className="report-section-heading">
        <h2 id="research-title">Other advertisements discovered</h2>
        <span>{status}</span>
      </div>
      {advertisements.length ? (
        <ul className="research-advertisements">
          {advertisements.map((item) => (
            <li key={item.url}>
              <strong>{platformName(item.domain)}</strong>
              <span>{item.title || 'Public listing'}</span>
              <a
                href={safeSourceUrl(item.url)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source listing ↗
              </a>
              <small>Search result · not independently verified</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>No additional advertisements were discovered.</p>
      )}
    </section>
  );
}

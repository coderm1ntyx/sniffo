import { createHash } from 'node:crypto';

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Bounded process-local caches contain only public pages/search metadata and visual descriptions.
export class ResearchCache<T> {
  private entries = new Map<string, { expires: number; value: T }>();
  constructor(
    private ttlMs: number,
    private limit = 100,
  ) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    if (item.expires <= Date.now()) {
      this.entries.delete(key);
      return;
    }
    return structuredClone(item.value);
  }
  set(key: string, value: T) {
    if (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, {
      expires: Date.now() + this.ttlMs,
      value: structuredClone(value),
    });
  }
}
export function canonicalKey(input: string): string {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Unsupported URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}

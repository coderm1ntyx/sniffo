import type { RequestHandler } from 'express';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  now?: () => number;
};

type RateLimitBucket = { count: number; resetAt: number };

const MAX_BUCKETS = 5_000;

export function createRateLimiter({
  windowMs,
  max,
  now = Date.now,
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();

  return (req, res, next) => {
    const currentTime = now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime)
      bucket = { count: 0, resetAt: currentTime + windowMs };
    bucket.count += 1;

    // Keep the map bounded even if a caller can reach the API from many source IPs.
    buckets.delete(key);
    buckets.set(key, bucket);
    if (buckets.size > MAX_BUCKETS) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= currentTime || buckets.size > MAX_BUCKETS)
          buckets.delete(candidate);
      }
    }

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - currentTime) / 1000),
    );
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
        },
      });
      return;
    }
    next();
  };
}

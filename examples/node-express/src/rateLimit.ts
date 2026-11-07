/**
 * Minimal sliding-window rate limiter.
 *
 * Replace with Redis (`INCR` + `EXPIRE`) for multi-instance production use so
 * limits hold across processes.
 */
const buckets = new Map<string, number[]>();

export function check(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }

  timestamps.push(now);
  buckets.set(key, timestamps);
  return { ok: true, retryAfter: 0 };
}

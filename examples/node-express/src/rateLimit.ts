/**
 * Minimal sliding-window rate limiter with separated check/record primitives.
 *
 * Replace with Redis (`INCR` + `EXPIRE`) for multi-instance production use so
 * limits hold across processes.
 *
 * Note: use a consistent `windowMs` for a given `key`.
 */
const buckets = new Map<string, number[]>();

function prune(key: string, windowMs: number): number[] {
  const now = Date.now();
  const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (times.length === 0) {
    buckets.delete(key); // evict empty buckets so memory stays bounded
  } else {
    buckets.set(key, times);
  }
  return times;
}

/** Check whether a key is over its limit, without recording a hit. */
export function tooMany(
  key: string,
  limit: number,
  windowMs: number,
): { limited: boolean; retryAfter: number } {
  const times = prune(key, windowMs);
  if (times.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - Date.now()) / 1000));
    return { limited: true, retryAfter };
  }
  return { limited: false, retryAfter: 0 };
}

/** Record a hit for a key. */
export function hit(key: string, windowMs: number): void {
  const times = prune(key, windowMs);
  times.push(Date.now());
  buckets.set(key, times);
}

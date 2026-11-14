/**
 * Request metadata for the device/session log: IP, a human device label, and a
 * **coarse** location.
 *
 * Location is deliberately coarse (country, or country + region) and resolved
 * locally by default. We do not ship a silent third-party GeoIP call: sending
 * every user's IP to an external service is a privacy decision that belongs to
 * the app owner, not to a helper function. Wire a resolver (MaxMind local
 * database, Cloudflare country header, your CDN) with `setLocationResolver`.
 */

import type { Request } from 'express';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string;
  location: string | null;
}

export type LocationResolver = (ip: string, req?: Request) => string | null;

let resolver: LocationResolver | null = null;

export function setLocationResolver(fn: LocationResolver | null): void {
  resolver = fn;
}

/** RFC 1918 / loopback / link-local ranges. */
export function isPrivateIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '::1' || clean === '127.0.0.1' || clean === 'localhost') return true;
  if (/^10\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(clean)) return true;
  if (/^169\.254\./.test(clean)) return true;
  if (/^f[cd]/i.test(clean)) return true;
  if (/^fe80:/i.test(clean)) return true;
  return false;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android.*Mobile|Mobile.*Android/, 'Android phone'],
  [/Android/, 'Android tablet'],
  [/CrOS/, 'Chromebook'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

/** "Chrome on Mac", "Safari on iPhone", "Unknown device". */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(userAgent))?.[1];
  if (browser && platform) return `${browser} on ${platform}`;
  if (platform) return platform;
  if (browser) return browser;
  return 'Unknown device';
}

/** Country from a CDN header, when the deployment provides one. */
function countryFromHeaders(req?: Request): string | null {
  if (!req) return null;
  const headers = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'];
  for (const name of headers) {
    const value = req.get(name);
    if (value && value !== 'XX' && value !== 'T1') return value.toUpperCase();
  }
  return null;
}

export function resolveLocation(ip: string | null, req?: Request): string | null {
  if (resolver) {
    const custom = resolver(ip ?? '', req);
    if (custom) return custom;
  }
  if (!ip) return null;
  if (isPrivateIp(ip)) return 'Local network';
  return countryFromHeaders(req) ?? 'Unknown';
}

export function requestMeta(req: Request): RequestMeta {
  const ip = req.ip ?? null;
  const ua = req.get('user-agent') ?? null;
  return {
    ip,
    userAgent: ua,
    deviceLabel: deviceLabel(ua),
    location: resolveLocation(ip, req),
  };
}

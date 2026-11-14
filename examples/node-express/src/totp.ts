/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226) — the second factor.
 *
 * No dependencies: HMAC-SHA1 via node:crypto, base32 by hand, constant-time
 * comparison on every check. The secret is 20 random bytes (160 bits) as
 * recommended by RFC 4226 §4.1, and the accepted step is returned so the caller
 * can persist it and reject replays.
 *
 * Why TOTP as the second factor here: the primary factor is an emailed code, so
 * the second factor must be independent — a code the user holds (authenticator
 * app) rather than a code sent to the same inbox. TOTP is offline, universal,
 * and needs no SMS provider.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_S = 30;
const DEFAULT_DIGITS = 6;

// ── base32 ───────────────────────────────────────────────────────────────────

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP ──────────────────────────────────────────────────────────────

/** RFC 4226 HOTP for a given counter. */
export function hotp(secret: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** 160-bit secret, base32-encoded for display / otpauth URIs. */
export function generateSecret(bytes = 20): string {
  return encodeBase32(randomBytes(bytes));
}

export function totp(
  secretBase32: string,
  atMs: number = Date.now(),
  stepSeconds = DEFAULT_STEP_S,
  digits = DEFAULT_DIGITS,
): string {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  return hotp(decodeBase32(secretBase32), counter, digits);
}

export interface TotpVerdict {
  ok: boolean;
  /** The time step that matched — persist it to block replays. */
  step?: number;
}

/**
 * Verify a 6-digit code with a ±1 step window (clock drift). Returns the matched
 * step so the caller can enforce single-use: a step that is <= the last accepted
 * step is a replay and must be rejected.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { atMs?: number; window?: number; stepSeconds?: number; digits?: number } = {},
): TotpVerdict {
  const { atMs = Date.now(), window = 1, stepSeconds = DEFAULT_STEP_S, digits = DEFAULT_DIGITS } =
    options;

  const submitted = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return { ok: false };

  const secret = decodeBase32(secretBase32);
  const current = Math.floor(atMs / 1000 / stepSeconds);

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    const expected = hotp(secret, step, digits);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/** `otpauth://` URI for authenticator apps (manual entry or QR generation). */
export function otpauthUri(options: {
  secret: string;
  account: string;
  issuer: string;
  digits?: number;
  stepSeconds?: number;
}): string {
  const { secret, account, issuer, digits = DEFAULT_DIGITS, stepSeconds = DEFAULT_STEP_S } = options;
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(digits),
    period: String(stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── recovery codes ───────────────────────────────────────────────────────────

/**
 * Ten single-use recovery codes, 60 bits each (12 base32 characters) shown as
 * three groups of four. They are the escape hatch when the authenticator app is
 * lost — without them, a lost phone means a locked account.
 */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = encodeBase32(randomBytes(8)).slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

/** Normalize user input: case, spaces and dashes are not part of the secret. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

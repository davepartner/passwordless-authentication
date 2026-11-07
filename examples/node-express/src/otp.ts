import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';

export const OTP_LENGTH = 8;
export const OTP_LIFETIME_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_S = 30;

/** The one generic message returned for invalid, expired, and unknown. */
export const GENERIC_ERROR = 'The code is invalid or has expired.';

// A lazily-computed bcrypt hash used to keep the verify path's timing uniform
// when no challenge exists (closes the timing side channel).
let dummyHash: string | null = null;
function getDummyHash(): string {
  if (!dummyHash) dummyHash = bcrypt.hashSync('otp-timing-placeholder', 10);
  return dummyHash;
}

/** Generate a `length`-digit code with a CSPRNG. */
export function generateCode(length: number = OTP_LENGTH): string {
  return randomInt(0, 10 ** length).toString().padStart(length, '0');
}

/** bcrypt-hash a code. Never store or return the raw code. */
export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

/** Constant-time compare of a submitted code against a stored hash. */
export async function codeMatches(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/** Compare against a dummy when no challenge exists, for uniform timing. */
export function matchesOrDummy(code: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(code, hash ?? getDummyHash());
}

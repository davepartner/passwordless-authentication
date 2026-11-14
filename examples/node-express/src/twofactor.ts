/**
 * Two-factor authentication (TOTP) — optional, user-controlled, enabled from the
 * profile page.
 *
 * The primary factor is an emailed one-time code. The second factor must be
 * independent of it, so it is a code the user holds in an authenticator app
 * (RFC 6238) — not another email. Enrollment only activates after the user
 * proves the app is working, and ten single-use recovery codes are issued at
 * that moment so a lost phone is never a locked account.
 *
 * Replay protection: every accepted TOTP step is recorded on the user, and a
 * step that is equal to or older than the last accepted one is rejected. Without
 * this, a code observed once (shoulder-surfed, phished, replayed from a log)
 * keeps working for the rest of its 30-second window.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  generateRecoveryCodes,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp.js';
import type { RecoveryCode, User } from './store.js';

export const ISSUER = process.env.TOTP_ISSUER ?? 'Passwordless Auth';
export const RECOVERY_CODE_COUNT = 10;
const PENDING_SECRET_TTL_MS = 15 * 60 * 1000;

/** One message for wrong TOTP, expired window, and unknown recovery code. */
export const SECOND_FACTOR_ERROR = 'That code is invalid or has expired.';

export function isTwoFactorEnabled(user: Pick<User, 'twoFactorEnabledAt' | 'twoFactorSecret'>): boolean {
  return user.twoFactorEnabledAt !== null && user.twoFactorSecret !== null;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function hashRecoveryCode(code: string): string {
  return sha256(normalizeRecoveryCode(code));
}

/** Constant-time hex compare (both values are fixed-length SHA-256 hashes). */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface BeginEnrollmentResult {
  user: User;
  secret: string;
  uri: string;
}

/** Step 1 — generate a secret and show it. Nothing is active yet. */
export function beginEnrollment(user: User, now = Date.now()): BeginEnrollmentResult {
  const secret = generateSecret();
  return {
    user: {
      ...user,
      pendingTwoFactorSecret: secret,
      pendingTwoFactorCreatedAt: now,
    },
    secret,
    uri: otpauthUri({ secret, account: user.email, issuer: ISSUER }),
  };
}

export type EnrollmentResult =
  | { ok: true; user: User; recoveryCodes: string[] }
  | { ok: false; user: User; error: string };

/** Step 2 — prove the app works, then activate and issue recovery codes. */
export function confirmEnrollment(user: User, code: string, now = Date.now()): EnrollmentResult {
  const secret = user.pendingTwoFactorSecret;
  const startedAt = user.pendingTwoFactorCreatedAt;

  if (!secret || startedAt === null) {
    return { ok: false, user, error: 'Start two-factor setup again.' };
  }
  if (now - startedAt > PENDING_SECRET_TTL_MS) {
    return {
      ok: false,
      user: { ...user, pendingTwoFactorSecret: null, pendingTwoFactorCreatedAt: null },
      error: 'Setup timed out. Start again.',
    };
  }

  const verdict = verifyTotp(secret, code, { atMs: now });
  if (!verdict.ok || verdict.step === undefined) {
    return { ok: false, user, error: SECOND_FACTOR_ERROR };
  }

  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const recoveryCodes: RecoveryCode[] = codes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null }));

  return {
    ok: true,
    recoveryCodes: codes,
    user: {
      ...user,
      twoFactorSecret: secret,
      twoFactorEnabledAt: now,
      // The confirming code is now spent — its step can never be replayed.
      twoFactorLastStep: verdict.step,
      pendingTwoFactorSecret: null,
      pendingTwoFactorCreatedAt: null,
      recoveryCodes,
    },
  };
}

export type SecondFactorResult =
  | { ok: true; user: User; method: 'totp' | 'recovery_code' }
  | { ok: false; error: string };

/** Verify a TOTP code or a single-use recovery code. Updates the user on success. */
export function verifySecondFactor(user: User, code: string, now = Date.now()): SecondFactorResult {
  if (!isTwoFactorEnabled(user) || !user.twoFactorSecret) {
    return { ok: false, error: SECOND_FACTOR_ERROR };
  }

  const verdict = verifyTotp(user.twoFactorSecret, code, { atMs: now });
  if (verdict.ok && verdict.step !== undefined) {
    const last = user.twoFactorLastStep;
    if (last !== null && verdict.step <= last) {
      // Replay of an already-used time step.
      return { ok: false, error: SECOND_FACTOR_ERROR };
    }
    return {
      ok: true,
      method: 'totp',
      user: { ...user, twoFactorLastStep: verdict.step },
    };
  }

  if (normalizeRecoveryCode(code).length === 12) {
    const hash = hashRecoveryCode(code);
    const index = user.recoveryCodes.findIndex(
      (rc) => rc.usedAt === null && sameHash(rc.hash, hash),
    );
    if (index >= 0) {
      const recoveryCodes = user.recoveryCodes.map((rc, i) =>
        i === index ? { ...rc, usedAt: now } : rc,
      );
      return { ok: true, method: 'recovery_code', user: { ...user, recoveryCodes } };
    }
  }

  return { ok: false, error: SECOND_FACTOR_ERROR };
}

export type ToggleResult = { ok: true; user: User } | { ok: false; user: User; error: string };

/** Turn 2FA off — requires a working second factor (TOTP or recovery code). */
export function disableTwoFactor(user: User, code: string, now = Date.now()): ToggleResult {
  if (!isTwoFactorEnabled(user)) return { ok: false, user, error: 'Two-factor is not enabled.' };

  const verdict = verifySecondFactor(user, code, now);
  if (!verdict.ok) return { ok: false, user, error: verdict.error };

  return {
    ok: true,
    user: {
      ...verdict.user,
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorLastStep: null,
      recoveryCodes: [],
      pendingTwoFactorSecret: null,
      pendingTwoFactorCreatedAt: null,
    },
  };
}

export type RegenerateResult =
  | { ok: true; user: User; recoveryCodes: string[] }
  | { ok: false; user: User; error: string };

/** Replace every unused recovery code. Requires a current TOTP code. */
export function regenerateRecoveryCodes(
  user: User,
  currentTotpCode: string,
  now = Date.now(),
): RegenerateResult {
  const verdict = verifySecondFactor(user, currentTotpCode, now);
  if (!verdict.ok) return { ok: false, user, error: verdict.error };

  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  return {
    ok: true,
    recoveryCodes: codes,
    user: {
      ...verdict.user,
      recoveryCodes: codes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })),
    },
  };
}

/** Emergency reset performed by an admin after identity verification. */
export function forceDisableTwoFactor(user: User): User {
  return {
    ...user,
    twoFactorSecret: null,
    twoFactorEnabledAt: null,
    twoFactorLastStep: null,
    recoveryCodes: [],
    pendingTwoFactorSecret: null,
    pendingTwoFactorCreatedAt: null,
  };
}

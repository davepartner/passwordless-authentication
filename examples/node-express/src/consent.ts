/**
 * Registration consent — Terms of Service + Privacy Policy acceptance.
 *
 * Registration is implicit in a passwordless flow (the account is created on the
 * first successful code), so acceptance is captured at the *request* step, stored
 * on the challenge, and persisted to the user record only when the account is
 * actually created at `verify`. That keeps the request endpoint enumeration-safe:
 * no account lookup happens until the code is proven.
 *
 * The UI renders both boxes pre-checked. The server never trusts the client
 * default: it requires an explicit `true` and rejects the request otherwise.
 */

export const TERMS_VERSION = '1.0.0';
export const PRIVACY_VERSION = '1.0.0';

/** Where the documents live. Point these at the real pages for your app. */
export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';

export const CONSENT_REQUIRED_ERROR =
  'Please accept the Terms of Service and Privacy Policy to continue.';

export interface ConsentRecord {
  termsVersion: string;
  termsAcceptedAt: number;
  privacyVersion: string;
  privacyAcceptedAt: number;
}

export interface ConsentInput {
  acceptedTerms?: unknown;
  acceptedPrivacy?: unknown;
}

export type ConsentResult =
  | { ok: true; consent: ConsentRecord }
  | { ok: false; error: string };

/** Accept `true` or the HTML form values `"on"` / `"true"`; nothing else. */
function isAffirmative(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true';
}

/**
 * Validate the two acceptance flags and stamp them with the versions the user
 * actually agreed to. Both flags are required — there is no consent-by-default
 * on the server, only a pre-checked default in the UI.
 */
export function consentFromInput(input: ConsentInput, now: number = Date.now()): ConsentResult {
  if (!isAffirmative(input.acceptedTerms) || !isAffirmative(input.acceptedPrivacy)) {
    return { ok: false, error: CONSENT_REQUIRED_ERROR };
  }

  return {
    ok: true,
    consent: {
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: now,
      privacyVersion: PRIVACY_VERSION,
      privacyAcceptedAt: now,
    },
  };
}

/**
 * True when the user accepted an older version of either document, so the
 * client should re-present the acceptance step before continuing.
 */
export function needsReconsent(user: {
  termsVersion?: string | null;
  privacyVersion?: string | null;
}): boolean {
  return user.termsVersion !== TERMS_VERSION || user.privacyVersion !== PRIVACY_VERSION;
}

/**
 * Merge an accepted record onto a user, keeping the original accept time when
 * the version has not changed (so repeated logins do not rewrite the audit
 * trail). A new version stamps a new time.
 */
export function mergeConsent<
  T extends {
    termsVersion?: string | null;
    termsAcceptedAt?: number | null;
    privacyVersion?: string | null;
    privacyAcceptedAt?: number | null;
  },
>(user: T, consent: ConsentRecord): T {
  const termsUnchanged = user.termsVersion === consent.termsVersion;
  const privacyUnchanged = user.privacyVersion === consent.privacyVersion;

  return {
    ...user,
    termsVersion: consent.termsVersion,
    termsAcceptedAt:
      termsUnchanged && user.termsAcceptedAt ? user.termsAcceptedAt : consent.termsAcceptedAt,
    privacyVersion: consent.privacyVersion,
    privacyAcceptedAt:
      privacyUnchanged && user.privacyAcceptedAt
        ? user.privacyAcceptedAt
        : consent.privacyAcceptedAt,
  };
}

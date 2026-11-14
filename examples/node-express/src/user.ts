import { userStore, type User } from './store.js';
import { mergeConsent, needsReconsent, type ConsentRecord } from './consent.js';

export const DEFAULT_REDIRECT = '/dashboard';
export const PROFILE_EDIT_REDIRECT = '/profile/edit';
export const WELCOME_FLASH = 'Welcome! Complete your profile to get started.';

export interface LoginOutcome {
  user: User;
  isNew: boolean;
  redirect: string;
  flash?: string;
  /** True when this login re-accepted a newer Terms/Privacy version. */
  reconsented: boolean;
  /** True when the stored acceptance is stale and the client must re-present it. */
  requiresConsent: boolean;
}

/**
 * Find-or-create the user after a successful code verification, and decide
 * where to send them.
 *
 * A brand-new registration has only an email address, so first-time users are
 * sent to the profile-edit page with a welcome flash message to complete their
 * profile. Returning users go straight to the dashboard.
 *
 * `consent` is the acceptance captured on the challenge when the code was
 * requested. It is written to the account at creation, and re-applied on a
 * later login when the published Terms/Privacy version has moved on.
 */
export function completeLogin(
  email: string,
  consent: ConsentRecord | null = null,
): LoginOutcome {
  const existing = userStore.get(email);

  if (existing) {
    const updated = consent
      ? mergeConsent({ ...existing, emailVerifiedAt: Date.now() }, consent)
      : { ...existing, emailVerifiedAt: Date.now() };
    userStore.put(email, updated);

    const stale = needsReconsent(updated);
    return {
      user: updated,
      isNew: false,
      redirect: DEFAULT_REDIRECT,
      reconsented: Boolean(consent) && !stale,
      requiresConsent: stale,
    };
  }

  const base: User = {
    email,
    emailVerifiedAt: Date.now(),
    termsVersion: null,
    termsAcceptedAt: null,
    privacyVersion: null,
    privacyAcceptedAt: null,
  };
  const user = consent ? mergeConsent(base, consent) : base;
  userStore.put(email, user);

  return {
    user,
    isNew: true,
    redirect: PROFILE_EDIT_REDIRECT,
    flash: WELCOME_FLASH,
    reconsented: Boolean(consent),
    // A registration that reached this point without a record is treated as
    // unconsented, so the next sign-in re-presents the acceptance step.
    requiresConsent: needsReconsent(user),
  };
}

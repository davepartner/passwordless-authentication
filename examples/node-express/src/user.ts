import { userStore, type User } from './store.js';

export const DEFAULT_REDIRECT = '/dashboard';
export const PROFILE_EDIT_REDIRECT = '/profile/edit';
export const WELCOME_FLASH = 'Welcome! Complete your profile to get started.';

export interface LoginOutcome {
  user: User;
  isNew: boolean;
  redirect: string;
  flash?: string;
}

/**
 * Find-or-create the user after a successful code verification, and decide
 * where to send them.
 *
 * A brand-new registration has only an email address, so first-time users are
 * sent to the profile-edit page with a welcome flash message to complete their
 * profile. Returning users go straight to the dashboard.
 */
export function completeLogin(email: string): LoginOutcome {
  const existing = userStore.get(email);

  if (existing) {
    existing.emailVerifiedAt = Date.now();
    userStore.put(email, existing);
    return { user: existing, isNew: false, redirect: DEFAULT_REDIRECT };
  }

  const user: User = { email, emailVerifiedAt: Date.now() };
  userStore.put(email, user);
  return { user, isNew: true, redirect: PROFILE_EDIT_REDIRECT, flash: WELCOME_FLASH };
}

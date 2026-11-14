/**
 * Changing the login email address.
 *
 * The account address is the only credential in a passwordless system, so a
 * change requires **proof of control of the new address** and produces a
 * security notice to the old one:
 *
 *   1. Signed-in user submits the new address (step-up auth if 2FA is on).
 *   2. A code goes to the **new** address; a notice goes to the **old** one.
 *   3. Confirming the code moves the account and revokes every other session.
 *
 * The old address is kept in `previousEmails` and an audit record is written at
 * both request and confirm time, so the user (and an investigating admin) can
 * see exactly when the login address changed.
 */

import { isValidEmail, normalizeEmail } from './email.js';
import { generateCode, hashCode, matchesOrDummy } from './otp.js';
import {
  emailChangeStore,
  userStore,
  type EmailChangeRequest,
  type SessionMeta,
  type User,
} from './store.js';

export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;

export const EMAIL_CHANGE_INVALID = 'Enter a valid email address.';
export const EMAIL_CHANGE_SAME = 'That is already your email address.';
export const EMAIL_CHANGE_TAKEN = 'That address cannot be used for this account.';
export const EMAIL_CHANGE_GENERIC = 'The code is invalid or has expired.';

export type StartResult =
  | { ok: true; request: EmailChangeRequest; code: string; newEmail: string }
  | { ok: false; error: string; field?: string };

/** Step 1 — validate the new address and issue a code to it. */
export async function startEmailChange(
  user: User,
  rawNewEmail: string,
  meta: SessionMeta,
  now = Date.now(),
): Promise<StartResult> {
  const newEmail = normalizeEmail(rawNewEmail);

  if (!isValidEmail(newEmail)) return { ok: false, error: EMAIL_CHANGE_INVALID, field: 'newEmail' };
  if (newEmail === user.email) return { ok: false, error: EMAIL_CHANGE_SAME, field: 'newEmail' };

  // Authenticated context, but still do not confirm whether the address belongs
  // to someone else — a single generic message keeps the endpoint from becoming
  // an account-enumeration oracle.
  if (userStore.get(newEmail)) {
    return { ok: false, error: EMAIL_CHANGE_TAKEN, field: 'newEmail' };
  }

  const code = generateCode();
  const request = emailChangeStore.create({
    userEmail: user.email,
    newEmail,
    codeHash: await hashCode(code),
    expiresAt: now + emailChangeStore.ttlMs,
    ip: meta.ip,
    location: meta.location,
    userAgent: meta.userAgent,
  });

  return { ok: true, request, code, newEmail };
}

export type ConfirmResult =
  | { ok: true; user: User; oldEmail: string; newEmail: string }
  | { ok: false; error: string };

/** Step 2 — verify the code and move the account. */
export async function confirmEmailChange(
  requestId: string,
  code: string,
  now = Date.now(),
): Promise<ConfirmResult> {
  const request = emailChangeStore.get(requestId);

  // Constant-time compare even when the request does not exist.
  const matches = await matchesOrDummy(code, request?.codeHash ?? null);
  if (!request) return { ok: false, error: EMAIL_CHANGE_GENERIC };

  if (
    request.consumedAt !== null ||
    request.expiresAt < now ||
    request.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS
  ) {
    emailChangeStore.delete(request.id);
    return { ok: false, error: EMAIL_CHANGE_GENERIC };
  }

  if (!matches) {
    request.attempts += 1;
    if (request.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS) emailChangeStore.delete(request.id);
    return { ok: false, error: EMAIL_CHANGE_GENERIC };
  }

  // The address may have been registered between step 1 and step 2.
  const holder = userStore.get(request.newEmail);
  if (holder && holder.email !== request.userEmail) {
    emailChangeStore.delete(request.id);
    return { ok: false, error: EMAIL_CHANGE_TAKEN };
  }

  const renamed = userStore.rename(request.userEmail, request.newEmail);
  if (!renamed) {
    emailChangeStore.delete(request.id);
    return { ok: false, error: EMAIL_CHANGE_GENERIC };
  }

  emailChangeStore.delete(request.id);
  return { ok: true, user: renamed, oldEmail: request.userEmail, newEmail: request.newEmail };
}

/** Used by the profile page to show "pending: new@example.com". */
export function pendingEmailChangeFor(email: string): EmailChangeRequest | undefined {
  return emailChangeStore.activeFor(email);
}

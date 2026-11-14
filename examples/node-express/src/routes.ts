import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  GENERIC_ERROR,
  MAX_ATTEMPTS,
  OTP_LIFETIME_MS,
  RESEND_COOLDOWN_S,
  generateCode,
  hashCode,
  matchesOrDummy,
} from './otp.js';
import { hit, tooMany } from './rateLimit.js';
import {
  challengeStore,
  deviceStore,
  emailChangeStore,
  isLive,
  mfaStore,
  sessionStore,
  userStore,
  type SessionRecord,
} from './store.js';
import { completeLogin } from './user.js';
import { consentFromInput, type ConsentRecord } from './consent.js';
import { renderPrivacyPage, renderTermsPage } from './legal-pages.js';
import { renderSignInPage } from './views.js';
import { renderProfilePage } from './views-profile.js';
import { renderAdminPage, renderAdminUserPage } from './views-admin.js';
import { isValidEmail, normalizeEmail } from './email.js';
import { audit } from './audit.js';
import { requestMeta } from './meta.js';
import {
  DAY_MS,
  effectiveDays,
  getPolicy,
  updatePolicy,
  type PolicyPatch,
} from './sessionPolicy.js';
import { isAdmin } from './roles.js';
import {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  forceDisableTwoFactor,
  isTwoFactorEnabled,
  regenerateRecoveryCodes,
  SECOND_FACTOR_ERROR,
  verifySecondFactor,
} from './twofactor.js';
import {
  confirmEmailChange,
  pendingEmailChangeFor,
  startEmailChange,
} from './emailChange.js';
import { consumeChallenge, issueChallenge, verifySignature } from './biometric.js';
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  decideAccountAction,
  generateCodeVerifier,
  generateNonce,
  resolveSocialCallback,
  socialStateStore,
  type SocialProvider,
} from './social.js';

const HOUR = 3600_000;
const FIFTEEN_MIN = 15 * 60_000;
const SEND_EMAIL_LIMIT = 10;
const SEND_IP_LIMIT = 20;
const VERIFY_LIMIT = 10;
const MFA_VERIFY_LIMIT = 10;
const EMAIL_CHANGE_LIMIT = 5;
const MAX_DEVICES_PER_ACCOUNT = 5;

export const router = Router();

const CODE_RE = /^\d{8}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────────────────────────────────────

function bearer(req: Request): string {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function currentSession(req: Request): SessionRecord | null {
  const token = bearer(req);
  return token ? sessionStore.sessionFor(token) : null;
}

/** Authenticated session or a 401. */
function requireSession(req: Request, res: Response): SessionRecord | null {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return null;
  }
  return session;
}

/** Admin session or a 401/403. */
function requireAdmin(req: Request, res: Response): SessionRecord | null {
  const session = requireSession(req, res);
  if (!session) return null;

  const user = userStore.get(session.email);
  if (!isAdmin(user)) {
    res.status(403).json({ ok: false, error: 'Administrator access required.' });
    return null;
  }
  return session;
}

type LoginOutcome = {
  redirect: string;
  isNew?: boolean;
  flash?: string;
  requiresConsent?: boolean;
};

/**
 * The single place a session is created. Every login path (email OTP, TOTP,
 * biometric, social) goes through here, so a second factor can never be
 * bypassed by using a different endpoint.
 *
 * A biometric login is already two factors (device possession + biometric), so
 * it satisfies MFA on its own — documented in references/session-management.md.
 */
function finishLogin(
  req: Request,
  res: Response,
  email: string,
  methods: string[],
  outcome: LoginOutcome,
  options: { skipMfa?: boolean } = {},
): void {
  const user = userStore.get(email);
  if (!user) {
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  const meta = requestMeta(req);

  if (!options.skipMfa && isTwoFactorEnabled(user)) {
    const { token } = mfaStore.create(email, meta);
    audit.record({
      action: 'login.2fa_required',
      actor: email,
      target: email,
      ...meta,
    });
    res.json({
      ok: true,
      requires2fa: true,
      mfaToken: token,
      expiresIn: Math.floor(mfaStore.ttlMs / 1000),
    });
    return;
  }

  const days = effectiveDays(user);
  const { token, session } = sessionStore.create(email, meta, days * DAY_MS, methods);

  audit.record({
    action: 'login.succeeded',
    actor: email,
    target: email,
    ...meta,
    meta: { methods: methods.join('+'), days, sessionId: session.id },
  });

  res.json({
    ok: true,
    redirect: outcome.redirect,
    sessionToken: token,
    sessionId: session.id,
    sessionDays: days,
    ...(outcome.isNew ? { isNewUser: true } : {}),
    ...(outcome.flash ? { flash: outcome.flash } : {}),
    ...(outcome.requiresConsent ? { requiresConsent: true } : {}),
  });
}

/**
 * Shared failure budget for every place a second-factor code can be entered:
 * login, disabling 2FA, regenerating recovery codes, and the email-change
 * step-up. Without it, a live session would allow offline-speed guessing of a
 * 6-digit TOTP code.
 */
function secondFactorLimited(email: string): { limited: boolean; retryAfter?: number } {
  return tooMany(`verify2fa:${email}`, MFA_VERIFY_LIMIT, FIFTEEN_MIN);
}

function secondFactorFailed(email: string): void {
  hit(`verify2fa:${email}`, FIFTEEN_MIN);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages — sign-in form + the real legal documents the checkboxes point at
// ─────────────────────────────────────────────────────────────────────────────

router.get('/sign-in', (_req, res) => {
  res.type('html').send(renderSignInPage());
});

router.get('/terms', (_req, res) => {
  res.type('html').send(renderTermsPage());
});

router.get('/privacy', (_req, res) => {
  res.type('html').send(renderPrivacyPage());
});

router.get('/dashboard', (req, res) => {
  if (!currentSession(req)) {
    res.redirect('/sign-in');
    return;
  }
  res.redirect('/profile');
});

// ─────────────────────────────────────────────────────────────────────────────
// Email OTP
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/otp/request — enumeration-safe: no user lookup, uniform response.
router.post('/auth/otp/request', async (req, res) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  if (!isValidEmail(email)) {
    res.status(422).json({ ok: false, error: 'Enter a valid email address.' });
    return;
  }

  // Terms + Privacy acceptance is required before a code is sent. The client
  // renders both boxes pre-checked, but the server still demands an explicit
  // "true" — a pre-checked default is a UI affordance, not consent.
  const consentResult = consentFromInput({
    acceptedTerms: req.body?.acceptedTerms,
    acceptedPrivacy: req.body?.acceptedPrivacy,
  });
  if (!consentResult.ok) {
    res.status(422).json({ ok: false, error: consentResult.error, field: 'consent' });
    return;
  }

  const ip = req.ip ?? '';

  const byEmail = tooMany(`send:email:${email}`, SEND_EMAIL_LIMIT, HOUR);
  if (byEmail.limited) {
    res.status(429).json({ ok: false, retryAfter: byEmail.retryAfter });
    return;
  }
  const byIp = tooMany(`send:ip:${ip}`, SEND_IP_LIMIT, HOUR);
  if (byIp.limited) {
    res.status(429).json({ ok: false, retryAfter: byIp.retryAfter });
    return;
  }
  const cooldown = tooMany(`cooldown:${email}`, 1, RESEND_COOLDOWN_S * 1000);
  if (cooldown.limited) {
    res.status(429).json({ ok: false, retryAfter: cooldown.retryAfter });
    return;
  }

  const requestId = await issueAndSend(email, ip, consentResult.consent);

  hit(`send:email:${email}`, HOUR);
  hit(`send:ip:${ip}`, HOUR);
  hit(`cooldown:${email}`, RESEND_COOLDOWN_S * 1000);

  res.json({
    ok: true,
    requestId,
    resendAfter: RESEND_COOLDOWN_S,
    message: 'If that address is registered, a code is on its way.',
  });
});

// POST /auth/otp/verify — constant-time check, then find-or-create user.
router.post('/auth/otp/verify', async (req, res) => {
  const requestId = String(req.body?.requestId ?? '');
  const code = String(req.body?.code ?? '');

  if (!CODE_RE.test(code)) {
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  const challenge = challengeStore.get(requestId);

  // Constant-time: always run the compare, even when no challenge exists.
  const matches = await matchesOrDummy(code, challenge?.codeHash ?? null);

  if (!challenge) {
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  const email = challenge.email;

  // Verify rate limit: enforce on FAILURES only (successes must not count).
  const limit = tooMany(`verify:${email}`, VERIFY_LIMIT, FIFTEEN_MIN);
  if (limit.limited) {
    res.status(429).json({ ok: false, retryAfter: limit.retryAfter });
    return;
  }

  if (challenge.consumedAt !== null || challenge.expiresAt < Date.now()) {
    challengeStore.delete(requestId);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challengeStore.delete(requestId);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }
  if (!matches) {
    challenge.attempts += 1;
    hit(`verify:${email}`, FIFTEEN_MIN); // a failure counts against the budget
    if (challenge.attempts >= MAX_ATTEMPTS) challengeStore.delete(requestId);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  // Success.
  challengeStore.delete(requestId);

  const { isNew, redirect, flash, requiresConsent } = completeLogin(email, challenge.consent);

  finishLogin(req, res, email, ['email_otp'], {
    redirect,
    isNew,
    flash,
    requiresConsent,
  });
});

// POST /auth/2fa/verify — the second step when two-factor is enabled.
router.post('/auth/2fa/verify', (req, res) => {
  const mfaToken = String(req.body?.mfaToken ?? '');
  const code = String(req.body?.code ?? '').trim();

  const challenge = mfaStore.byToken(mfaToken);
  if (!challenge) {
    res.status(422).json({ ok: false, error: SECOND_FACTOR_ERROR });
    return;
  }

  const email = challenge.email;

  if (challenge.consumedAt !== null || challenge.expiresAt < Date.now()) {
    mfaStore.delete(challenge.id);
    res.status(422).json({ ok: false, error: SECOND_FACTOR_ERROR });
    return;
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    mfaStore.delete(challenge.id);
    res.status(422).json({ ok: false, error: SECOND_FACTOR_ERROR });
    return;
  }

  // Failures only — a successful second factor must not consume the budget.
  const limit = secondFactorLimited(email);
  if (limit.limited) {
    res.status(429).json({ ok: false, retryAfter: limit.retryAfter });
    return;
  }

  const user = userStore.get(email);
  if (!user) {
    mfaStore.delete(challenge.id);
    res.status(422).json({ ok: false, error: SECOND_FACTOR_ERROR });
    return;
  }

  const verdict = verifySecondFactor(user, code);

  if (!verdict.ok) {
    challenge.attempts += 1;
    secondFactorFailed(email);
    if (challenge.attempts >= MAX_ATTEMPTS) mfaStore.delete(challenge.id);
    audit.record({
      action: 'login.2fa_failed',
      outcome: 'failure',
      actor: email,
      target: email,
      ...requestMeta(req),
    });
    res.status(422).json({ ok: false, error: SECOND_FACTOR_ERROR });
    return;
  }

  userStore.put(email, verdict.user);
  mfaStore.delete(challenge.id);

  finishLogin(
    req,
    res,
    email,
    ['email_otp', verdict.method],
    { redirect: '/profile' },
    { skipMfa: true },
  );
});

// POST /auth/otp/resend — refresh the SAME challenge after the cooldown.
router.post('/auth/otp/resend', async (req, res) => {
  const requestId = String(req.body?.requestId ?? '');
  const challenge = challengeStore.get(requestId);
  if (!challenge) {
    res.status(422).json({ ok: false, error: 'Session expired.' });
    return;
  }

  const email = challenge.email;

  const cooldown = tooMany(`cooldown:${email}`, 1, RESEND_COOLDOWN_S * 1000);
  if (cooldown.limited) {
    res.status(429).json({ ok: false, retryAfter: cooldown.retryAfter });
    return;
  }
  const byEmail = tooMany(`send:email:${email}`, SEND_EMAIL_LIMIT, HOUR);
  if (byEmail.limited) {
    res.status(429).json({ ok: false, retryAfter: byEmail.retryAfter });
    return;
  }

  const code = generateCode();
  challenge.codeHash = await hashCode(code);
  challenge.expiresAt = Date.now() + OTP_LIFETIME_MS;
  challenge.attempts = 0;
  challengeStore.set(requestId, challenge);

  sendMail(email, 'Your one-time verification code', `Your code is ${code}. It expires in 10 minutes.`);

  hit(`cooldown:${email}`, RESEND_COOLDOWN_S * 1000);
  hit(`send:email:${email}`, HOUR);

  res.json({ ok: true, resendAfter: RESEND_COOLDOWN_S, message: 'A new code has been sent.' });
});

// POST /auth/logout — revoke this session only.
router.post('/auth/logout', (req, res) => {
  const token = bearer(req);
  if (token) {
    const session = sessionStore.sessionFor(token);
    sessionStore.revokeByToken(token, 'logout');
    if (session) {
      audit.record({
        action: 'logout',
        actor: session.email,
        target: session.email,
        ...requestMeta(req),
        meta: { sessionId: session.id },
      });
    }
  }
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

router.get('/profile', (req, res) => {
  const session = currentSession(req);
  if (!session) {
    res.redirect('/sign-in');
    return;
  }

  const user = userStore.get(session.email);
  if (!user) {
    res.redirect('/sign-in');
    return;
  }

  res.type('html').send(
    renderProfilePage({
      user,
      sessions: sessionStore.list(user.email),
      currentSessionId: session.id,
      policy: getPolicy(),
      effectiveDays: effectiveDays(user),
      history: audit.securityHistory(user.email, 25),
      ...(pendingEmailChangeFor(user.email) ? { pendingChange: pendingEmailChangeFor(user.email) } : {}),
      recoveryCodesRemaining: user.recoveryCodes.filter((c) => c.usedAt === null).length,
    }),
  );
});

// PATCH /profile/session-days — "keep me signed in for N days" (null = default).
router.patch('/profile/session-days', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }

  const policy = getPolicy();
  if (!policy.allowUserOverride) {
    res.status(403).json({
      ok: false,
      error: 'Your administrator sets the login duration for all accounts.',
    });
    return;
  }

  const raw = req.body?.days;
  let days: number | null;
  if (raw === null || raw === undefined || raw === '') {
    days = null;
  } else if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    res.status(422).json({ ok: false, error: 'Choose a whole number of days.' });
    return;
  } else if (raw < policy.minDays || raw > policy.maxDays) {
    res.status(422).json({
      ok: false,
      error: `Choose between ${policy.minDays} and ${policy.maxDays} days.`,
    });
    return;
  } else {
    days = raw;
  }

  userStore.put(user.email, { ...user, sessionDays: days });
  audit.record({
    action: 'session.duration_changed',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
    meta: { days: days ?? 'default' },
  });

  res.json({ ok: true, days, effectiveDays: effectiveDays({ sessionDays: days }) });
});

// POST /profile/sessions/:id/revoke — sign a device out.
router.post('/profile/sessions/:id/revoke', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const target = sessionStore.byId(String(req.params.id));
  if (!target || target.email !== session.email) {
    res.status(404).json({ ok: false, error: 'Session not found.' });
    return;
  }

  sessionStore.revoke(target.id, 'user_revoked');
  audit.record({
    action: 'session.revoked',
    actor: session.email,
    target: session.email,
    ...requestMeta(req),
    meta: { sessionId: target.id, device: target.deviceLabel },
  });

  res.json({ ok: true });
});

// POST /profile/sessions/revoke-others — sign every other device out.
router.post('/profile/sessions/revoke-others', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const count = sessionStore.revokeAll(session.email, {
    exceptSessionId: session.id,
    reason: 'user_revoked_all',
  });

  audit.record({
    action: 'session.revoke_all',
    actor: session.email,
    target: session.email,
    ...requestMeta(req),
    meta: { count },
  });

  res.json({ ok: true, count });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-factor (user controlled)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/profile/2fa/start', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }
  if (isTwoFactorEnabled(user)) {
    res.status(409).json({ ok: false, error: 'Two-factor is already on.' });
    return;
  }

  const { user: updated, secret, uri } = beginEnrollment(user);
  userStore.put(user.email, updated);
  audit.record({
    action: 'twofactor.enroll_started',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
  });

  res.json({ ok: true, secret, uri });
});

router.post('/profile/2fa/confirm', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }

  const budget = secondFactorLimited(user.email);
  if (budget.limited) {
    res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    return;
  }

  const result = confirmEnrollment(user, String(req.body?.code ?? '').trim());
  userStore.put(user.email, result.user);

  if (!result.ok) {
    secondFactorFailed(user.email);
    // A failed setup is not a security event on the account yet, but the state
    // change (expired pending secret) must still be persisted.
    res.status(422).json({ ok: false, error: result.error });
    return;
  }

  audit.record({
    action: 'twofactor.enabled',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
  });

  res.json({ ok: true, recoveryCodes: result.recoveryCodes });
});

router.post('/profile/2fa/disable', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }

  const budget = secondFactorLimited(user.email);
  if (budget.limited) {
    res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    return;
  }

  const result = disableTwoFactor(user, String(req.body?.code ?? '').trim());
  if (!result.ok) {
    secondFactorFailed(user.email);
    res.status(422).json({ ok: false, error: result.error });
    return;
  }

  userStore.put(user.email, result.user);
  audit.record({
    action: 'twofactor.disabled',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
  });

  res.json({ ok: true });
});

router.post('/profile/2fa/recovery-codes', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }

  const budget = secondFactorLimited(user.email);
  if (budget.limited) {
    res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    return;
  }

  const result = regenerateRecoveryCodes(user, String(req.body?.code ?? '').trim());
  if (!result.ok) {
    secondFactorFailed(user.email);
    res.status(422).json({ ok: false, error: result.error });
    return;
  }

  userStore.put(user.email, result.user);
  audit.record({
    action: 'twofactor.recovery_regenerated',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
  });

  res.json({ ok: true, recoveryCodes: result.recoveryCodes });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login email change
// ─────────────────────────────────────────────────────────────────────────────

router.post('/profile/email/request', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const user = userStore.get(session.email);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Please sign in again.' });
    return;
  }

  const limit = tooMany(`emailchange:${user.email}`, EMAIL_CHANGE_LIMIT, HOUR);
  if (limit.limited) {
    res.status(429).json({ ok: false, error: 'Too many change requests. Try again later.' });
    return;
  }

  // Step-up: with 2FA on, a current code is required before we will mail a new
  // address. Without 2FA the session itself is the proof (it came from the inbox).
  if (isTwoFactorEnabled(user)) {
    const budget = secondFactorLimited(user.email);
    if (budget.limited) {
      res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
      return;
    }

    const verdict = verifySecondFactor(user, String(req.body?.code ?? '').trim());
    if (!verdict.ok) {
      secondFactorFailed(user.email);
      res.status(422).json({ ok: false, error: 'Enter a current authenticator or recovery code.' });
      return;
    }
    userStore.put(user.email, verdict.user);
  }

  const result = await startEmailChange(user, String(req.body?.newEmail ?? ''), requestMeta(req));
  if (!result.ok) {
    res.status(422).json({ ok: false, error: result.error, ...(result.field ? { field: result.field } : {}) });
    return;
  }

  hit(`emailchange:${user.email}`, HOUR);

  // Prove the new address; warn the old one. The raw code never leaves this
  // function except into the mail payload.
  sendMail(
    result.newEmail,
    'Confirm your new login email',
    `Your confirmation code is ${result.code}. It expires in 10 minutes.`,
  );
  sendMail(
    user.email,
    'Your login email is being changed',
    `A change to ${result.newEmail} was requested. If this was not you, sign out all devices and contact support.`,
  );

  audit.record({
    action: 'email.change_requested',
    actor: user.email,
    target: user.email,
    ...requestMeta(req),
    meta: { newEmail: result.newEmail },
  });

  res.json({
    ok: true,
    pending: result.newEmail,
    expiresAt: result.request.expiresAt,
  });
});

router.post('/profile/email/confirm', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const pending = pendingEmailChangeFor(session.email);
  if (!pending) {
    res.status(422).json({ ok: false, error: 'No email change is pending.' });
    return;
  }

  const result = await confirmEmailChange(pending.id, String(req.body?.code ?? '').trim());
  if (!result.ok) {
    res.status(422).json({ ok: false, error: result.error });
    return;
  }

  // Move sessions to the new address, then revoke every other device and rotate
  // this one — an email change is a credential change.
  const oldEmail = result.oldEmail;
  sessionStore.moveEmail(oldEmail, result.newEmail);
  sessionStore.revokeAll(result.newEmail, {
    exceptSessionId: session.id,
    reason: 'email_changed',
  });
  sessionStore.revoke(session.id, 'email_changed');

  const meta = requestMeta(req);
  const days = effectiveDays(result.user);
  const { token, session: rotated } = sessionStore.create(
    result.newEmail,
    meta,
    days * DAY_MS,
    [...session.methods, 'email_changed'],
  );

  audit.record({
    action: 'email.changed',
    actor: oldEmail,
    target: result.newEmail,
    ...meta,
    meta: { oldEmail, newEmail: result.newEmail, sessionId: rotated.id },
  });

  sendMail(
    oldEmail,
    'Your login email was changed',
    `The account now signs in with ${result.newEmail}. If this was not you, contact support immediately.`,
  );

  res.json({ ok: true, email: result.newEmail, sessionToken: token, sessionDays: days });
});

router.post('/profile/email/cancel', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const pending = pendingEmailChangeFor(session.email);
  if (pending) emailChangeStore.delete(pending.id);

  audit.record({
    action: 'email.change_cancelled',
    actor: session.email,
    target: session.email,
    ...requestMeta(req),
  });

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

router.get('/admin', (req, res) => {
  const session = currentSession(req);
  if (!session) {
    res.redirect('/sign-in');
    return;
  }
  const user = userStore.get(session.email);
  if (!isAdmin(user)) {
    res.status(403).send('Administrator access required.');
    return;
  }

  const rows = userStore.all().map((u) => {
    const sessions = sessionStore.list(u.email, { includeRevoked: true });
    const live = sessions.filter((s) => isLive(s));
    return {
      user: u,
      activeSessions: live.length,
      lastSeenAt: live.length ? Math.max(...live.map((s) => s.lastSeenAt)) : null,
    };
  });

  res.type('html').send(
    renderAdminPage({
      policy: getPolicy(),
      users: rows,
      totals: {
        users: rows.length,
        admins: rows.filter((r) => r.user.role === 'admin').length,
        twoFactor: rows.filter((r) => r.user.twoFactorEnabledAt !== null).length,
        sessions: rows.reduce((sum, r) => sum + r.activeSessions, 0),
      },
    }),
  );
});

router.get('/admin/users/:email', (req, res) => {
  const session = currentSession(req);
  const adminUser = session ? userStore.get(session.email) : undefined;
  if (!session || !isAdmin(adminUser)) {
    if (!session) res.redirect('/sign-in');
    else res.status(403).send('Administrator access required.');
    return;
  }

  const email = normalizeEmail(String(req.params.email));
  const user = userStore.get(email);
  if (!user) {
    res.status(404).send('User not found.');
    return;
  }

  audit.record({
    action: 'admin.user_viewed',
    actor: session.email,
    target: user.email,
    ...requestMeta(req),
  });

  res.type('html').send(
    renderAdminUserPage({
      user,
      policy: getPolicy(),
      effectiveDays: effectiveDays(user),
      sessions: sessionStore.list(user.email, { includeRevoked: true }),
      history: audit.loginHistory(user.email, 50),
      events: audit
        .forUser(user.email, 100)
        .filter((e) => e.action.startsWith('email.') || e.action.startsWith('admin.')),
      ...(pendingEmailChangeFor(user.email) ? { pendingChange: pendingEmailChangeFor(user.email) } : {}),
    }),
  );
});

router.patch('/admin/settings', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const body = req.body ?? {};
  const patch: PolicyPatch = {};
  for (const key of ['defaultDays', 'minDays', 'maxDays'] as const) {
    if (body[key] !== undefined) patch[key] = Number(body[key]);
  }
  if (body.allowUserOverride !== undefined) patch.allowUserOverride = Boolean(body.allowUserOverride);
  if (body.idleDays !== undefined) {
    patch.idleDays = body.idleDays === null || body.idleDays === '' ? null : Number(body.idleDays);
  }

  const before = getPolicy();
  const result = updatePolicy(patch);
  if (!result.ok) {
    res.status(422).json({ ok: false, error: result.error, field: result.field });
    return;
  }

  audit.record({
    action: 'admin.policy_changed',
    actor: session.email,
    target: session.email,
    ...requestMeta(req),
    meta: {
      before: JSON.stringify(before),
      after: JSON.stringify(result.policy),
    },
  });

  res.json({ ok: true, policy: result.policy });
});

router.patch('/admin/users/:email/session-days', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const user = userStore.get(normalizeEmail(String(req.params.email)));
  if (!user) {
    res.status(404).json({ ok: false, error: 'User not found.' });
    return;
  }

  const policy = getPolicy();
  const raw = req.body?.days;
  let days: number | null;

  if (raw === null || raw === undefined || raw === '') {
    days = null;
  } else if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    res.status(422).json({ ok: false, error: 'Choose a whole number of days.' });
    return;
  } else if (raw < policy.minDays || raw > policy.maxDays) {
    res.status(422).json({
      ok: false,
      error: `Choose between ${policy.minDays} and ${policy.maxDays} days.`,
    });
    return;
  } else {
    days = raw;
  }

  userStore.put(user.email, { ...user, sessionDays: days });

  audit.record({
    action: 'admin.user_session_days_changed',
    actor: session.email,
    target: user.email,
    ...requestMeta(req),
    meta: { days: days ?? 'default' },
  });

  res.json({ ok: true, days, effectiveDays: effectiveDays({ sessionDays: days }) });
});

router.post('/admin/users/:email/sessions/:id/revoke', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const user = userStore.get(normalizeEmail(String(req.params.email)));
  const target = sessionStore.byId(String(req.params.id));
  if (!user || !target || target.email !== user.email) {
    res.status(404).json({ ok: false, error: 'Session not found.' });
    return;
  }

  sessionStore.revoke(target.id, 'admin_revoked');

  audit.record({
    action: 'admin.user_session_revoked',
    actor: session.email,
    target: user.email,
    ...requestMeta(req),
    meta: { sessionId: target.id, device: target.deviceLabel },
  });

  res.json({ ok: true });
});

router.post('/admin/users/:email/2fa/reset', (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const user = userStore.get(normalizeEmail(String(req.params.email)));
  if (!user) {
    res.status(404).json({ ok: false, error: 'User not found.' });
    return;
  }
  if (!isTwoFactorEnabled(user)) {
    res.status(409).json({ ok: false, error: 'Two-factor is not enabled for this user.' });
    return;
  }

  userStore.put(user.email, forceDisableTwoFactor(user));
  // Removing a factor changes who can log in — invalidate every session.
  const count = sessionStore.revokeAll(user.email, { reason: 'admin_2fa_reset' });

  audit.record({
    action: 'admin.twofactor_reset',
    actor: session.email,
    target: user.email,
    ...requestMeta(req),
    meta: { sessionsRevoked: count },
  });

  res.json({ ok: true, sessionsRevoked: count });
});

// ─────────────────────────────────────────────────────────────────────────────
// Biometric (Face ID / Touch ID) — server side
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/biometric/enroll — AUTHENTICATED: stores a device public key.
router.post('/auth/biometric/enroll', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const publicKeyPem = String(req.body?.publicKey ?? '');
  const deviceId = String(req.body?.deviceId ?? '');
  const label = String(req.body?.label ?? '');
  if (!publicKeyPem || !deviceId) {
    res.status(422).json({ ok: false, error: 'publicKey and deviceId are required.' });
    return;
  }

  if (deviceStore.list(session.email).length >= MAX_DEVICES_PER_ACCOUNT) {
    res.status(422).json({ ok: false, error: 'Device limit reached.' });
    return;
  }

  deviceStore.add(session.email, {
    userId: session.email,
    publicKeyPem,
    deviceId,
    label,
    lastUsedAt: null,
  });
  res.json({ ok: true });
});

// POST /auth/biometric/revoke — AUTHENTICATED: removes a device public key.
router.post('/auth/biometric/revoke', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  deviceStore.remove(session.email, String(req.body?.deviceId ?? ''));
  res.json({ ok: true });
});

// POST /auth/biometric/challenge — always returns a challenge (enumeration-safe).
router.post('/auth/biometric/challenge', (_req, res) => {
  const { challengeId, challenge } = issueChallenge();
  res.json({ ok: true, challengeId, challenge });
});

// POST /auth/biometric/verify — verify the signature against any enrolled key.
router.post('/auth/biometric/verify', (req, res) => {
  const email = normalizeEmail(String(req.body?.email ?? ''));
  const challengeId = String(req.body?.challengeId ?? '');
  const signature = String(req.body?.signature ?? '');

  const credentials = deviceStore.list(email);

  let verified = false;
  for (const cred of credentials) {
    if (verifySignature(challengeId, cred.publicKeyPem, signature)) {
      verified = true;
      break;
    }
  }
  consumeChallenge(challengeId); // single use, pass or fail

  if (!verified) {
    res.status(401).json({ ok: false, error: 'Unable to verify this device.' });
    return;
  }

  // Possession (device key) + inherence (biometric) is already two factors, so
  // this path satisfies MFA on its own. See references/session-management.md.
  finishLogin(req, res, email, ['biometric'], { redirect: '/profile' }, { skipMfa: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Social login (OAuth 2.0 / OpenID Connect)
// ─────────────────────────────────────────────────────────────────────────────

// GET /auth/social/:provider — start the OAuth flow.
router.get('/auth/social/:provider', (req, res) => {
  const provider = req.params.provider as SocialProvider; // production: validate against an allowlist
  const clientId = process.env[`SOCIAL_${provider.toUpperCase()}_CLIENT_ID`] ?? '';
  const redirectUri = `${process.env.APP_URL ?? 'http://localhost:3000'}/auth/social/${provider}/callback`;

  if (!clientId) {
    res.status(500).send(`${provider} client id not configured`);
    return;
  }

  const state = randomBytes(16).toString('hex');
  const nonce = provider === 'github' ? undefined : generateNonce();
  const codeVerifier = generateCodeVerifier();

  socialStateStore.set(state, { provider, nonce, codeVerifier, createdAt: Date.now() });

  const url = buildAuthorizeUrl(provider, clientId, redirectUri, {
    state,
    codeChallenge: codeChallengeFromVerifier(codeVerifier),
    nonce,
  });
  res.redirect(url);
});

// GET /auth/social/:provider/callback — handle the provider's redirect.
router.get('/auth/social/:provider/callback', async (req, res) => {
  const provider = req.params.provider as SocialProvider;
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');

  const pending = socialStateStore.get(state);
  if (!pending || pending.provider !== provider) {
    res.status(400).send('Invalid state');
    return;
  }
  socialStateStore.delete(state);

  const clientId = process.env[`SOCIAL_${provider.toUpperCase()}_CLIENT_ID`] ?? '';
  const clientSecret = process.env[`SOCIAL_${provider.toUpperCase()}_CLIENT_SECRET`] ?? '';
  const redirectUri = `${process.env.APP_URL ?? 'http://localhost:3000'}/auth/social/${provider}/callback`;

  const identity = await resolveSocialCallback(code, {
    provider,
    clientId,
    clientSecret,
    redirectUri,
    nonce: pending.nonce,
    codeVerifier: pending.codeVerifier,
  });

  // Reconcile with the local store. In production: look up an existing account
  // by verified email and by (provider, provider_user_id), then decideAccountAction,
  // persist the link, and establish the session **via finishLogin()** so the
  // user's 2FA setting is enforced here too — a social callback must never be a
  // way around the second factor.
  const action = decideAccountAction(identity, false, false);

  res.json({ ok: true, identity, action });
});

// ─────────────────────────────────────────────────────────────────────────────

/** Replace with your transactional mail provider. Never log the code itself. */
function sendMail(to: string, subject: string, _body: string): void {
  console.log(`[mail] ${subject} → ${to}`);
}

async function issueAndSend(
  email: string,
  ip: string,
  consent: ConsentRecord | null,
): Promise<string> {
  const code = generateCode();
  const requestId = randomBytes(16).toString('hex');

  challengeStore.set(requestId, {
    id: requestId,
    email,
    codeHash: await hashCode(code),
    expiresAt: Date.now() + OTP_LIFETIME_MS,
    attempts: 0,
    consumedAt: null,
    ip,
    consent,
  });

  sendMail(email, 'Your one-time verification code', `Your code is ${code}. It expires in 10 minutes.`);
  return requestId;
}

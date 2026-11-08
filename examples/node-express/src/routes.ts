import { Router } from 'express';
import type { Request } from 'express';
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
import { challengeStore, deviceStore, sessionStore } from './store.js';
import { completeLogin } from './user.js';
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
const MAX_DEVICES_PER_ACCOUNT = 5;

export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /^\d{8}$/;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolve the session email from an `Authorization: Bearer <token>` header. */
function requireAuth(req: Request): string | null {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token ? sessionStore.emailFor(token) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email OTP
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/otp/request — enumeration-safe: no user lookup, uniform response.
router.post('/auth/otp/request', async (req, res) => {
  const email = normalize(String(req.body?.email ?? ''));
  if (!EMAIL_RE.test(email)) {
    res.status(422).json({ ok: false, error: 'Enter a valid email address.' });
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

  const requestId = await issueAndSend(email, ip);

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

  const { isNew, redirect, flash } = completeLogin(email);
  const token = sessionStore.create(email);

  res.json({
    ok: true,
    redirect,
    sessionToken: token,
    isNewUser: isNew,
    ...(flash ? { flash } : {}),
  });
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

  console.log(`[mail] sent a verification code to ${email}`);

  hit(`cooldown:${email}`, RESEND_COOLDOWN_S * 1000);
  hit(`send:email:${email}`, HOUR);

  res.json({ ok: true, resendAfter: RESEND_COOLDOWN_S, message: 'A new code has been sent.' });
});

// POST /auth/logout
router.post('/auth/logout', (req, res) => {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token) sessionStore.destroy(token);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Biometric (Face ID / Touch ID) — server side
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/biometric/enroll — AUTHENTICATED: stores a device public key.
router.post('/auth/biometric/enroll', (req, res) => {
  const email = requireAuth(req);
  if (!email) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  const publicKeyPem = String(req.body?.publicKey ?? '');
  const deviceId = String(req.body?.deviceId ?? '');
  const label = String(req.body?.label ?? '');
  if (!publicKeyPem || !deviceId) {
    res.status(422).json({ ok: false, error: 'publicKey and deviceId are required.' });
    return;
  }

  if (deviceStore.list(email).length >= MAX_DEVICES_PER_ACCOUNT) {
    res.status(422).json({ ok: false, error: 'Device limit reached.' });
    return;
  }

  deviceStore.add(email, { userId: email, publicKeyPem, deviceId, label, lastUsedAt: null });
  res.json({ ok: true });
});

// POST /auth/biometric/revoke — AUTHENTICATED: removes a device public key.
router.post('/auth/biometric/revoke', (req, res) => {
  const email = requireAuth(req);
  if (!email) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }
  deviceStore.remove(email, String(req.body?.deviceId ?? ''));
  res.json({ ok: true });
});

// POST /auth/biometric/challenge — always returns a challenge (enumeration-safe).
router.post('/auth/biometric/challenge', (_req, res) => {
  const { challengeId, challenge } = issueChallenge();
  res.json({ ok: true, challengeId, challenge });
});

// POST /auth/biometric/verify — verify the signature against any enrolled key.
router.post('/auth/biometric/verify', (req, res) => {
  const email = normalize(String(req.body?.email ?? ''));
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

  const token = sessionStore.create(email);
  res.json({ ok: true, redirect: '/dashboard', sessionToken: token });
});

// ─────────────────────────────────────────────────────────────────────────────

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
  // persist the link, and establish the session (first login → /profile/edit).
  const action = decideAccountAction(identity, false, false);

  res.json({ ok: true, identity, action });
});

// ─────────────────────────────────────────────────────────────────────────────

async function issueAndSend(email: string, ip: string): Promise<string> {
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
  });

  // Replace with your transactional mail provider. Do NOT log the code itself.
  console.log(`[mail] sent a verification code to ${email}`);
  return requestId;
}

import { Router } from 'express';
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
import { check } from './rateLimit.js';
import { challengeStore, deviceStore, pendingStore, userStore } from './store.js';
import { issueChallenge, verifySignature } from './biometric.js';

const HOUR = 3600_000;
const FIFTEEN_MIN = 15 * 60_000;
const SEND_EMAIL_LIMIT = 10;
const SEND_IP_LIMIT = 20;
const VERIFY_LIMIT = 10;

export const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalize(email: string): string {
  return email.trim().toLowerCase();
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

  const byEmail = check(`send:email:${email}`, SEND_EMAIL_LIMIT, HOUR);
  if (!byEmail.ok) {
    res.status(429).json({ ok: false, retryAfter: byEmail.retryAfter });
    return;
  }
  const byIp = check(`send:ip:${ip}`, SEND_IP_LIMIT, HOUR);
  if (!byIp.ok) {
    res.status(429).json({ ok: false, retryAfter: byIp.retryAfter });
    return;
  }
  const cooldown = check(`cooldown:${email}`, 1, RESEND_COOLDOWN_S * 1000);
  if (!cooldown.ok) {
    res.status(429).json({ ok: false, retryAfter: cooldown.retryAfter });
    return;
  }

  await issueAndSend(email, ip);

  const requestId = randomBytes(16).toString('hex');
  pendingStore.set(requestId, {
    email,
    resendAvailableAt: Date.now() + RESEND_COOLDOWN_S * 1000,
  });

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

  const pending = pendingStore.get(requestId);
  if (!pending) {
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  const email = pending.email;

  const limit = check(`verify:${email}`, VERIFY_LIMIT, FIFTEEN_MIN);
  if (!limit.ok) {
    res.status(429).json({ ok: false, retryAfter: limit.retryAfter });
    return;
  }

  const challenge = challengeStore.get(email);

  // Constant-time: always run the compare, even when no challenge exists.
  const matches = await matchesOrDummy(code, challenge?.codeHash ?? null);

  if (!challenge) {
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }
  if (challenge.consumedAt !== null || challenge.expiresAt < Date.now()) {
    challengeStore.delete(email);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challengeStore.delete(email);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }
  if (!matches) {
    challenge.attempts += 1;
    if (challenge.attempts >= MAX_ATTEMPTS) challengeStore.delete(email);
    res.status(422).json({ ok: false, error: GENERIC_ERROR });
    return;
  }

  // Success.
  challengeStore.delete(email);

  let user = userStore.get(email);
  if (!user) {
    user = { email, emailVerifiedAt: Date.now() };
  } else {
    user.emailVerifiedAt = Date.now();
  }
  userStore.put(email, user);

  pendingStore.delete(requestId);

  // In a real app: set a Secure+HttpOnly+SameSite cookie or issue a signed token.
  res.json({
    ok: true,
    redirect: '/dashboard',
    sessionToken: randomBytes(24).toString('hex'),
  });
});

// POST /auth/otp/resend — re-issue after the server-enforced cooldown.
router.post('/auth/otp/resend', async (req, res) => {
  const requestId = String(req.body?.requestId ?? '');
  const pending = pendingStore.get(requestId);
  if (!pending) {
    res.status(422).json({ ok: false, error: 'Session expired.' });
    return;
  }

  const email = pending.email;

  const cooldown = check(`cooldown:${email}`, 1, RESEND_COOLDOWN_S * 1000);
  if (!cooldown.ok) {
    res.status(429).json({ ok: false, retryAfter: cooldown.retryAfter });
    return;
  }

  await issueAndSend(email, req.ip ?? '');
  pending.resendAvailableAt = Date.now() + RESEND_COOLDOWN_S * 1000;

  res.json({ ok: true, resendAfter: RESEND_COOLDOWN_S, message: 'A new code has been sent.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Biometric (Face ID / Touch ID) — server side
// ─────────────────────────────────────────────────────────────────────────────

// POST /auth/biometric/enroll — store the device public key (authenticated in real apps).
router.post('/auth/biometric/enroll', (req, res) => {
  const email = normalize(String(req.body?.email ?? ''));
  const publicKeyPem = String(req.body?.publicKey ?? '');
  const deviceId = String(req.body?.deviceId ?? '');

  deviceStore.put(email, { userId: email, publicKeyPem, deviceId });
  res.json({ ok: true });
});

// POST /auth/biometric/challenge — always returns a challenge (enumeration-safe).
router.post('/auth/biometric/challenge', (_req, res) => {
  const { challengeId, challenge } = issueChallenge();
  res.json({ ok: true, challengeId, challenge });
});

// POST /auth/biometric/verify — verify the signature against the enrolled key.
router.post('/auth/biometric/verify', (req, res) => {
  const email = normalize(String(req.body?.email ?? ''));
  const challengeId = String(req.body?.challengeId ?? '');
  const signature = String(req.body?.signature ?? '');

  const credential = deviceStore.get(email);
  if (!credential) {
    res.status(401).json({ ok: false, error: 'Unable to verify this device.' });
    return;
  }

  if (!verifySignature(challengeId, credential.publicKeyPem, signature)) {
    res.status(401).json({ ok: false, error: 'Unable to verify this device.' });
    return;
  }

  res.json({
    ok: true,
    redirect: '/dashboard',
    sessionToken: randomBytes(24).toString('hex'),
  });
});

// ─────────────────────────────────────────────────────────────────────────────

async function issueAndSend(email: string, ip: string): Promise<void> {
  const code = generateCode();
  challengeStore.set(email, {
    email,
    codeHash: await hashCode(code),
    expiresAt: Date.now() + OTP_LIFETIME_MS,
    attempts: 0,
    consumedAt: null,
    ip,
  });
  // Replace with your transactional mail provider.
  console.log(`[mail] verification code for ${email}: ${code}`);
}

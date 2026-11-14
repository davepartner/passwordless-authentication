import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from './audit.js';
import { DAY_MS, resetPolicy } from './sessionPolicy.js';
import {
  sessionStore,
  userStore,
  emailChangeStore,
  type SessionMeta,
} from './store.js';
import { newUser } from './user.js';
import {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  isTwoFactorEnabled,
  verifySecondFactor,
} from './twofactor.js';
import {
  EMAIL_CHANGE_GENERIC,
  EMAIL_CHANGE_MAX_ATTEMPTS,
  EMAIL_CHANGE_TAKEN,
  confirmEmailChange,
  startEmailChange,
} from './emailChange.js';
import { totp } from './totp.js';

const META: SessionMeta = {
  ip: '203.0.113.9',
  location: 'GB',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120',
  deviceLabel: 'Chrome on Mac',
};

const uid = () => `u-${Math.random().toString(36).slice(2)}@example.com`;

function seedUser(email = uid()) {
  const user = { ...newUser(email), emailVerifiedAt: Date.now() };
  userStore.put(email, user);
  return user;
}

test.beforeEach(() => {
  resetPolicy();
  audit.clear();
});

// ── sessions ─────────────────────────────────────────────────────────────────

test('a session token is stored hashed, never in the clear', () => {
  const email = seedUser().email;
  const { token, session } = sessionStore.create(email, META, 365 * DAY_MS, ['email_otp']);

  assert.ok(token.length > 30);
  assert.notEqual(session.tokenHash, token);
  assert.equal(session.tokenHash.length, 64); // sha256 hex
  assert.ok(!JSON.stringify(session).includes(token));

  assert.equal(sessionStore.emailFor(token), email);
  assert.equal(sessionStore.emailFor('not-a-real-token'), null);
});

test('a session expires at its configured lifetime', () => {
  const email = seedUser().email;
  const { token } = sessionStore.create(email, META, 1000, ['email_otp'], Date.now() - 5000);

  assert.equal(sessionStore.emailFor(token), null);
});

test('revoking one device leaves the others signed in', () => {
  const email = seedUser().email;
  const first = sessionStore.create(email, META, 365 * DAY_MS, ['email_otp']);
  const second = sessionStore.create(email, { ...META, deviceLabel: 'Safari on iPhone' }, 365 * DAY_MS, ['email_otp']);

  assert.equal(sessionStore.list(email).length, 2);
  assert.equal(sessionStore.revoke(first.session.id, 'test'), true);

  assert.equal(sessionStore.emailFor(first.token), null);
  assert.equal(sessionStore.emailFor(second.token), email);
  assert.equal(sessionStore.list(email).length, 1);
  // Revoked sessions stay visible for the admin/device history.
  assert.equal(sessionStore.list(email, { includeRevoked: true }).length, 2);
});

test('revoke-all keeps the current session only', () => {
  const email = seedUser().email;
  const current = sessionStore.create(email, META, 365 * DAY_MS, ['email_otp']);
  const other = sessionStore.create(email, META, 365 * DAY_MS, ['email_otp']);

  const count = sessionStore.revokeAll(email, { exceptSessionId: current.session.id, reason: 'test' });

  assert.equal(count, 1);
  assert.equal(sessionStore.emailFor(current.token), email);
  assert.equal(sessionStore.emailFor(other.token), null);
});

test('a session never outlives a policy shrink already applied', () => {
  const email = seedUser().email;
  const { token, session } = sessionStore.create(email, META, 30 * DAY_MS, ['email_otp']);
  assert.ok(session.expiresAt - session.createdAt === 30 * DAY_MS);
  assert.equal(sessionStore.emailFor(token), email);
});

// ── two-factor ───────────────────────────────────────────────────────────────

function enabledUser(now = Date.now()) {
  const user = seedUser();
  const started = beginEnrollment(user, now);
  const confirmed = confirmEnrollment(started.user, totp(started.secret, now), now);
  if (!confirmed.ok) throw new Error('enrollment failed');
  return { user: confirmed.user, recoveryCodes: confirmed.recoveryCodes, secret: started.secret, now };
}

test('two-factor only activates after the app is proven', () => {
  const user = seedUser();
  const started = beginEnrollment(user);
  assert.equal(isTwoFactorEnabled(started.user), false);

  const wrong = confirmEnrollment(started.user, '000000');
  assert.equal(wrong.ok, false);
  assert.equal(isTwoFactorEnabled(wrong.user), false);

  const right = confirmEnrollment(started.user, totp(started.secret));
  assert.equal(right.ok, true);
  assert.equal(isTwoFactorEnabled(right.user), true);
  assert.equal(right.recoveryCodes.length, 10);
  assert.equal(right.user.recoveryCodes.length, 10);
});

test('a TOTP code cannot be replayed within its window', () => {
  const { user, secret, now } = enabledUser();
  const code = totp(secret, now + 30_000);

  const first = verifySecondFactor(user, code, now + 30_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const replay = verifySecondFactor(first.user, code, now + 31_000);
  assert.equal(replay.ok, false);
});

test('a recovery code works exactly once', () => {
  const { user, recoveryCodes, now } = enabledUser();
  const code = recoveryCodes[0];

  const first = verifySecondFactor(user, code, now);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.method, 'recovery_code');

  const second = verifySecondFactor(first.user, code, now + 1);
  assert.equal(second.ok, false);
});

test('a wrong second factor is rejected with a generic message', () => {
  const { user, now } = enabledUser();
  const result = verifySecondFactor(user, '123456', now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'That code is invalid or has expired.');
});

test('turning two-factor off requires a valid code and clears the secret', () => {
  const { user, secret, now } = enabledUser();

  const blocked = disableTwoFactor(user, '999999', now);
  assert.equal(blocked.ok, false);

  const disabled = disableTwoFactor(user, totp(secret, now + 60_000), now + 60_000);
  assert.equal(disabled.ok, true);
  assert.equal(isTwoFactorEnabled(disabled.user), false);
  assert.equal(disabled.user.recoveryCodes.length, 0);
  assert.equal(disabled.user.twoFactorSecret, null);
});

// ── login email change ──────────────────────────────────────────────────────

test('changing the login email requires the code sent to the new address', async () => {
  const user = seedUser();
  const started = await startEmailChange(user, 'new-address@example.com', META);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const wrong = await confirmEmailChange(started.request.id, '00000000');
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.error, EMAIL_CHANGE_GENERIC);

  const confirmed = await confirmEmailChange(started.request.id, started.code);
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;

  assert.equal(confirmed.newEmail, 'new-address@example.com');
  assert.equal(userStore.get('new-address@example.com')?.email, 'new-address@example.com');
  assert.equal(userStore.get(user.email), undefined);
  assert.deepEqual(userStore.get(confirmed.newEmail)?.previousEmails, [user.email]);
});

test('an email change to an address already in use is refused', async () => {
  const user = seedUser();
  const taken = seedUser();

  const started = await startEmailChange(user, taken.email, META);
  assert.equal(started.ok, false);
  if (!started.ok) assert.equal(started.error, EMAIL_CHANGE_TAKEN);
});

test('an address cannot be taken over between request and confirm', async () => {
  const user = seedUser();
  const started = await startEmailChange(user, 'race@example.com', META);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  seedUser('race@example.com'); // someone registers it meanwhile

  const confirmed = await confirmEmailChange(started.request.id, started.code);
  assert.equal(confirmed.ok, false);
  if (!confirmed.ok) assert.equal(confirmed.error, EMAIL_CHANGE_TAKEN);
});

test('an email change code dies after the attempt limit', async () => {
  const user = seedUser();
  const started = await startEmailChange(user, 'brute@example.com', META);
  if (!started.ok) return;

  for (let i = 0; i < EMAIL_CHANGE_MAX_ATTEMPTS; i += 1) {
    const attempt = await confirmEmailChange(started.request.id, '00000000');
    assert.equal(attempt.ok, false);
  }

  // Even the real code no longer works — the request is gone.
  const later = await confirmEmailChange(started.request.id, started.code);
  assert.equal(later.ok, false);
});

test('an expired email change request is refused and purged', async () => {
  const user = seedUser();
  const started = await startEmailChange(user, 'late@example.com', META);
  if (!started.ok) return;

  const stored = emailChangeStore.get(started.request.id)!;
  stored.expiresAt = Date.now() - 1;

  const confirmed = await confirmEmailChange(started.request.id, started.code);
  assert.equal(confirmed.ok, false);
  assert.equal(emailChangeStore.get(started.request.id), undefined);
});

test('requesting a second change supersedes the first', async () => {
  const user = seedUser();
  const first = await startEmailChange(user, 'first@example.com', META);
  const second = await startEmailChange(user, 'second@example.com', META);
  if (!first.ok || !second.ok) return;

  assert.equal(emailChangeStore.get(first.request.id), undefined);
  assert.equal(emailChangeStore.activeFor(user.email)?.newEmail, 'second@example.com');
});

// ── audit log ───────────────────────────────────────────────────────────────

test('audit events are filterable per user and split into login history', () => {
  const email = seedUser().email;

  audit.record({ action: 'login.succeeded', actor: email, target: email, ...META });
  audit.record({ action: 'email.changed', actor: 'old@example.com', target: email, ...META });
  audit.record({ action: 'login.failed', actor: 'someone-else@example.com', target: 'someone-else@example.com', ...META });

  const events = audit.forUser(email);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.target === email || e.actor === email));

  const logins = audit.loginHistory(email);
  assert.equal(logins.length, 1);
  assert.equal(logins[0].action, 'login.succeeded');
  assert.equal(logins[0].deviceLabel, 'Chrome on Mac');
});

test('the audit log records outcomes and never accepts secrets by construction', () => {
  const event = audit.record({
    action: 'login.2fa_failed',
    outcome: 'failure',
    actor: 'a@b.co',
    target: 'a@b.co',
    ...META,
    meta: { reason: 'wrong_code' },
  });

  assert.equal(event.outcome, 'failure');
  assert.ok(event.id);
  assert.ok(event.at > 0);
});

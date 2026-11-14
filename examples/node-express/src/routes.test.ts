/**
 * HTTP-level integration tests: the endpoints the pages call, including the 2FA
 * gate, session duration, device revocation, and admin authorization.
 *
 * The email code is never readable outside the mail provider, so these tests
 * seed a challenge with a known code — exactly the state `request` produces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { router } from './routes.js';
import {
  challengeStore,
  sessionStore,
  userStore,
  type SessionMeta,
  type User,
} from './store.js';
import { hashCode } from './otp.js';
import { newUser } from './user.js';
import { resetPolicy } from './sessionPolicy.js';
import { totp } from './totp.js';
import { audit } from './audit.js';
import { PRIVACY_VERSION, TERMS_VERSION } from './consent.js';

process.env.ADMIN_EMAILS = 'admin-test@example.com';

const META: SessionMeta = {
  ip: '127.0.0.1',
  location: 'Local network',
  userAgent: 'node-test',
  deviceLabel: 'Unknown device',
};

const uid = () => `http-${Math.random().toString(36).slice(2)}@example.com`;

let base = '';
let server: ReturnType<typeof express.application.listen>;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

test.after(() => {
  server.close();
});

test.beforeEach(() => {
  resetPolicy();
  audit.clear();
});

const consent = {
  acceptedTerms: true,
  acceptedPrivacy: true,
};

async function seedChallenge(email: string, code = '12345678'): Promise<string> {
  const id = randomBytes(8).toString('hex');
  challengeStore.set(id, {
    id,
    email,
    codeHash: await hashCode(code),
    expiresAt: Date.now() + 10 * 60_000,
    attempts: 0,
    consumedAt: null,
    ip: '127.0.0.1',
    consent: {
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: Date.now(),
      privacyVersion: PRIVACY_VERSION,
      privacyAcceptedAt: Date.now(),
    },
  });
  return id;
}

async function signInFresh(email: string): Promise<{ token: string; body: any }> {
  const requestId = await seedChallenge(email);
  const res = await fetch(`${base}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, code: '12345678' }),
  });
  const body = await res.json();
  return { token: body.sessionToken, body };
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  };
}

function seedUser(email: string, patch: Partial<User> = {}): User {
  const user = { ...newUser(email), emailVerifiedAt: Date.now(), ...patch };
  userStore.put(email, user);
  return user;
}

test('a valid code creates a one-year session and a profile page', async () => {
  const email = uid();
  const { token, body } = await signInFresh(email);

  assert.ok(token);
  assert.equal(body.ok, true);
  assert.equal(body.sessionDays, 365);
  assert.equal(body.isNewUser, true);

  const page = await fetch(`${base}/profile`, authed(token));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Your profile'));
  assert.ok(html.includes(email));
  assert.ok(html.includes('Devices signed in'));
  assert.ok(html.includes('Login history'));
});

test('session duration preference is validated and applied to the next session', async () => {
  const email = uid();
  const { token } = await signInFresh(email);

  const bad = await fetch(`${base}/profile/session-days`, authed(token, {
    method: 'PATCH',
    body: JSON.stringify({ days: 5000 }),
  }));
  assert.equal(bad.status, 422);

  const good = await fetch(`${base}/profile/session-days`, authed(token, {
    method: 'PATCH',
    body: JSON.stringify({ days: 30 }),
  }));
  assert.equal(good.status, 200);

  // Existing session keeps its 1-year expiry…
  assert.equal(sessionStore.emailFor(token) !== null, true);

  // …the next sign-in uses 30 days.
  const next = await signInFresh(email);
  assert.equal(next.body.sessionDays, 30);
  assert.equal(userStore.get(email)?.sessionDays, 30);
});

test('two-factor gates the login and can be confirmed from the profile', async () => {
  const email = uid();
  const { token } = await signInFresh(email);

  const start = await fetch(`${base}/profile/2fa/start`, authed(token, { method: 'POST' }));
  const startBody = await start.json();
  assert.equal(startBody.ok, true);
  assert.match(startBody.uri, /^otpauth:\/\/totp\//);

  const confirm = await fetch(`${base}/profile/2fa/confirm`, authed(token, {
    method: 'POST',
    body: JSON.stringify({ code: totp(startBody.secret) }),
  }));
  const confirmBody = await confirm.json();
  assert.equal(confirmBody.ok, true);
  assert.equal(confirmBody.recoveryCodes.length, 10);

  // Passwordless login now stops at the second factor.
  const requestId = await seedChallenge(email);
  const first = await fetch(`${base}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, code: '12345678' }),
  });
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.requires2fa, true);
  assert.equal(firstBody.sessionToken, undefined);

  // Wrong code → rejected.
  const wrong = await fetch(`${base}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mfaToken: firstBody.mfaToken, code: '000000' }),
  });
  assert.equal(wrong.status, 422);

  // Right code (next time step, so it is not a replay of the enrollment code).
  const second = await fetch(`${base}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mfaToken: firstBody.mfaToken,
      code: totp(startBody.secret, Date.now() + 30_000),
    }),
  });
  const secondBody = await second.json();
  assert.equal(secondBody.ok, true);
  assert.ok(secondBody.sessionToken);
});

test('a used second-factor challenge cannot be reused', async () => {
  const email = uid();
  const user = seedUser(email);
  const { token } = await signInFresh(email);
  assert.ok(user);
  const startBody = await (
    await fetch(`${base}/profile/2fa/start`, authed(token, { method: 'POST' }))
  ).json();
  await fetch(`${base}/profile/2fa/confirm`, authed(token, {
    method: 'POST',
    body: JSON.stringify({ code: totp(startBody.secret) }),
  }));

  const requestId = await seedChallenge(email);
  const first = await (
    await fetch(`${base}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, code: '12345678' }),
    })
  ).json();

  const code = totp(startBody.secret, Date.now() + 30_000);
  const ok = await fetch(`${base}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mfaToken: first.mfaToken, code }),
  });
  assert.equal(ok.status, 200);

  const replay = await fetch(`${base}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mfaToken: first.mfaToken, code }),
  });
  assert.equal(replay.status, 422);
});

test('revoking another device leaves this one signed in', async () => {
  const email = uid();
  const current = await signInFresh(email);
  const other = await signInFresh(email);

  const page = await (await fetch(`${base}/profile`, authed(current.token))).text();
  const otherSession = sessionStore.list(email).find((s) => s.id !== current.body.sessionId);
  assert.ok(otherSession);

  const revoke = await fetch(
    `${base}/profile/sessions/${otherSession!.id}/revoke`,
    authed(current.token, { method: 'POST' }),
  );
  assert.equal(revoke.status, 200);

  assert.equal(sessionStore.emailFor(other.token), null);
  assert.equal(sessionStore.emailFor(current.token), email);
  assert.ok(page.includes('this device'));
});

test('an email change requires the code sent to the new address', async () => {
  const email = uid();
  const { token } = await signInFresh(email);

  const request = await fetch(`${base}/profile/email/request`, authed(token, {
    method: 'POST',
    body: JSON.stringify({ newEmail: uid() }),
  }));
  const requestBody = await request.json();
  assert.equal(requestBody.ok, true);
  assert.ok(requestBody.pending);

  const wrong = await fetch(`${base}/profile/email/confirm`, authed(token, {
    method: 'POST',
    body: JSON.stringify({ code: '00000000' }),
  }));
  assert.equal(wrong.status, 422);

  // The account still signs in with the old address.
  const again = await signInFresh(email);
  assert.ok(again.token);
});

test('an email change to an address in use is refused', async () => {
  const taken = seedUser(uid());
  const { token } = await signInFresh(uid());

  const res = await fetch(`${base}/profile/email/request`, authed(token, {
    method: 'POST',
    body: JSON.stringify({ newEmail: taken.email }),
  }));
  assert.equal(res.status, 422);
});

test('consent is still required before any code is sent', async () => {
  const res = await fetch(`${base}/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: uid() }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.field, 'consent');

  const ok = await fetch(`${base}/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: uid(), ...consent }),
  });
  assert.equal(ok.status, 200);
});

test('admin pages and settings are closed to normal users', async () => {
  const { token } = await signInFresh(uid());

  const page = await fetch(`${base}/admin`, authed(token));
  assert.equal(page.status, 403);

  const settings = await fetch(`${base}/admin/settings`, authed(token, {
    method: 'PATCH',
    body: JSON.stringify({ defaultDays: 30 }),
  }));
  assert.equal(settings.status, 403);
});

test('an admin can change the login policy and inspect a user', async () => {
  const admin = seedUser('admin-test@example.com');
  const { token } = await signInFresh(admin.email);

  const patch = await fetch(`${base}/admin/settings`, authed(token, {
    method: 'PATCH',
    body: JSON.stringify({ defaultDays: 30, maxDays: 90 }),
  }));
  assert.equal(patch.status, 200);
  const patchBody = await patch.json();
  assert.equal(patchBody.policy.defaultDays, 30);

  const target = seedUser(uid());
  const detail = await fetch(`${base}/admin/users/${encodeURIComponent(target.email)}`, authed(token));
  assert.equal(detail.status, 200);
  const html = await detail.text();
  assert.ok(html.includes(target.email));
  assert.ok(html.includes('Signed-in devices'));
  assert.ok(html.includes('Email change log'));

  // The look at a user record is itself audited.
  const viewed = audit.forUser(target.email).some((e) => e.action === 'admin.user_viewed');
  assert.equal(viewed, true);

  // The new default applies to the next sign-in of a fresh user.
  const fresh = await signInFresh(uid());
  assert.equal(fresh.body.sessionDays, 30);
});

test('admin can set a per-user duration and revoke a device', async () => {
  const admin = seedUser('admin-test@example.com');
  const { token } = await signInFresh(admin.email);
  const target = seedUser(uid());

  const days = await fetch(`${base}/admin/users/${encodeURIComponent(target.email)}/session-days`, authed(token, {
    method: 'PATCH',
    body: JSON.stringify({ days: 7 }),
  }));
  assert.equal(days.status, 200);
  assert.equal(userStore.get(target.email)?.sessionDays, 7);

  const targetSession = sessionStore.create(target.email, META, 7 * 24 * 3600_000, ['email_otp']);
  const revoke = await fetch(
    `${base}/admin/users/${encodeURIComponent(target.email)}/sessions/${targetSession.session.id}/revoke`,
    authed(token, { method: 'POST' }),
  );
  assert.equal(revoke.status, 200);
  assert.equal(sessionStore.emailFor(targetSession.token), null);
});

test('admin can reset a locked-out user’s two-factor and sessions', async () => {
  const admin = seedUser('admin-test@example.com');
  const { token } = await signInFresh(admin.email);
  const target = seedUser(uid());

  const targetSession = await signInFresh(target.email);
  const startBody = await (
    await fetch(`${base}/profile/2fa/start`, authed(targetSession.token, { method: 'POST' }))
  ).json();
  await fetch(`${base}/profile/2fa/confirm`, authed(targetSession.token, {
    method: 'POST',
    body: JSON.stringify({ code: totp(startBody.secret) }),
  }));
  assert.equal(userStore.get(target.email)?.twoFactorEnabledAt !== null, true);

  const reset = await fetch(
    `${base}/admin/users/${encodeURIComponent(target.email)}/2fa/reset`,
    authed(token, { method: 'POST' }),
  );
  assert.equal(reset.status, 200);
  const body = await reset.json();
  assert.equal(body.sessionsRevoked, 1);

  assert.equal(userStore.get(target.email)?.twoFactorEnabledAt, null);
  assert.equal(sessionStore.emailFor(targetSession.token), null);
});

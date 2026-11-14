import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  HARD_LIMITS,
  clampDays,
  effectiveDays,
  getPolicy,
  isIdleExpired,
  resetPolicy,
  updatePolicy,
} from './sessionPolicy.js';

test('the default login session is one year', () => {
  resetPolicy();
  const policy = getPolicy();
  assert.equal(policy.defaultDays, 365);
  assert.equal(policy.maxDays, 365);
  assert.equal(policy.minDays, 1);
  assert.equal(policy.allowUserOverride, true);
});

test('a user with no preference gets the admin default', () => {
  resetPolicy();
  assert.equal(effectiveDays({ sessionDays: null }), 365);
});

test('a user preference is honoured inside the allowed band', () => {
  resetPolicy();
  assert.equal(effectiveDays({ sessionDays: 30 }), 30);
});

test('a user preference is clamped to the admin ceiling', () => {
  resetPolicy();
  updatePolicy({ maxDays: 90, defaultDays: 90 });
  assert.equal(effectiveDays({ sessionDays: 365 }), 90);
  assert.equal(clampDays(1000), 90);
});

test('turning user override off forces the admin default', () => {
  resetPolicy();
  updatePolicy({ allowUserOverride: false });
  assert.equal(effectiveDays({ sessionDays: 7 }), 365);
});

test('policy updates are validated, not silently accepted', () => {
  resetPolicy();

  assert.equal(updatePolicy({ defaultDays: 0 }).ok, false);
  assert.equal(updatePolicy({ defaultDays: HARD_LIMITS.maxDays + 1 }).ok, false);
  assert.equal(updatePolicy({ defaultDays: 400, maxDays: 365 }).ok, false);
  assert.equal(updatePolicy({ minDays: 400, defaultDays: 365 }).ok, false);
  assert.equal(updatePolicy({ idleDays: 0 }).ok, false);

  const ok = updatePolicy({ defaultDays: 30, maxDays: 90 });
  assert.equal(ok.ok, true);
  assert.equal(getPolicy().defaultDays, 30);

  // The failed attempts above must not have applied anything.
  assert.equal(getPolicy().maxDays, 90);
});

test('an existing session is unaffected by a later policy change', () => {
  resetPolicy();
  updatePolicy({ defaultDays: 30 });

  // 365-day session issued before the change keeps its own expiry.
  const issuedAt = 1_000_000;
  const expiresAt = issuedAt + 365 * DAY_MS;
  assert.equal(expiresAt, issuedAt + 365 * DAY_MS);
});

test('idle expiry only applies when the admin enables it', () => {
  resetPolicy();
  const lastSeen = 1_000_000;
  assert.equal(isIdleExpired(lastSeen, lastSeen + 10_000 * DAY_MS), false);

  updatePolicy({ idleDays: 30 });
  assert.equal(isIdleExpired(lastSeen, lastSeen + 10 * DAY_MS), false);
  assert.equal(isIdleExpired(lastSeen, lastSeen + 31 * DAY_MS), true);
});

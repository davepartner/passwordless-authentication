import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeLogin,
  DEFAULT_REDIRECT,
  PROFILE_REDIRECT,
  WELCOME_FLASH,
} from './user.js';
import { userStore } from './store.js';
import { PRIVACY_VERSION, TERMS_VERSION, type ConsentRecord } from './consent.js';

const consent = (at = Date.now()): ConsentRecord => ({
  termsVersion: TERMS_VERSION,
  termsAcceptedAt: at,
  privacyVersion: PRIVACY_VERSION,
  privacyAcceptedAt: at,
});

const randomEmail = () => `new-${Math.random().toString(36)}@example.com`;

test('first-time login is sent to profile edit with a welcome flash', () => {
  const email = randomEmail();
  const outcome = completeLogin(email, consent());

  assert.equal(outcome.isNew, true);
  assert.equal(outcome.redirect, PROFILE_REDIRECT);
  assert.equal(outcome.flash, WELCOME_FLASH);

  // The account exists and is marked email-verified.
  assert.ok(userStore.get(email)?.emailVerifiedAt);
});

test('registration records the accepted Terms and Privacy versions', () => {
  const email = randomEmail();
  completeLogin(email, consent(1234));
  const user = userStore.get(email);

  assert.equal(user?.termsVersion, TERMS_VERSION);
  assert.equal(user?.termsAcceptedAt, 1234);
  assert.equal(user?.privacyVersion, PRIVACY_VERSION);
  assert.equal(user?.privacyAcceptedAt, 1234);
});

test('returning login goes straight to the dashboard without a flash', () => {
  const email = randomEmail();
  completeLogin(email, consent()); // first time
  const outcome = completeLogin(email, consent()); // returning

  assert.equal(outcome.isNew, false);
  assert.equal(outcome.redirect, DEFAULT_REDIRECT);
  assert.equal(outcome.flash, undefined);
  assert.equal(outcome.requiresConsent, false);
});

test('a registration without an acceptance record must re-consent on next login', () => {
  const email = randomEmail();
  const outcome = completeLogin(email, null);

  assert.equal(outcome.isNew, true);
  assert.equal(outcome.requiresConsent, true);
  assert.equal(userStore.get(email)?.termsVersion, null);
});

test('a stale acceptance is flagged and refreshed when a new acceptance arrives', () => {
  const email = randomEmail();
  completeLogin(email, {
    termsVersion: '0.9.0',
    termsAcceptedAt: 1000,
    privacyVersion: '0.9.0',
    privacyAcceptedAt: 1000,
  });

  const stale = completeLogin(email, null);
  assert.equal(stale.requiresConsent, true);

  const refreshed = completeLogin(email, consent(7777));
  assert.equal(refreshed.requiresConsent, false);
  assert.equal(refreshed.reconsented, true);
  assert.equal(userStore.get(email)?.termsAcceptedAt, 7777);
});

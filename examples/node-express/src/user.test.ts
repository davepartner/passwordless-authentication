import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeLogin,
  DEFAULT_REDIRECT,
  PROFILE_EDIT_REDIRECT,
  WELCOME_FLASH,
} from './user.js';
import { userStore } from './store.js';

test('first-time login is sent to profile edit with a welcome flash', () => {
  const email = `new-${Math.random().toString(36)}@example.com`;
  const outcome = completeLogin(email);

  assert.equal(outcome.isNew, true);
  assert.equal(outcome.redirect, PROFILE_EDIT_REDIRECT);
  assert.equal(outcome.flash, WELCOME_FLASH);

  // The account exists and is marked email-verified.
  assert.ok(userStore.get(email)?.emailVerifiedAt);
});

test('returning login goes straight to the dashboard without a flash', () => {
  const email = `new-${Math.random().toString(36)}@example.com`;
  completeLogin(email); // first time
  const outcome = completeLogin(email); // returning

  assert.equal(outcome.isNew, false);
  assert.equal(outcome.redirect, DEFAULT_REDIRECT);
  assert.equal(outcome.flash, undefined);
});

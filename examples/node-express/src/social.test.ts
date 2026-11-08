import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  decideAccountAction,
  generateCodeVerifier,
  normalizeIdentity,
} from './social.js';

test('normalizeIdentity maps OIDC claims (verified email)', () => {
  const id = normalizeIdentity('google', {
    sub: '123',
    email: 'alice@example.com',
    email_verified: true,
    name: 'Alice',
    picture: 'https://example.com/a.png',
  });
  assert.equal(id.provider, 'google');
  assert.equal(id.sub, '123');
  assert.equal(id.email, 'alice@example.com');
  assert.equal(id.emailVerified, true);
  assert.equal(id.name, 'Alice');
});

test('normalizeIdentity maps GitHub claims (verified email)', () => {
  const id = normalizeIdentity('github', { id: 42, email: 'bob@example.com', verified: true, name: 'Bob' });
  assert.equal(id.sub, '42');
  assert.equal(id.emailVerified, true);
});

test('verified email + no existing account → create', () => {
  const id = normalizeIdentity('google', { sub: '1', email: 'a@example.com', email_verified: true });
  assert.equal(decideAccountAction(id, false, false).action, 'create');
});

test('verified email + existing account → link', () => {
  const id = normalizeIdentity('google', { sub: '1', email: 'a@example.com', email_verified: true });
  assert.equal(decideAccountAction(id, true, false).action, 'link');
});

test('UNVERIFIED email never links, even when an account exists (takeover guard)', () => {
  const id = normalizeIdentity('github', { id: 1, email: 'victim@example.com', verified: false });
  assert.equal(decideAccountAction(id, true, false).action, 'require-verification');
});

test('existing provider sub always links, even without a verified email', () => {
  const id = normalizeIdentity('google', { sub: '1', email: null, email_verified: false });
  assert.equal(decideAccountAction(id, false, true).action, 'link');
});

test('PKCE verifier → challenge is a deterministic SHA-256 S256 challenge', () => {
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeFromVerifier(verifier);
  assert.ok(verifier.length >= 43);
  assert.ok(challenge.length >= 43);
  assert.notEqual(verifier, challenge);
});

test('buildAuthorizeUrl includes state, PKCE, and (for OIDC) nonce', () => {
  const url = buildAuthorizeUrl('google', 'client-123', 'https://app.example.com/callback', {
    state: 'state-abc',
    codeChallenge: 'challenge-xyz',
    nonce: 'nonce-123',
  });
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.match(url, /code_challenge=challenge-xyz/);
  assert.match(url, /code_challenge_method=S256/);
  assert.match(url, /state=state-abc/);
  assert.match(url, /nonce=nonce-123/);
});

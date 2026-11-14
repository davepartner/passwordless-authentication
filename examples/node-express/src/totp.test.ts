import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBase32,
  encodeBase32,
  generateRecoveryCodes,
  generateSecret,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B — SHA1 vectors. Secret is the ASCII string
// "12345678901234567890" (20 bytes), base32-encoded below.
const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));

const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('base32 round-trips arbitrary bytes', () => {
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255, 42]);
  assert.deepEqual(decodeBase32(encodeBase32(bytes)), bytes);
});

test('base32 encoding matches a known value', () => {
  assert.equal(encodeBase32(Buffer.from('12345678901234567890', 'ascii')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('TOTP reproduces the RFC 6238 SHA-1 test vectors', () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    assert.equal(totp(RFC_SECRET, seconds * 1000, 30, 8), expected, `T=${seconds}`);
  }
});

test('HOTP counter 0..2 match the RFC 4226 known values', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  assert.equal(hotp(secret, 0), '755224');
  assert.equal(hotp(secret, 1), '287082');
  assert.equal(hotp(secret, 2), '359152');
});

test('verification accepts the current step and one step of clock drift', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const current = totp(secret, now);
  const previous = totp(secret, now - 30_000);

  assert.equal(verifyTotp(secret, current, { atMs: now }).ok, true);
  assert.equal(verifyTotp(secret, previous, { atMs: now }).ok, true);
});

test('verification rejects a stale code beyond the drift window', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const stale = totp(secret, now - 120_000);

  assert.equal(verifyTotp(secret, stale, { atMs: now }).ok, false);
});

test('verification reports the matched step so replays can be blocked', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const code = totp(secret, now);
  const verdict = verifyTotp(secret, code, { atMs: now });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.step, Math.floor(now / 1000 / 30));
});

test('malformed codes never verify', () => {
  const secret = generateSecret();
  assert.equal(verifyTotp(secret, '', {}).ok, false);
  assert.equal(verifyTotp(secret, 'abcdef', {}).ok, false);
  assert.equal(verifyTotp(secret, '12345', {}).ok, false);
});

test('recovery codes are unique, normalized to 12 characters, and URL-safe for display', () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    assert.equal(normalizeRecoveryCode(code).length, 12);
  }
  // Case, spaces and dashes are not part of the secret.
  assert.equal(normalizeRecoveryCode(codes[0].toLowerCase().replace(/-/g, ' ')), normalizeRecoveryCode(codes[0]));
});

test('otpauth URI carries the secret, issuer and account', () => {
  const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'a@b.co', issuer: 'Example' });
  assert.match(uri, /^otpauth:\/\/totp\/Example%3Aa%40b\.co\?/);
  assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
  assert.ok(uri.includes('issuer=Example'));
  assert.ok(uri.includes('period=30'));
});

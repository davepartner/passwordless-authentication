import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, matchesOrDummy } from './otp.js';

test('generateCode returns a zero-padded 6-digit string', () => {
  assert.match(generateCode(), /^\d{6}$/);
});

test('generateCode honors a custom length', () => {
  assert.match(generateCode(8), /^\d{8}$/);
});

test('hashCode + matchesOrDummy round-trips', async () => {
  const code = generateCode();
  const hash = await hashCode(code);
  assert.equal(await matchesOrDummy(code, hash), true);
  assert.equal(await matchesOrDummy('000000', hash), false);
});

test('matchesOrDummy with a null hash (dummy path) returns false', async () => {
  assert.equal(await matchesOrDummy('123456', null), false);
});

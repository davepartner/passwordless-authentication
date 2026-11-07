import test from 'node:test';
import assert from 'node:assert/strict';
import { tooMany, hit } from './rateLimit.js';

test('allows up to the limit, then blocks', () => {
  const key = `test:${Math.random().toString(36)}`;
  assert.equal(tooMany(key, 2, 60_000).limited, false);
  hit(key, 60_000);
  assert.equal(tooMany(key, 2, 60_000).limited, false);
  hit(key, 60_000);
  assert.equal(tooMany(key, 2, 60_000).limited, true);
});

test('retryAfter is positive when limited', () => {
  const key = `test:${Math.random().toString(36)}`;
  hit(key, 60_000);
  const r = tooMany(key, 1, 60_000);
  assert.equal(r.limited, true);
  assert.ok(r.retryAfter > 0);
});

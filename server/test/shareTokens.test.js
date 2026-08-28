import test from 'node:test';
import assert from 'node:assert/strict';
import { shareTokenUsable } from '../services/shareTokenPolicy.js';

const NOW = new Date('2026-08-27T12:00:00Z');

test('a token with no expiry and no revocation is usable', () => {
  assert.equal(shareTokenUsable({ revokedAt: null, expiresAt: null }, NOW), true);
});

test('revocation always wins, even over a future expiry', () => {
  assert.equal(shareTokenUsable({ revokedAt: '2026-08-26T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }, NOW), false);
});

test('an expiry in the past kills the token', () => {
  assert.equal(shareTokenUsable({ revokedAt: null, expiresAt: '2026-08-27T11:59:59Z' }, NOW), false);
});

test('an expiry exactly now is already dead — the boundary errs toward refusal', () => {
  assert.equal(shareTokenUsable({ revokedAt: null, expiresAt: NOW.toISOString() }, NOW), false);
});

test('a future expiry is still usable', () => {
  assert.equal(shareTokenUsable({ revokedAt: null, expiresAt: '2026-08-28T00:00:00Z' }, NOW), true);
});

test('a missing record shape refuses nothing it should not — empty object is usable until revoked/expired', () => {
  assert.equal(shareTokenUsable({}, NOW), true);
});

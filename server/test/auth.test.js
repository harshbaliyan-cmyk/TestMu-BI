import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authAttemptStatus, recordAuthFailure, clearAuthFailures, verifyPassword, passwordProblem, AUTH_LIMITS,
  selfSignupAllowed, isAdminSession,
} from '../services/authGuard.js';
import bcrypt from 'bcryptjs';

const uniq = () => `${Math.random().toString(36).slice(2)}@example.com`;

test('an account locks after the per-email attempt limit and reports Retry-After', () => {
  const email = uniq(), ip = `10.0.0.${Math.floor(Math.random() * 250) + 1}`;
  for (let i = 0; i < AUTH_LIMITS.EMAIL_MAX_ATTEMPTS - 1; i += 1) {
    recordAuthFailure(ip, email);
    assert.equal(authAttemptStatus(ip, email).blocked, false, `should still be open after ${i + 1}`);
  }
  recordAuthFailure(ip, email);
  const status = authAttemptStatus(ip, email);
  assert.equal(status.blocked, true);
  assert.ok(status.retryAfterSeconds > 0);
});

test('the email counter blocks the account from every source address, not just the guessing one', () => {
  const email = uniq();
  for (let i = 0; i < AUTH_LIMITS.EMAIL_MAX_ATTEMPTS; i += 1) recordAuthFailure(`10.1.1.${i}`, email);
  // Distributed guessing rotates the IP; the per-email counter is what stops it.
  assert.equal(authAttemptStatus('10.9.9.9', email).blocked, true);
});

test('a successful sign-in clears the counters so one typo does not haunt a user', () => {
  const email = uniq(), ip = '10.2.0.1';
  recordAuthFailure(ip, email);
  recordAuthFailure(ip, email);
  clearAuthFailures(ip, email);
  assert.equal(authAttemptStatus(ip, email).blocked, false);
});

test('password verification returns false — not an error — for an account with no password hash', async () => {
  // Google-only accounts have no hash. This path must behave like a wrong
  // password, never throw and never succeed.
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('anything', undefined), false);
});

test('password verification still accepts a correct password', async () => {
  const hash = await bcrypt.hash('correct horse battery staple', 12);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('the unknown-account path costs roughly as much as the wrong-password path', async () => {
  // Timing is the enumeration oracle that generic error text cannot close, so
  // the no-user branch must still run bcrypt. Compared as an order of
  // magnitude, not a tight bound, to stay stable on a loaded CI box.
  const hash = await bcrypt.hash('some real password', 12);
  const time = async fn => { const t = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t); };
  const withUser = await time(() => verifyPassword('guess', hash));
  const withoutUser = await time(() => verifyPassword('guess', null));
  const ratio = Math.max(withUser, withoutUser) / Math.max(1, Math.min(withUser, withoutUser));
  assert.ok(ratio < 10, `timing ratio ${ratio.toFixed(1)} suggests the no-user path skips bcrypt`);
});

test('password policy rejects short, single-class, common and self-referential passwords', () => {
  assert.match(passwordProblem('short'), /at least 12/);
  // 12 chars but one character class only.
  assert.match(passwordProblem('abcdefghijkl'), /three of|16\+/);
  assert.match(passwordProblem('Password123!'), /too easy to guess/);
  assert.match(passwordProblem('aaaaaaaaaaaaaa'), /too easy|three of/);
  assert.match(passwordProblem('harshb-9182-XY!', { email: 'harshb@lambdatest.com' }), /email address/);
  assert.match(passwordProblem('Harshbaliyan-99!', { name: 'Harsh Baliyan' }), /your name/);
});

test('password policy accepts a long passphrase and a shorter mixed-class password', () => {
  assert.equal(passwordProblem('correct horse battery staple'), null);
  assert.equal(passwordProblem('Tr0ub4dor&3xyz'), null);
});

// ===== ACCOUNT CREATION AND ADMIN POLICY =====

test('self-service signup is closed unless explicitly enabled', () => {
  // The regression: an unverified address that merely ENDED in the allowed
  // domain was handed a live session. Absent proof of ownership, the answer is
  // no — and it stays no for every value that is not exactly "true", so a
  // half-set or truthy-looking flag cannot quietly reopen it.
  assert.equal(selfSignupAllowed({}), false, 'closed when the flag is absent');
  assert.equal(selfSignupAllowed({ ALLOW_SELF_SIGNUP: 'false' }), false);
  assert.equal(selfSignupAllowed({ ALLOW_SELF_SIGNUP: '1' }), false, '"1" is not opt-in');
  assert.equal(selfSignupAllowed({ ALLOW_SELF_SIGNUP: 'TRUE' }), false, 'and neither is "TRUE"');
  assert.equal(selfSignupAllowed({ ALLOW_SELF_SIGNUP: '' }), false);
  assert.equal(selfSignupAllowed({ ALLOWED_DOMAIN: 'example.com' }), false,
    'a domain allowlist is not consent to self-signup');
  assert.equal(selfSignupAllowed({ ALLOW_SELF_SIGNUP: 'true' }), true, 'and yes only when asked for exactly');
});

test('admin is the role on the record, never an address in an env var', () => {
  assert.equal(isAdminSession({ role: 'admin', email: 'a@example.com' }), true);
  assert.equal(isAdminSession({ role: 'user', email: 'a@example.com' }), false);
  // The escalation this closed: claim an ADMIN_EMAILS address that has not
  // registered yet, and the session was privileged on the strength of the
  // string alone. An email must never stand in for a role again.
  assert.equal(isAdminSession({ role: 'user', email: process.env.ADMIN_EMAILS || 'admin@example.com' }), false,
    'a listed address with a user role is NOT an admin');
  assert.equal(isAdminSession({ email: 'a@example.com' }), false, 'a session with no role is not an admin');
  assert.equal(isAdminSession({}), false);
  assert.equal(isAdminSession(null), false);
  assert.equal(isAdminSession(undefined), false);
});

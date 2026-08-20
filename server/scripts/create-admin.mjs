#!/usr/bin/env node
/**
 * Create the first administrator, or promote an existing account to admin.
 *
 * Why this exists as a script rather than a route: self-service signup is off
 * (see ALLOW_SELF_SIGNUP in server.js), and every admin route already requires
 * an admin — so a fresh deployment has no way to make its first one. The usual
 * fix is a network-facing bootstrap door ("the first account wins", or "any
 * address in ADMIN_EMAILS may sign up while no admin exists"), and that door is
 * exactly the hole this change closed: it is opened by whoever reaches it
 * first, which on a public URL is not necessarily you.
 *
 * A script has no such door. It requires shell access to the server and the
 * database credentials, which is the authority an operator already holds.
 *
 * Run it from the server directory:
 *     node scripts/create-admin.mjs
 *
 * The password is read from a hidden prompt, never from an argument or an
 * environment variable: both leak into shell history and process listings.
 * After this, add further users from the admin UI, which issues a temporary
 * password and forces a change on first login.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { databaseEnabled, query } from '../db/pool.js';
import { findUserByEmail, createPasswordUser, updateUserAccess } from '../repositories/users.js';
import { passwordProblem } from '../services/authGuard.js';

const ask = (prompt, { hidden = false } = {}) => new Promise(resolve => {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  rl.question(prompt, answer => { if (hidden) process.stdout.write('\n'); rl.close(); resolve(answer); });
  muted = hidden;
});

const fail = message => { console.error(`\n✖ ${message}`); process.exit(1); };

if (!databaseEnabled) fail('DATABASE_URL is not set, so there is no user table to write to.');

const email = (await ask('Admin email: ')).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('That is not a valid email address.');

// Matches the signup and invite routes rather than being lenient here: a
// bootstrap account that the app itself would refuse to let in is not useful.
const domain = process.env.ALLOWED_DOMAIN;
if (domain && !email.endsWith(`@${domain}`)) fail(`ALLOWED_DOMAIN is set to ${domain}, so this address could not sign in.`);

const existing = await findUserByEmail(email);

if (existing) {
  if (existing.role === 'admin') {
    console.log(`\n${email} is already an administrator. Nothing to do.`);
    process.exit(0);
  }
  const confirm = (await ask(`\n${email} already has an account. Promote it to admin? [y/N] `)).trim().toLowerCase();
  if (confirm !== 'y') fail('Cancelled. Nothing was changed.');
  await updateUserAccess(existing.id, { role: 'admin', status: 'active' });
  console.log(`\n✔ ${email} is now an administrator.`);
  process.exit(0);
}

const displayName = (await ask('Full name: ')).trim();
if (displayName.length < 2 || displayName.length > 100) fail('Enter a name between 2 and 100 characters.');

const password = await ask('Password (input hidden): ', { hidden: true });
const again = await ask('Confirm password: ', { hidden: true });
if (password !== again) fail('The two passwords do not match.');

// The same policy the signup route enforces, so this cannot quietly create a
// weaker credential than the app would otherwise accept.
const weak = passwordProblem(password, { email, name: displayName });
if (weak) fail(weak);

const user = await createPasswordUser({ email, displayName, passwordHash: await bcrypt.hash(password, 12) });
await updateUserAccess(user.id, { role: 'admin', status: 'active' });
await query('SELECT 1');

console.log(`\n✔ Created ${email} as an administrator.`);
console.log('  Sign in at the app, then add the rest of the team from Admin → Users.');
process.exit(0);

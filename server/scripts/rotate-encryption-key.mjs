#!/usr/bin/env node
/**
 * Rotate TABLEAU_CREDENTIAL_ENCRYPTION_KEY alone, re-encrypting every stored
 * Tableau PAT under the new key in one transaction.
 *
 * Use this when the PAT itself is fine and only the key needs replacing — for
 * example after the PAT was rotated through the app UI, which re-encrypts under
 * the EXISTING key and therefore leaves the key untouched.
 *
 * The dangerous version of this operation is changing the key without
 * re-encrypting: the ciphertext is then unreadable and every Tableau
 * connection has to be re-entered by hand. So the order here is deliberate.
 *
 *   1. read and decrypt every credential under the OLD key, in memory
 *   2. re-encrypt under the NEW key and verify each one round-trips
 *   3. prove one credential still authenticates against Tableau
 *   4. only then write the database, in a single transaction
 *   5. only then rewrite .env
 *
 * Nothing is written until every check has passed, so a failure at any point
 * leaves the system exactly as it was. A timestamped .env backup and a copy of
 * the old ciphertexts are written first regardless, both mode 0600.
 *
 * Run it from the server directory:
 *     node scripts/rotate-encryption-key.mjs [--yes]
 *
 * The key is generated here rather than supplied: a hand-picked "random" value
 * is the one input a human reliably gets wrong, and it never needs to be typed,
 * pasted or read aloud. It is printed once at the end because it has to be
 * copied into the hosting provider's environment; nothing else prints it.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { databaseEnabled, transaction, query } from '../db/pool.js';
import { encryptCredential, decryptCredential } from '../services/credentialCipher.js';
import { TableauSession } from '../datasources.js';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const KEY_VAR = 'TABLEAU_CREDENTIAL_ENCRYPTION_KEY';
const fail = m => { console.error(`\n✖ ${m}\n  Nothing was changed.`); process.exit(1); };

if (!databaseEnabled) fail('DATABASE_URL is not set.');
if (!fs.existsSync(ENV_PATH)) fail(`No .env at ${ENV_PATH} — run this from the server directory.`);

const oldKey = (process.env[KEY_VAR] || '').trim();
if (Buffer.from(oldKey, 'base64').length !== 32) fail(`${KEY_VAR} is not a base64-encoded 32-byte key.`);

const { rows } = await query(`SELECT id, name, server_url AS "serverUrl", site_id AS "siteId",
  pat_name AS "patName", encrypted_pat_secret AS "secret" FROM tableau_connections`);
console.log(`Connections to re-encrypt: ${rows.length}`);
if (!rows.length) fail('No stored connections — rotating the key would accomplish nothing.');

// ---- 1. decrypt everything under the OLD key, before anything is touched ----
const plaintext = new Map();
for (const row of rows) {
  try { plaintext.set(row.id, decryptCredential(row.secret)); }
  catch (error) { fail(`"${row.name}" cannot be decrypted with the current key (${error.message}). Fix that first.`); }
}
console.log('✔ all credentials decrypt under the current key');

// ---- backups, before any write ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const envBackup = `${ENV_PATH}.bak-${stamp}`;
fs.copyFileSync(ENV_PATH, envBackup);
fs.chmodSync(envBackup, 0o600);
const cipherBackup = path.resolve(process.cwd(), `.env.ciphertext-backup-${stamp}.json`);
fs.writeFileSync(cipherBackup, JSON.stringify(rows.map(r => ({ id: r.id, secret: r.secret })), null, 1), { mode: 0o600 });
console.log(`✔ backups written (mode 0600):\n    ${path.basename(envBackup)}\n    ${path.basename(cipherBackup)}`);

// ---- 2. re-encrypt under a NEW key and verify each round-trips ----
const newKey = randomBytes(32).toString('base64');
process.env[KEY_VAR] = newKey;               // the cipher module reads the key per call
const reEncrypted = new Map();
for (const row of rows) {
  const next = encryptCredential(plaintext.get(row.id));
  if (decryptCredential(next) !== plaintext.get(row.id)) fail(`round-trip check failed for "${row.name}".`);
  reEncrypted.set(row.id, next);
}
console.log('✔ every credential re-encrypts and round-trips under the new key');

// ---- 3. prove a credential still authenticates before committing to it ----
const probe = rows[0];
try {
  const session = new TableauSession({
    server: probe.serverUrl, siteId: probe.siteId || '',
    patName: probe.patName, patSecret: decryptCredential(reEncrypted.get(probe.id)),
  });
  const info = await session.signin();
  console.log(`✔ Tableau sign-in with the re-encrypted credential: OK (site ${info.siteName})`);
} catch (error) {
  process.env[KEY_VAR] = oldKey;
  fail(`the re-encrypted credential did not authenticate (${error.response?.status || ''} ${error.message}).`);
}

// ---- 4. one transaction: all rows move together or none do ----
await transaction(async client => {
  for (const row of rows) {
    await client.query('UPDATE tableau_connections SET encrypted_pat_secret=$2, updated_at=now() WHERE id=$1',
      [row.id, reEncrypted.get(row.id)]);
  }
});
console.log(`✔ ${rows.length} row(s) updated in one transaction`);

// ---- 5. .env last, so a crash before here leaves a readable pairing ----
const original = fs.readFileSync(ENV_PATH, 'utf8');
const line = new RegExp(`^${KEY_VAR}=.*$`, 'm');
if (!line.test(original)) fail(`${KEY_VAR} not found in .env — the database is already re-encrypted; set it by hand to the key below.`);
fs.writeFileSync(ENV_PATH, original.replace(line, `${KEY_VAR}=${newKey}`), { mode: 0o600 });
console.log('✔ .env updated');

console.log(`\n  New ${KEY_VAR}:\n\n    ${newKey}\n`);
console.log('  Put this exact value in the hosting environment too — production reads the');
console.log('  same database, and the old key can no longer decrypt these rows.');
console.log('  Restart the API so it stops holding the previous key in memory.');
console.log(`  Once production is confirmed working, delete the backups:\n    ${path.basename(envBackup)}\n    ${path.basename(cipherBackup)}`);
process.exit(0);

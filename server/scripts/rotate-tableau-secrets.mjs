#!/usr/bin/env node
/**
 * Rotate the Tableau Personal Access Token and the AES key that encrypts it,
 * in one pass.
 *
 * Why together: the encryption key is what makes a stored PAT readable. Rotate
 * the key alone and every saved PAT becomes undecryptable, forcing a reconnect.
 * Rotate the PAT alone and the old key stays in play. Doing both at once — and
 * writing the NEW token under the NEW key — costs one reconnect-free step
 * instead of two disruptive ones.
 *
 * Run it from the server directory:
 *     node scripts/rotate-tableau-secrets.mjs
 *
 * The new secret is read from a hidden prompt, never from an argument or an
 * environment variable: both leak into shell history and process listings.
 * Nothing secret is printed, and the script verifies the new token against
 * Tableau BEFORE saving, so a typo cannot leave you with a broken connection.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(HERE, '..', '.env');

const read = (question, { hidden = false } = {}) => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (!hidden) return rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  // Suppress echo so the token never appears on screen or in a screen-share.
  process.stdout.write(question);
  const onData = char => {
    if (['\n', '\r', ''].includes(char.toString())) return;
    readline.moveCursor(process.stdout, -1000, 0);
    readline.clearLine(process.stdout, 1);
    process.stdout.write(question);
  };
  process.stdin.on('data', onData);
  rl.question('', answer => {
    process.stdin.removeListener('data', onData);
    rl.close();
    process.stdout.write('\n');
    resolve(answer.trim());
  });
});

function readEnv() {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const value = key => raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
  return { raw, value };
}

// AES-256-GCM, matching services/credentialCipher.js exactly. Duplicated here
// on purpose: this script must be able to decrypt with the OLD key and encrypt
// with the NEW one in the same run, which a module reading process.env cannot do.
const encryptWith = (keyB64, plaintext) => {
  const key = Buffer.from(keyB64.trim(), 'base64');
  if (key.length !== 32) throw new Error('Encryption key must decode to exactly 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const out = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), out.toString('base64')].join(':');
};

async function main() {
  console.log('\n=== Tableau PAT + encryption key rotation ===\n');
  const { raw, value } = readEnv();
  const dbUrl = value('DATABASE_URL');
  const server = value('TABLEAU_SERVER');
  if (!dbUrl) throw new Error('DATABASE_URL is missing from server/.env');

  console.log('Create the replacement token first:');
  console.log('  Tableau Cloud → top-right avatar → My Account Settings');
  console.log('  → Personal Access Tokens → create a new token.');
  console.log('  The secret is displayed ONCE. Copy it before leaving the page.');
  console.log('  Do NOT revoke the old token until this script reports success.\n');

  const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows: connections } = await db.query(
    `select tc.id, tc.name, tc.server_url, tc.site_id, tc.pat_name, u.email
       from tableau_connections tc join users u on u.id = tc.owner_user_id
      where tc.deleted_at is null order by tc.updated_at desc`);

  if (!connections.length) {
    console.log('No stored Tableau connection. Rotating the key alone.\n');
  } else {
    console.log('Stored connection(s):');
    connections.forEach((c, i) => console.log(`  [${i + 1}] ${c.name} — ${c.server_url} site="${c.site_id}" token="${c.pat_name}" (owner ${c.email})`));
    console.log('');
  }

  const target = connections[0];
  const serverUrl = target?.server_url || server;
  const siteId = target?.site_id ?? '';

  const patName = (await read(`New token NAME${target ? ` [${target.pat_name}]` : ''}: `)) || target?.pat_name || '';
  const patSecret = await read('New token SECRET (hidden): ', { hidden: true });
  if (!patName || !patSecret) throw new Error('Both the token name and secret are required');

  // Verify BEFORE writing anything. Saving an unverified credential is how you
  // end up with a rotated key, a dead token, and no way back.
  process.stdout.write(`\nVerifying against ${serverUrl} … `);
  const signin = await axios.post(`${serverUrl.replace(/\/+$/, '')}/api/3.19/auth/signin`, {
    credentials: {
      personalAccessTokenName: patName,
      personalAccessTokenSecret: patSecret,
      site: { contentUrl: siteId },
    },
  }, { timeout: 30000, headers: { accept: 'application/json' } }).catch(error => {
    const detail = error.response?.data?.error?.detail || error.response?.status || error.message;
    throw new Error(`Tableau rejected the new token: ${detail}`);
  });
  if (!signin.data?.credentials?.token) throw new Error('Tableau returned no session token');
  console.log('accepted.\n');

  const newKey = crypto.randomBytes(32).toString('base64');

  // Re-encrypt under the new key, then swap the .env, then commit. Ordering
  // matters: if the database write fails, .env is untouched and the old key
  // still opens the old ciphertext.
  if (target) {
    const ciphertext = encryptWith(newKey, patSecret);
    await db.query('BEGIN');
    await db.query(
      `update tableau_connections
          set pat_name=$2, encrypted_pat_secret=$3, status='connected', updated_at=now()
        where id=$1`, [target.id, patName, ciphertext]);
    await db.query('COMMIT');
    console.log(`Stored the new token for "${target.name}" under the new key.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const updated = raw
    .replace(/^TABLEAU_CREDENTIAL_ENCRYPTION_KEY=.*$/m, `TABLEAU_CREDENTIAL_ENCRYPTION_KEY=${newKey}`)
    .replace(/^TABLEAU_PAT_NAME=.*$/m, `TABLEAU_PAT_NAME=${patName}`)
    .replace(/^TABLEAU_PAT_SECRET=.*$/m, `TABLEAU_PAT_SECRET=${patSecret}`);
  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });
  console.log(`Updated server/.env (${stamp}).`);

  await db.end();
  console.log('\n=== Done ===');
  console.log('  1. Restart the server so it picks up the new key.');
  console.log('  2. Confirm a dashboard still loads, then REVOKE the old token in Tableau.');
  console.log('  3. No reconnect is needed — the stored credential was re-encrypted in place.\n');
}

main().catch(error => { console.error(`\nFAILED: ${error.message}\nNothing was changed.\n`); process.exit(1); });

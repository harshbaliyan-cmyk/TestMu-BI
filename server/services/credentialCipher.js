import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  // Trimmed because a stray space or newline around the value in a .env file
  // is invisible in an editor but changes the string. Base64 decoding happens
  // to ignore surrounding whitespace, so this is defence in depth rather than
  // a behaviour change — it keeps a copy-paste artefact from ever mattering.
  const encoded = (process.env.TABLEAU_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  const key = Buffer.from(encoded, 'base64');
  // The message never echoes the value: an error string is the one place a
  // secret reliably ends up in logs, tickets and screenshots.
  if (key.length !== 32) throw new Error('TABLEAU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

export function encryptCredential(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptCredential(payload) {
  const [version, iv, tag, encrypted] = String(payload || '').split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Stored Tableau credential has an invalid format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

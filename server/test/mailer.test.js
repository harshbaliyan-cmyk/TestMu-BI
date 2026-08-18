import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSecurityNotification, redactEmail, mailConfigured } from '../services/mailer.js';

test('recipients are redacted before they reach our own logs', () => {
  // Enough to tell two accounts apart while operating the system; not enough
  // to rebuild the address list the log cleanup just removed.
  assert.equal(redactEmail('harshbaliyan@lambdatest.com'), 'h***@lambdatest.com');
  assert.equal(redactEmail('a@b.co'), 'a***@b.co');
  assert.equal(redactEmail('not-an-address'), '[REDACTED]');
  assert.equal(redactEmail(''), '[REDACTED]');
  assert.equal(redactEmail(null), '[REDACTED]');
});

test('notification never throws when SMTP is unconfigured', async () => {
  // The security action has already happened by the time this runs. Throwing
  // here would report failure for a change that succeeded.
  assert.equal(mailConfigured, Boolean(process.env.SMTP_HOST));
  const result = await sendSecurityNotification({
    to: 'someone@example.com', event: 'password_changed', context: { ip: '::1' },
  });
  assert.equal(result.sent, false);
  assert.ok(['not_configured', 'send_failed'].includes(result.reason));
});

test('notification resolves rather than rejecting for bad input', async () => {
  assert.deepEqual(await sendSecurityNotification({ to: 'x@y.z', event: 'no_such_event' }),
    { sent: false, reason: 'unknown_event' });
  assert.deepEqual(await sendSecurityNotification({ to: '', event: 'password_changed' }),
    { sent: false, reason: 'no_recipient' });
});

test('no template leaks a credential', async () => {
  // Every message body is checked for the words that would indicate a secret
  // travelling by email. The temporary-password templates specifically must
  // say the password is NOT enclosed.
  const { default: mod } = await import('node:fs');
  const source = mod.readFileSync(new URL('../services/mailer.js', import.meta.url), 'utf8');
  const templateBlock = source.slice(source.indexOf('const TEMPLATES'), source.indexOf('export async function sendSecurityNotification'));
  // No interpolation of anything password- or token-shaped into a body.
  assert.equal(/\$\{ctx\.(password|temporaryPassword|token|secret|hash)/.test(templateBlock), false,
    'a template interpolates a credential into the message body');
  assert.match(templateBlock, /not included in this email/);
  assert.match(templateBlock, /not sent by email/);
});

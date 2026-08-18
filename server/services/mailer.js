import nodemailer from 'nodemailer';

// Out-of-band notification for security-sensitive account events.
//
// The point is not convenience — it is that an attacker who takes over a
// session can change the password, and the real owner has no way to find out.
// A message to the address on file reaches the owner through a channel the
// attacker does not control, which is what turns a silent takeover into a
// noticed one.
//
// Three rules shape everything below:
//
//   1. Delivery NEVER blocks or fails the security action. A password change
//      that succeeded must not report failure because an SMTP host was down;
//      the change has already happened, and telling the user otherwise would
//      make them retry a thing that already worked.
//   2. Nothing sensitive travels in the message. No password, no temporary
//      password, no token, no session ID. Email is not a confidential channel:
//      it sits in transit logs, on relay servers and in mailbox backups. A
//      credential mailed is a credential published.
//   3. Recipients are redacted in our own logs, so operating the mail path
//      does not quietly rebuild the address list we just took out of the logs.

const SMTP_HOST = process.env.SMTP_HOST || '';
const MAIL_FROM = process.env.MAIL_FROM || 'TestMu BI <no-reply@localhost>';
const APP_NAME = 'TestMu BI';

export const mailConfigured = Boolean(SMTP_HOST);

let transport = null;
let warnedUnconfigured = false;

function getTransport() {
  if (!mailConfigured) return null;
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // STARTTLS on 587 is the norm; implicit TLS on 465 needs secure:true.
    secure: String(process.env.SMTP_SECURE || '') === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
  return transport;
}

// "harsh@lambdatest.com" -> "h***@lambdatest.com". Enough to tell which of two
// accounts a line refers to while operating the system; not enough to harvest.
export function redactEmail(address) {
  const [local, domain] = String(address || '').split('@');
  if (!domain) return '[REDACTED]';
  return `${local.slice(0, 1)}***@${domain}`;
}

const when = () => new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// Each template states plainly what happened and what to do if it was not you.
// Deliberately free of links: a security notice that trains people to click
// links in emails about their password is a phishing lesson, not a safeguard.
const TEMPLATES = {
  password_changed: ctx => ({
    subject: `${APP_NAME}: your password was changed`,
    text: `Your ${APP_NAME} password was changed on ${when()}.

All other sessions on your account were signed out.

If this was you, nothing further is needed.

If it was NOT you, someone else has access to your account. Contact your
administrator immediately — they can reset your password and disable the
account while you investigate.
${ctx.ip ? `\nRequest origin: ${ctx.ip}` : ''}`,
  }),

  password_reset_by_admin: ctx => ({
    subject: `${APP_NAME}: an administrator reset your password`,
    text: `An administrator reset your ${APP_NAME} password on ${when()}.

Every session on your account was signed out, and you will need a new
temporary password to sign in. Your administrator${ctx.actor ? ` (${ctx.actor})` : ''} will give it
to you directly — for your safety it is not sent by email, and you will be
asked to choose your own password immediately after signing in.

If you were not expecting this, speak to your administrator before signing in.`,
  }),

  account_created: ctx => ({
    subject: `${APP_NAME}: an account has been created for you`,
    text: `An account was created for you on ${APP_NAME} at ${when()}${ctx.actor ? ` by ${ctx.actor}` : ''}.

Your temporary password is not included in this email. Your administrator will
give it to you directly. You will be asked to choose your own password before
you can use the dashboards.

If you were not expecting this, you can ignore this message and tell your
administrator.`,
  }),

  account_deleted: () => ({
    subject: `${APP_NAME}: your account was deleted`,
    text: `Your ${APP_NAME} account was deleted on ${when()}.

Your sign-in details, saved views and dashboard preferences have been removed.
Security and access logs are kept but no longer identify you.

If you did not expect this, contact your administrator — this cannot be undone
from your side.`,
  }),
};

/**
 * Fire-and-forget. Always resolves; never rejects, never throws.
 * Returns {sent, reason} so callers may log the outcome, not act on it.
 */
export async function sendSecurityNotification({ to, event, context = {} }) {
  const build = TEMPLATES[event];
  if (!build) return { sent: false, reason: 'unknown_event' };
  if (!to) return { sent: false, reason: 'no_recipient' };

  if (!mailConfigured) {
    // Said once per process, not per event: a missing SMTP host is a
    // deployment gap to fix, not a per-request error to drown the log in.
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[mail] SMTP_HOST is not set — security notifications are disabled. '
        + 'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD to enable them.');
    }
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const { subject, text } = build(context);
    await getTransport().sendMail({ from: MAIL_FROM, to, subject, text });
    console.log(`[mail] sent "${event}" to ${redactEmail(to)}`);
    return { sent: true };
  } catch (error) {
    // Logged, never rethrown. The security action already completed; failing
    // the request now would tell the user it did not.
    console.error(`[mail] could not send "${event}" to ${redactEmail(to)}: ${error.message}`);
    return { sent: false, reason: 'send_failed' };
  }
}

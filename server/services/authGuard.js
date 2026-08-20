import bcrypt from 'bcryptjs';

// Brute-force protection for the credential endpoints.
//
// Two independent counters, because they stop different attacks:
//   - per IP    → one host spraying many accounts ("password spraying")
//   - per email → many hosts hammering one account (distributed guessing)
// Either tripping is enough to refuse, so an attacker cannot dodge the limit
// by rotating one dimension while holding the other fixed.
//
// State is in-process, which is the right trade for a single-instance
// deployment and degrades safely (a restart forgives attempts) but does NOT
// span replicas. Behind more than one instance this must move to Postgres or
// Redis — see SECURITY.md.

const IP_MAX_ATTEMPTS = Number(process.env.AUTH_IP_MAX_ATTEMPTS || 20);
const EMAIL_MAX_ATTEMPTS = Number(process.env.AUTH_EMAIL_MAX_ATTEMPTS || 5);
const WINDOW_MS = Number(process.env.AUTH_WINDOW_MINUTES || 15) * 60 * 1000;
const LOCKOUT_MS = Number(process.env.AUTH_LOCKOUT_MINUTES || 15) * 60 * 1000;

const buckets = new Map();

function bucket(key) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now > existing.resetAt) {
    const fresh = { count: 0, resetAt: now + WINDOW_MS, lockedUntil: 0 };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

// Unbounded Maps are a memory-exhaustion vector when the key is attacker
// controlled (every distinct email or spoofed forwarded-IP mints an entry),
// so expired buckets are swept opportunistically.
function sweep() {
  if (buckets.size < 5000) return;
  const now = Date.now();
  for (const [key, value] of buckets) {
    if (now > value.resetAt && now > value.lockedUntil) buckets.delete(key);
  }
}

export function authAttemptStatus(ip, email) {
  const now = Date.now();
  for (const key of [`ip:${ip}`, `email:${String(email || '').toLowerCase()}`]) {
    const entry = buckets.get(key);
    if (entry && now < entry.lockedUntil) {
      return { blocked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
  }
  return { blocked: false };
}

export function recordAuthFailure(ip, email) {
  sweep();
  const targets = [
    [`ip:${ip}`, IP_MAX_ATTEMPTS],
    [`email:${String(email || '').toLowerCase()}`, EMAIL_MAX_ATTEMPTS],
  ];
  for (const [key, max] of targets) {
    const entry = bucket(key);
    entry.count += 1;
    if (entry.count >= max) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

export function clearAuthFailures(ip, email) {
  buckets.delete(`ip:${ip}`);
  buckets.delete(`email:${String(email || '').toLowerCase()}`);
}

// A bcrypt hash of a value no one can produce. Comparing against this when the
// email is unknown makes the "no such user" path cost the same as the "wrong
// password" path; otherwise the response time alone tells an attacker which
// addresses hold accounts, which is the enumeration oracle that generic error
// text is meant to close.
const DUMMY_HASH = bcrypt.hashSync('login-timing-equalizer-not-a-real-password', 12);

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

// Length is the dominant factor in password strength, but a 10-character
// single-class string ("aaaaaaaaaa") clears a naive length rule while being
// trivially guessable. Require either real length or genuine variety, and
// reject the handful of patterns that dictionary attacks try first.
const COMMON = [
  'password', 'passw0rd', 'welcome', 'qwerty', 'letmein', 'admin123',
  'changeme', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'sunshine', 'princess', 'trustno1', 'testmu', 'lambdatest',
];

export function passwordProblem(password, { email = '', name = '' } = {}) {
  const value = String(password || '');
  if (value.length < 12) return 'Password must contain at least 12 characters';
  if (value.length > 200) return 'Password must be 200 characters or fewer';

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  if (value.length < 16 && classes < 3) {
    return 'Use at least three of: lowercase, uppercase, numbers, symbols — or make it 16+ characters';
  }
  const lower = value.toLowerCase();
  if (COMMON.some(word => lower.includes(word))) return 'That password is too easy to guess';
  if (/^(.)\1+$/.test(value)) return 'That password is too easy to guess';

  // A password containing the account it protects is worthless once the
  // address leaks, and addresses leak constantly.
  const localPart = String(email).split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && lower.includes(localPart)) {
    return 'Password must not contain your email address';
  }
  for (const part of String(name).toLowerCase().split(/\s+/).filter(p => p.length >= 3)) {
    if (lower.includes(part)) return 'Password must not contain your name';
  }
  return null;
}

export const AUTH_LIMITS = { IP_MAX_ATTEMPTS, EMAIL_MAX_ATTEMPTS, WINDOW_MS, LOCKOUT_MS };

// ===== ACCOUNT-CREATION AND ADMIN POLICY =====
//
// Both of these were inline in server.js, where nothing could reach them: the
// module starts a listener on import, so a test cannot load it. They are the
// two rules that decide who gets in and who is privileged, which makes them
// the last things that should be untestable.

// Self-service signup is OFF unless explicitly enabled.
//
// The signup route used to accept any address that ended in ALLOWED_DOMAIN and
// hand back a session immediately. A domain suffix is not proof of ownership —
// it is a string check anyone can satisfy by typing — and there is no email
// verification in this system to stand behind it: no token table, no verified
// flag, and SMTP unconfigured. Until address ownership is actually proven,
// accounts come from an administrator.
export const selfSignupAllowed = (env = process.env) => env.ALLOW_SELF_SIGNUP === 'true';

// Admin is the ROLE on the user record, and nothing else.
//
// This used to also accept any session whose email appeared in ADMIN_EMAILS,
// which made an env var a live authorization check against a value the caller
// chooses. Combined with open signup, guessing a listed address that had not
// registered yet was enough to become an administrator; only registration
// order prevented it, and registration order is not a security control.
//
// ADMIN_EMAILS still bootstraps the role when an account is CREATED. Granting
// is a write, not a check.
export const isAdminSession = session => session?.role === 'admin';

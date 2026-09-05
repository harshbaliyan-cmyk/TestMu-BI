import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { OAuth2Client } from 'google-auth-library';
import { createDataSourceRouter , DASHBOARD_FIELD_SETS } from './datasources.js';
import { createChartRouter, createCustomDashboardRouter } from './chartRoutes.js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { databaseEnabled, pool, closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { randomBytes } from 'node:crypto';
import {
  upsertUser, findUserByEmail, createPasswordUser, markLogin,
  findUserById, listUsers, setPassword, createInvitedUser, updateUserAccess,
  countOtherActiveAdmins, revokeOtherSessions, deleteUserData,
} from './repositories/users.js';
import { getDashboardState, saveDashboardState } from './repositories/dashboardState.js';
import { logSourceAccess, logAudit } from './repositories/activityLogs.js';
import {
  authAttemptStatus, recordAuthFailure, clearAuthFailures, verifyPassword, passwordProblem,
  selfSignupAllowed, isAdminSession,
} from './services/authGuard.js';
import { sendSecurityNotification } from './services/mailer.js';
import { listSavedContent, createSavedContent, deleteSavedContent } from './repositories/savedContent.js';
import { createShareToken, listShareTokens, revokeShareToken, resolveShareToken } from './repositories/shareTokens.js';
import { listAdminLogs, cleanupOldRecords } from './repositories/adminLogs.js';
import { buildWinBoardSnapshot } from './services/winBoardMetrics.js';
import { buildProductPipelineSnapshot, buildProductWonSnapshot } from './services/productViewMetrics.js';
import { buildExecutiveSnapshot } from './services/executiveMetrics.js';
import { buildOpportunitySnapshot } from './services/opportunityMetrics.js';
import { buildLossBoardSnapshot } from './services/lossBoardMetrics.js';
import { buildAePerformanceSnapshot, isAmRow } from './services/aePerformanceMetrics.js';
import { getMappedSourceColumn } from './repositories/dataSources.js';
import { buildGenericComparison } from './services/periodComparison.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
const oAuth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const GOOGLE_AUTH_ENABLED = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'mock');

// ===== CACHE LAYER =====
const cache = new Map();
const runtimeSourceRows = new Map();
const runtimeDashboardSources = new Map();

const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours (longer than 1-day sync interval)

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, fetchedAt: Date.now() });
}

// ===== TENANT ISOLATION =====
// Business rows live in this process's memory, and every cache entry that
// holds them is namespaced by the owning user. Previously the dashboard cache
// was keyed by template alone, so the rows one user connected were served to
// every other signed-in user: the data_sources table scoped ownership
// correctly, but the in-memory rows those sources produced had no owner at
// all. Anyone with an account could read everyone's pipeline.
//
// Read paths must therefore never take a bare template key. They take the
// session's userId, and a user with no sources of their own sees an empty
// dashboard rather than somebody else's.
const userScope = (userId, templateId) => `u:${userId ?? 'anonymous'}:${templateId}`;

// Win Board and Loss Board both read live Tableau opportunity data that may
// be mapped independently of (and more sparsely than) the Opportunity
// Analytics source — this backfills any of these fields left blank on a row
// from the same Opportunity ID's Opportunity Analytics record, when present.
const DASHBOARDS_WITH_OPPORTUNITY_ENRICHMENT = new Set(['win-board', 'loss-board', 'ae-performance', 'am-performance']);
function dashboardRows(userId, key) {
  const rows = cacheGet(userScope(userId, key)) || [];
  if (!DASHBOARDS_WITH_OPPORTUNITY_ENRICHMENT.has(key) || !rows.length) return rows;
  // Enrichment reads the SAME user's Opportunity Analytics rows. Crossing the
  // scope here would reintroduce the leak through the back door.
  const opportunityRows = cacheGet(userScope(userId, 'opportunity-analytics')) || [];
  if (!opportunityRows.length) return rows;
  const byOpportunityId = new Map(opportunityRows.map(row => [String(row.id || '').trim(), row]));
  const supplementalFields = ['type','region','continentGroup','orgType','industry','pod','team','lossReason','trialStageAt'];
  return rows.map(row => {
    const peer = byOpportunityId.get(String(row.id || '').trim());
    if (!peer) return row;
    let enriched = row;
    for (const field of supplementalFields) {
      if (!enriched[field] && peer[field]) enriched = { ...enriched, [field]: peer[field] };
    }
    return enriched;
  });
}

// The RAW rows behind each source, exactly as parsed — before field mapping
// coerces them into the canonical opportunity shape. The chart builder binds
// to raw columns, so it reads these; the fixed dashboards keep reading the
// mapped rows. Same lifecycle as the mapped cache: filled on commit/refresh,
// gone on restart, rehydrated by the startup Tableau sweep.
const runtimeSourceRawData = new Map(); // sourceId -> { ownerUserId, headers, rows }

// ownerUserId is required, not optional: a source whose owner we cannot name
// has no scope to live in, and defaulting it to a shared bucket is exactly the
// bug this replaced. Callers all know the owner — the commit and delete routes
// from the session, the refresh path from the source's own record.
function setSourceRows(sourceId, dashboardKeys, rows, ownerUserId, raw = null) {
  if (!ownerUserId) throw new Error('setSourceRows requires the owning userId');
  runtimeSourceRows.set(sourceId, rows);
  if (raw) runtimeSourceRawData.set(sourceId, { ownerUserId, headers: raw.headers || [], rows: raw.rows || [] });
  dashboardKeys.forEach(key => {
    const scope = userScope(ownerUserId, key);
    if (!runtimeDashboardSources.has(scope)) runtimeDashboardSources.set(scope, new Set());
    runtimeDashboardSources.get(scope).add(sourceId);
    cacheSet(scope, [...runtimeDashboardSources.get(scope)].flatMap(id => runtimeSourceRows.get(id) || []));
  });
}

function removeSourceRows(sourceId, dashboardKeys, ownerUserId) {
  if (!ownerUserId) throw new Error('removeSourceRows requires the owning userId');
  runtimeSourceRows.delete(sourceId);
  runtimeSourceRawData.delete(sourceId);
  dashboardKeys.forEach(key => {
    const bound = runtimeDashboardSources.get(userScope(ownerUserId, key));
    if (!bound) return;
    bound.delete(sourceId);
    cacheSet(userScope(ownerUserId, key), [...bound].flatMap(id => runtimeSourceRows.get(id) || []));
  });
}

// Ownership is checked HERE, not left to the caller: raw rows are the most
// sensitive thing in this process, and every read path must prove the
// requesting user owns the source.
function getSourceRawData(sourceId, ownerUserId) {
  const entry = runtimeSourceRawData.get(sourceId);
  if (!entry || entry.ownerUserId !== ownerUserId) return null;
  return entry;
}

// ===== MIDDLEWARE =====
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Fail fast rather than boot insecurely. A missing or placeholder session
// secret means every cookie this process signs is forgeable by anyone who
// knows the default — which, for a value committed to a repo, is everyone.
if (IS_PRODUCTION) {
  const secret = process.env.SESSION_SECRET || '';
  const placeholder = /^(your-|change-?me|secret|local-development)/i.test(secret);
  if (secret.length < 32 || placeholder) {
    console.error('FATAL: SESSION_SECRET must be a unique random value of at least 32 characters in production.');
    process.exit(1);
  }
  if (!process.env.CLIENT_ORIGIN) {
    console.error('FATAL: CLIENT_ORIGIN must name the exact browser origin in production.');
    process.exit(1);
  }
}

// Secure cookies and per-IP rate limiting both depend on knowing the real
// client address. Behind a load balancer Express sees the proxy unless told
// how many hops to trust; trusting blindly (`true`) is worse than not
// trusting, since any client could then spoof X-Forwarded-For.
app.set('trust proxy', Number(process.env.TRUSTED_PROXY_HOPS || 0));
app.disable('x-powered-by');

// Response hardening. The API returns JSON only, so the CSP can be maximally
// restrictive — there is nothing legitimate for a browser to execute, frame,
// or load from an API response, and that is precisely what turns a reflected
// value into a stored-XSS vector.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cache-Control': 'no-store',
  });
  if (IS_PRODUCTION) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || (IS_PRODUCTION ? false : 'http://localhost:5173'),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '25mb' }));
const PgSession = connectPgSimple(session);
app.use(session({
  name: process.env.SESSION_COOKIE_NAME || 'testmu.sid',
  secret: process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'local-development-only-change-me'),
  ...(databaseEnabled ? { store: new PgSession({ pool, createTableIfMissing: true }) } : {}),
  resave: false,
  saveUninitialized: false,
  // Idle timeout: touching the session on each request slides the window, so
  // an unattended browser loses its session while an active user is not
  // logged out mid-task.
  rolling: true,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    // 'strict' would drop the cookie on any cross-site navigation into the
    // app (an emailed dashboard link lands logged-out). 'lax' keeps top-level
    // GET navigations working while still withholding the cookie from
    // cross-site POSTs, which is the CSRF case that matters here.
    sameSite: 'lax',
    maxAge: Number(process.env.SESSION_MAX_AGE_HOURS || 8) * 60 * 60 * 1000,
  },
}));

// ===== AUTH =====
// req.ip is only trustworthy once Express is told how many proxies sit in
// front (see `trust proxy` below); without that a client can forge
// X-Forwarded-For and give itself a fresh rate-limit bucket per request.
const clientIp = req => req.ip || req.socket?.remoteAddress || 'unknown';

// Auth attempts are security-relevant events and belong in the audit trail
// whether or not they succeed — a burst of failures is the signal that someone
// is being attacked. Never log the password, and never fail the request
// because logging failed.
async function logAuthEvent({ email, action, req, outcome }) {
  try {
    await logAudit({
      userId: null, action, entityType: 'auth', entityId: null,
      // The address is bounded before storage: on a FAILED attempt this string
      // is whatever the caller posted, and the body limit is 25 MB. Storing it
      // is what makes "someone is being targeted" visible in the audit trail,
      // but it must not become an attacker-controlled write of arbitrary size.
      afterState: { email: String(email || '').slice(0, 254), outcome },
      ipAddress: clientIp(req),
      userAgent: String(req.get('user-agent') || '').slice(0, 200),
    });
  } catch { /* auditing must never block authentication */ }
}

function requireAuth(req, res, next) {
  if (!req.session?.email) return res.status(401).json({ error: 'Not authenticated' });
  // An admin-issued temporary password gets the holder exactly as far as
  // replacing it. Without this the "temporary" password is simply a working
  // password that two people know, for as long as the user ignores the prompt.
  if (req.session.mustChangePassword && req.path !== '/api/auth/change-password') {
    return res.status(403).json({ error: 'password_change_required' });
  }
  next();
}

// Policy lives in authGuard.isAdminSession — see there for why an email is no
// longer accepted in place of a role.
function requireAdmin(req, res, next) {
  if (!req.session?.email) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAdminSession(req.session)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ===== TV SHARE TOKENS =====
// A wall display has nobody to log in, so the /tv/:token route authenticates
// its READ calls with a share token in the X-Share-Token header instead of a
// session. A token is scoped to exactly one dashboard and one owner's data —
// requests for any other template are refused, and a revoked or expired token
// answers identically to a token that never existed. The grant deliberately
// lives on req.shareAuth, NEVER on req.session: writing to the session would
// mark it dirty and mint a real signed login cookie for the wall's browser,
// which is exactly the general-purpose bypass a share token must not become.
//
// Header, not query string, for the API calls: URLs end up in proxy and access
// logs, headers do not. (The /tv/:token page URL itself is the shareable
// artefact and carries the token by design.)
const allowShareToken = templateOf => async (req, res, next) => {
  if (req.session?.email) return requireAuth(req, res, next);
  try {
    const grant = await resolveShareToken(req.get('x-share-token'));
    if (!grant || grant.templateKey !== templateOf(req)) {
      return res.status(401).json({ error: 'This share link is invalid, revoked, or expired.' });
    }
    req.shareAuth = { userId: grant.userId, templateKey: grant.templateKey };
    next();
  } catch (error) { next(error); }
};
// Who the request reads data AS: the token's owner on a wall display, the
// signed-in user everywhere else. Only ever used on read paths.
const requesterId = req => req.shareAuth?.userId ?? req.session?.userId;

app.post('/api/auth/verify', async (req, res) => {
  try {
    if (!GOOGLE_AUTH_ENABLED) return res.status(503).json({ error: 'Google sign-in is not configured' });
    const { credential, intent = 'login' } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });
    const ticket = await oAuth2Client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload.email;
    const domain = process.env.ALLOWED_DOMAIN;
    if (domain && !email.endsWith(`@${domain}`)) return res.status(403).json({ error: `Only @${domain} emails allowed` });

    let user = await findUserByEmail(email);
    // Google has already proved the caller owns this address, so telling them
    // whether it has an account here reveals nothing they cannot confirm by
    // simply continuing — unlike the password endpoints, where the caller has
    // proved nothing. Both intents therefore resolve to the same session
    // rather than erroring, which also removes a pointless dead end.
    if (!user) user = null;
    if (!user) user = await upsertUser({
      email, googleSubject: payload.sub, displayName: payload.name, pictureUrl: payload.picture,
      role: (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim()).includes(email) ? 'admin' : 'user',
    });
    if (user.status === 'disabled') return res.status(403).json({ error: 'This account is disabled' });
    await markLogin(user.id);
    establishSession(req, res, user);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token', detail: err.message });
  }
});

// Policy lives in authGuard.selfSignupAllowed. Accounts are provisioned via
// POST /api/admin/users, which issues a temporary password and forces a change
// on first login; the first administrator comes from scripts/create-admin.mjs.
const SELF_SIGNUP_ENABLED = selfSignupAllowed();

app.post('/api/auth/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  // Refused before any lookup, and identically for every address, so this
  // cannot be used to tell a registered address from an unregistered one.
  if (!SELF_SIGNUP_ENABLED) {
    await logAuthEvent({ email, action: 'auth.signup', req, outcome: 'blocked' }).catch(() => {});
    return res.status(403).json({ error: 'Accounts are created by an administrator. Ask your admin for an invite.' });
  }
  try {
    const displayName = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const gate = authAttemptStatus(clientIp(req), email);
    if (gate.blocked) {
      res.set('Retry-After', String(gate.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (displayName.length < 2 || displayName.length > 100) return res.status(400).json({ error: 'Enter your name' });
    const weak = passwordProblem(password, { email, name: displayName });
    if (weak) return res.status(400).json({ error: weak });
    const domain = process.env.ALLOWED_DOMAIN;
    if (domain && !email.endsWith(`@${domain}`)) return res.status(403).json({ error: `Only @${domain} emails are allowed` });

    // Deliberately NOT "an account already exists": that reply turned this
    // endpoint into a free membership oracle — anyone could test an address
    // list and learn who has an account here. Signing up over an existing
    // address returns the same acknowledgement as a fresh one, and the real
    // owner is told out of band.
    if (await findUserByEmail(email)) {
      recordAuthFailure(clientIp(req), email);
      return res.status(202).json({ pending: true, message: 'Check your email to finish setting up this account.' });
    }
    const user = await createPasswordUser({ email, displayName, passwordHash: await bcrypt.hash(password, 12) });
    clearAuthFailures(clientIp(req), email);
    await logAuthEvent({ email, action: 'auth.signup', req, outcome: 'success' });
    establishSession(req, res, user);
  } catch (error) {
    // Never the raw error: a Postgres unique violation on this path carries
    // `detail: "Key (email)=(someone@example.com) already exists"`, which would
    // write the address of everyone who ever retried a signup into the log.
    console.error('[error] POST /api/auth/signup', safeError(error));
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const ip = clientIp(req);

  const gate = authAttemptStatus(ip, email);
  if (gate.blocked) {
    res.set('Retry-After', String(gate.retryAfterSeconds));
    await logAuthEvent({ email, action: 'auth.login', req, outcome: 'rate_limited' });
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const user = await findUserByEmail(email);
  // verifyPassword runs bcrypt even when the account does not exist, so an
  // unknown address and a wrong password take the same time and return the
  // same message. A disabled account is folded into the same reply for the
  // same reason: "this account is disabled" confirms the account exists.
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!ok || !user || user.status === 'disabled') {
    recordAuthFailure(ip, email);
    await logAuthEvent({ email, action: 'auth.login', req, outcome: 'failure' });
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  clearAuthFailures(ip, email);
  await markLogin(user.id);
  await logAuthEvent({ email, action: 'auth.login', req, outcome: 'success' });
  establishSession(req, res, user);
});

app.get('/api/auth/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_AUTH_ENABLED ? process.env.GOOGLE_CLIENT_ID : null,
    // So the form does not offer a door the server will refuse. The server is
    // still the gate — this only keeps the UI honest about it.
    selfSignupEnabled: SELF_SIGNUP_ENABLED,
  });
});

// The development login is deliberately gone. It minted an *admin* session for
// dev@localhost with no credential at all, so anyone who could reach the API
// — including anyone on the same network as a laptop running the dev server —
// held full administrative access. An env flag is not a sufficient guard for a
// credential-free admin door: flags get copied into the wrong environment.

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.email) return res.json(null);
  res.json({ id: req.session.userId, email: req.session.email, name: req.session.name,
    picture: req.session.picture, role: req.session.role || 'user',
    mustChangePassword: Boolean(req.session.mustChangePassword) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ===== TEMPLATES =====
const TEMPLATES = [
  {
    id: 'opportunity-analytics',
    name: 'Opportunity Analytics',
    description: 'Revenue funnel, win rates, rep performance',
    tags: ['Salesforce', '6 views'],
    fields: DASHBOARD_FIELD_SETS.opportunity,
  },
  {
    id: 'event-analytics',
    name: 'Event Analytics',
    description: 'Feature adoption, churn signals',
    tags: ['orgType', '4 views'],
    fields: DASHBOARD_FIELD_SETS.opportunity,
  },
  {
    id: 'tenant-health',
    name: 'Tenant Health',
    description: 'Account whitespace, expansion candidates',
    tags: ['HubSpot', '5 views'],
    fields: DASHBOARD_FIELD_SETS.opportunity,
  },
  {
    id: 'win-board',
    name: 'Win Board',
    description: 'Won ARR, ARR win rate, and contribution performance',
    tags: ['Tableau', 'Won ARR'],
    fields: DASHBOARD_FIELD_SETS.winBoard,
  },
  {
    id: 'loss-board',
    name: 'Loss Board',
    description: 'Where business is being lost — ARR lost rate, loss reasons, and lost-after-trial',
    tags: ['Tableau', 'Lost ARR'],
    fields: DASHBOARD_FIELD_SETS.lossBoard,
  },
  {
    id: 'product-view',
    name: 'Product View',
    description: 'Pipeline by created date and Won ARR by close date, split by product',
    tags: ['Tableau', '2 views'],
    fields: DASHBOARD_FIELD_SETS.productView,
  },
  {
    id: 'executive-dashboard',
    name: 'Executive Dashboard',
    description: 'Quota attainment, pipeline coverage, forecast and trials — the current quarter at a glance',
    tags: ['Tableau', 'Exec'],
    fields: DASHBOARD_FIELD_SETS.executive,
  },
  {
    id: 'am-performance',
    name: 'AM Performance',
    description: 'AM rep ranking by % of quota achieved, with POD attainment',
    tags: ['Tableau', 'Quota'],
    fields: DASHBOARD_FIELD_SETS.repQuota,
  },
  {
    id: 'ae-performance',
    name: 'AE Performance',
    description: 'AE rep ranking by share of closed ARR, with period comparison',
    tags: ['Tableau', 'ARR Contribution'],
    fields: DASHBOARD_FIELD_SETS.repQuota,
  },
];

app.get('/api/templates', requireAuth, (req, res) => {
  res.json(TEMPLATES);
});

// Create/list/revoke are session-only: the token IS the wall's credential, so
// managing tokens must never be possible with one. The raw token is returned
// exactly once, at creation — only its hash is stored.
app.post('/api/share-tokens', requireAuth, async (req, res, next) => {
  try {
    const templateKey = String(req.body?.templateId || '') || null;
    const customDashboardId = String(req.body?.customDashboardId || '') || null;
    if (templateKey && !TEMPLATES.some(t => t.id === templateKey)) {
      return res.status(400).json({ error: 'Unknown dashboard' });
    }
    if (Boolean(templateKey) === Boolean(customDashboardId)) {
      return res.status(400).json({ error: 'Pass exactly one of templateId or customDashboardId' });
    }
    const label = String(req.body?.label || '').slice(0, 100) || null;
    const days = Number(req.body?.expiresDays);
    const expiresAt = Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    // Ownership of a custom dashboard is enforced inside createShareToken —
    // its INSERT only matches the caller's own, undeleted dashboard.
    const created = await createShareToken({ userId: req.session.userId, templateKey, customDashboardId, label, expiresAt });
    await logAudit({ userId: req.session.userId, action: 'share_token.created', entityType: 'share_token',
      entityId: created.id, afterState: { templateKey, customDashboardId, label, expiresAt } });
    res.status(201).json(created);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.get('/api/share-tokens', requireAuth, async (req, res, next) => {
  try { res.json({ items: await listShareTokens(req.session.userId) }); } catch (error) { next(error); }
});

app.delete('/api/share-tokens/:id', requireAuth, async (req, res, next) => {
  try {
    const revoked = await revokeShareToken(req.session.userId, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'No such active share link' });
    await logAudit({ userId: req.session.userId, action: 'share_token.revoked', entityType: 'share_token',
      entityId: req.params.id });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// Public: tells the /tv/:token page which dashboard to render. A valid token
// learns its own target and nothing else; an invalid one learns nothing.
app.get('/api/share/resolve', async (req, res, next) => {
  try {
    const grant = await resolveShareToken(req.get('x-share-token'));
    if (!grant) return res.status(401).json({ error: 'This share link is invalid, revoked, or expired.' });
    res.json({ templateKey: grant.templateKey, customDashboardId: grant.customDashboardId });
  } catch (error) { next(error); }
});

// The generic six-tab board (Opportunity Analytics and any template without
// its own service) reads ONE computed snapshot instead of every row: the
// math lives in services/opportunityMetrics.js where it is unit-tested and
// verifiable against the raw source, and the payload is a few hundred KB
// where the row feed was tens of MB on the real 55k-row source.
app.get('/api/dashboards/:templateId/snapshot', allowShareToken(req => req.params.templateId), (req, res) => {
  const snapshot = buildOpportunitySnapshot(dashboardRows(requesterId(req), req.params.templateId), req.query);
  res.json(snapshot);
  logSourceAccess({ userId: requesterId(req), dashboardKey: req.params.templateId,
    action: 'dashboard.snapshot.read', rowCount: snapshot.rowCount,
    details: { filtered: Object.keys(req.query).length > 0, viaShareToken: Boolean(req.shareAuth) } })
    .catch(error => console.error('access log', error.message));
});

app.get('/api/dashboards/:templateId/state', allowShareToken(req => req.params.templateId), async (req, res, next) => {
  try { res.json(await getDashboardState(requesterId(req), req.params.templateId)); }
  catch (error) { next(error); }
});

app.put('/api/dashboards/:templateId/state', requireAuth, async (req, res, next) => {
  try { res.json(await saveDashboardState(req.session.userId, req.params.templateId, req.body || {})); }
  catch (error) { next(error); }
});

for (const kind of ['views','reports']) {
  app.get(`/api/dashboards/:templateId/saved-${kind}`, requireAuth, async (req,res,next) => {
    try { res.json({ items: await listSavedContent(req.session.userId,req.params.templateId,kind) }); } catch(error){ next(error); }
  });
  app.post(`/api/dashboards/:templateId/saved-${kind}`, requireAuth, async (req,res,next) => {
    try {
      if (!String(req.body?.name||'').trim()) return res.status(400).json({error:'Name is required'});
      res.status(201).json(await createSavedContent(req.session.userId,req.params.templateId,kind,req.body));
    } catch(error){ next(error); }
  });
  app.delete(`/api/saved-${kind}/:id`, requireAuth, async (req,res,next) => {
    try { res.json({ok:await deleteSavedContent(req.session.userId,req.params.id,kind)}); } catch(error){ next(error); }
  });
}

// ===== ACCOUNT =====
app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Rate-limited like a sign-in: this endpoint verifies a password, so
    // without a limit it is a brute-force oracle that happens to sit behind a
    // session rather than in front of one.
    const gate = authAttemptStatus(clientIp(req), user.email);
    if (gate.blocked) {
      res.set('Retry-After', String(gate.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    // Someone who signed up through Google has no password to confirm; they
    // set one here for the first time instead of being locked out of the flow.
    if (user.hasPassword && !(await verifyPassword(currentPassword, user.passwordHash))) {
      recordAuthFailure(clientIp(req), user.email);
      await logAuthEvent({ email: user.email, action: 'auth.password_change', req, outcome: 'failure' });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const weak = passwordProblem(newPassword, { email: user.email, name: user.displayName });
    if (weak) return res.status(400).json({ error: weak });
    if (user.hasPassword && await verifyPassword(newPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    await setPassword(user.id, await bcrypt.hash(newPassword, 12), { mustChange: false });
    clearAuthFailures(clientIp(req), user.email);
    // Every other session for this account dies. If the reason for changing
    // was a suspected compromise, leaving the attacker's session alive would
    // defeat the entire exercise.
    const revoked = await revokeOtherSessions(user.id, req.sessionID);
    await logAuthEvent({ email: user.email, action: 'auth.password_change', req, outcome: 'success' });
    // Not awaited: the password has already changed, and an unreachable mail
    // host must not turn a completed change into a reported failure.
    sendSecurityNotification({ to: user.email, event: 'password_changed',
      context: { ip: clientIp(req) } }).catch(() => {});
    req.session.mustChangePassword = false;
    res.json({ ok: true, otherSessionsSignedOut: revoked });
  } catch (error) { next(error); }
});

// Self-service erasure. Requires the current password so that a hijacked
// session cannot destroy the account, and requires typing the email so it
// cannot be a misclick. The last active admin is refused, for the same reason
// they cannot demote themselves: it would leave the workspace unadministrable.
app.delete('/api/auth/account', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
    if (confirmEmail !== user.email.toLowerCase()) {
      return res.status(400).json({ error: 'Type your email address exactly to confirm' });
    }
    if (user.hasPassword && !(await verifyPassword(String(req.body?.currentPassword || ''), user.passwordHash))) {
      recordAuthFailure(clientIp(req), user.email);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (user.role === 'admin' && await countOtherActiveAdmins(user.id) === 0) {
      return res.status(400).json({ error: 'You are the last active admin. Promote someone else first.' });
    }
    // Captured before deletion — afterwards there is no address left to notify,
    // which is the entire point of the erasure.
    const notifyAddress = user.email;
    const result = await deleteUserData(user.id);
    sendSecurityNotification({ to: notifyAddress, event: 'account_deleted' }).catch(() => {});
    // Audited with the actor already null — the point of the record is that a
    // deletion happened, not who it was.
    await logAudit({ userId: null, action: 'user.self_deleted', entityType: 'user', entityId: null,
      afterState: { subject: 'deleted-user' }, ipAddress: clientIp(req) });
    req.session.destroy(() => res.json({ ok: true, deleted: Boolean(result) }));
  } catch (error) { next(error); }
});

// ===== ADMIN: USERS =====
const ROLES = new Set(['user', 'admin']);
const STATUSES = new Set(['active', 'disabled']);
const temporaryPasswordValue = () => `${randomBytes(9).toString('base64url')}-${randomBytes(6).toString('base64url')}`;

app.get('/api/admin/users', requireAdmin, async (req, res, next) => {
  try { res.json({ items: await listUsers() }); } catch (error) { next(error); }
});

app.post('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const displayName = String(req.body?.name || '').trim();
    const role = ROLES.has(req.body?.role) ? req.body.role : 'user';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (displayName.length < 2 || displayName.length > 100) return res.status(400).json({ error: 'Enter a name' });
    const domain = process.env.ALLOWED_DOMAIN;
    if (domain && !email.endsWith(`@${domain}`)) return res.status(403).json({ error: `Only @${domain} emails are allowed` });
    if (await findUserByEmail(email)) return res.status(409).json({ error: 'That address already has an account' });

    // Generated here rather than chosen by the admin: an admin-chosen password
    // is one the admin knows, and this one is single-use by construction —
    // must_change_password blocks everything until the new user replaces it.
    const temporaryPassword = temporaryPasswordValue();
    const user = await createInvitedUser({
      email, displayName, role, invitedBy: req.session.userId,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
    });
    await logAudit({ userId: req.session.userId, action: 'user.invited', entityType: 'user',
      entityId: user.id, afterState: { email, role } });
    // Tells them an account exists; deliberately does NOT carry the temporary
    // password. Mailing a credential publishes it to every relay and backup
    // the message passes through.
    sendSecurityNotification({ to: email, event: 'account_created',
      context: { actor: req.session.email } }).catch(() => {});
    // Returned exactly once and never stored in readable form.
    res.status(201).json({ user, temporaryPassword });
  } catch (error) { next(error); }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'No such user' });
    const role = req.body?.role === undefined ? undefined : String(req.body.role);
    const status = req.body?.status === undefined ? undefined : String(req.body.status);
    if (role !== undefined && !ROLES.has(role)) return res.status(400).json({ error: 'Unknown role' });
    if (status !== undefined && !STATUSES.has(status)) return res.status(400).json({ error: 'Unknown status' });

    // Two lockout guards. Self-demotion is refused outright because it is
    // almost always a misclick and not something you can undo yourself. The
    // last-admin check then covers demoting or disabling somebody else.
    const losesAdmin = (role !== undefined && role !== 'admin') || status === 'disabled';
    if (target.id === req.session.userId && losesAdmin) {
      return res.status(400).json({ error: 'You cannot remove your own admin access. Ask another admin.' });
    }
    if (target.role === 'admin' && losesAdmin && await countOtherActiveAdmins(target.id) === 0) {
      return res.status(400).json({ error: 'This is the last active admin. Promote someone else first.' });
    }

    const updated = await updateUserAccess(target.id, { role, status });
    // A disabled account must lose its live sessions immediately; otherwise
    // "disabled" only takes effect at their next sign-in, which is exactly
    // when it matters least.
    if (status === 'disabled') await revokeOtherSessions(target.id, null);
    await logAudit({ userId: req.session.userId, action: 'user.access_changed', entityType: 'user',
      entityId: target.id, afterState: { role: updated.role, status: updated.status } });
    res.json(updated);
  } catch (error) { next(error); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'No such user' });
    if (target.id === req.session.userId) {
      return res.status(400).json({ error: 'Delete your own account from the Account page.' });
    }
    if (target.role === 'admin' && await countOtherActiveAdmins(target.id) === 0) {
      return res.status(400).json({ error: 'This is the last active admin. Promote someone else first.' });
    }
    // Their data sources move to the admin doing the removal rather than
    // vanishing — a departing colleague's connected sources are usually the
    // team's, not theirs personally.
    const notifyAddress = target.email;
    const result = await deleteUserData(target.id, { transferTo: req.session.userId });
    sendSecurityNotification({ to: notifyAddress, event: 'account_deleted' }).catch(() => {});
    await logAudit({ userId: req.session.userId, action: 'user.deleted', entityType: 'user',
      entityId: null, afterState: { subject: 'deleted-user', transferred: result?.moved } });
    res.json({ ok: true, transferred: result?.moved || null });
  } catch (error) { next(error); }
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'No such user' });
    const temporaryPassword = temporaryPasswordValue();
    await setPassword(target.id, await bcrypt.hash(temporaryPassword, 12), { mustChange: true });
    // Reset exists for the case where the account may be compromised, so every
    // existing session for it is destroyed.
    const revoked = await revokeOtherSessions(target.id, null);
    await logAudit({ userId: req.session.userId, action: 'user.password_reset', entityType: 'user',
      entityId: target.id, afterState: { email: target.email, sessionsRevoked: revoked } });
    // The person whose password was reset needs to hear it from somewhere
    // other than the person who reset it.
    sendSecurityNotification({ to: target.email, event: 'password_reset_by_admin',
      context: { actor: req.session.email } }).catch(() => {});
    res.json({ ok: true, temporaryPassword, sessionsRevoked: revoked });
  } catch (error) { next(error); }
});

app.get('/api/admin/logs', requireAdmin, async (req,res,next) => {
  try { res.json({items:await listAdminLogs(req.query.type,req.query.limit)}); } catch(error){ next(error); }
});
app.post('/api/admin/retention-cleanup', requireAdmin, async (req,res,next) => {
  try { res.json({ok:true,deleted:await cleanupOldRecords(req.body?.days)}); } catch(error){ next(error); }
});

// Maps a driver error onto a stable reason code plus a one-line summary.
//
// This exists because "unavailable" with no reason cost a real debugging
// session: a server process was still holding pre-rotation credentials, and
// the endpoint reported the same opaque string it reports for a DNS failure,
// a suspended database, or an expired certificate. The reason code is the
// whole point - it tells you which of those you are looking at.
//
// The endpoint is public and unauthenticated (the platform health check hits
// it), so the response carries a CLASSIFICATION only. Raw driver text can
// contain the database hostname, so it is logged server-side and never
// returned. Nothing here ever touches the connection string or password.
function classifyDatabaseError(error) {
  const pgCode = error && error.code;
  switch (pgCode) {
    case '28P01': case '28000':
      return { reason: 'auth_failed', summary: 'Database rejected the credentials. If they were rotated, this process is still holding the old ones - restart it.' };
    case '3D000':
      return { reason: 'unknown_database', summary: 'The configured database name does not exist on the server.' };
    case '53300':
      return { reason: 'too_many_connections', summary: 'The server refused a new connection: the pool limit is exhausted.' };
    case '57P03':
      return { reason: 'starting_up', summary: 'The database is starting and not accepting connections yet.' };
    case '08006': case '08001': case '08003':
      return { reason: 'connection_failed', summary: 'The connection to the database dropped.' };
    case 'ENOTFOUND': case 'EAI_AGAIN':
      return { reason: 'dns_failure', summary: 'The database hostname did not resolve. Usually a network or DNS problem, not a credential one.' };
    case 'ECONNREFUSED':
      return { reason: 'connection_refused', summary: 'Nothing accepted the connection on that host and port.' };
    case 'ETIMEDOUT': case 'ECONNRESET':
      return { reason: 'network_timeout', summary: 'The connection timed out or was reset in transit.' };
    case 'CERT_HAS_EXPIRED': case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return { reason: 'tls_failure', summary: 'The TLS handshake failed while connecting to the database.' };
    default:
      return { reason: pgCode ? 'driver_error' : 'unknown', summary: 'The database did not answer. See the server log for the driver error.' };
  }
}

app.get('/api/health/database', async (req,res) => {
  if (!databaseEnabled) {
    return res.status(503).json({ ok:false, database:'not configured', reason:'not_configured',
      summary:'DATABASE_URL is not set, so the server started without a database.' });
  }
  // Bounded so a hung socket cannot hang the health check itself - an
  // unbounded probe here stalls the platform's checker instead of failing it.
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(Object.assign(new Error('health probe timed out'), { code:'ETIMEDOUT' })), 5000));
  try {
    const result = await Promise.race([pool.query('SELECT now() AS time'), timeout]);
    res.json({ ok:true, database:'postgresql', time:result.rows[0].time });
  } catch (error) {
    const { reason, summary } = classifyDatabaseError(error);
    // Full detail goes to the log, never to the response.
    console.error('[health] database probe failed:', reason, '-', error && error.message);
    res.status(503).json({ ok:false, database:'unavailable', reason, summary });
  }
});

// ===== DATA ENDPOINTS =====

app.get('/api/data/:templateId', allowShareToken(req => req.params.templateId), (req, res) => {
  const { templateId } = req.params;
  const {
    region, continentGroup, orgType, stage, owner, source, type, industry, pod, team,
    createdFrom, createdTo, closeFrom, closeTo,
  } = req.query;

  let data = cacheGet(userScope(requesterId(req), templateId)) || [];

  const asList = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  const selections = { region, continentGroup, orgType, stage, owner, source, type, industry, pod, team };

  Object.entries(selections).forEach(([field, value]) => {
    const selected = asList(value);
    if (!selected.length) return;

    data = data.filter(row => selected.includes(row[field]));
  });

  // Dates are stored as YYYY-MM-DD, so string comparison is date comparison.
  // Rows with a null date are excluded once a bound is set on that field.
  if (createdFrom) data = data.filter(r => r.createdDate && r.createdDate >= createdFrom);
  if (createdTo)   data = data.filter(r => r.createdDate && r.createdDate <= createdTo);
  if (closeFrom)   data = data.filter(r => r.closeDate   && r.closeDate   >= closeFrom);
  if (closeTo)     data = data.filter(r => r.closeDate   && r.closeDate   <= closeTo);

  // Tableau can return duplicate physical rows after joins. Dashboard metrics
  // are opportunity-level, matching CNTD(Opportunity ID), so count each ID once.
  const seenIds = new Set();
  data = data.filter(row => {
    const id = String(row.id || '').trim();
    if (!id) return false;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  res.json(data);
  logSourceAccess({ userId: requesterId(req), dashboardKey: templateId,
    action: 'dashboard.data.read', rowCount: data.length,
    details: { filtered: Object.keys(req.query).length > 0, viaShareToken: Boolean(req.shareAuth) } })
    .catch(error => console.error('access log', error.message));
});
// Dev helper: load mock data
app.post('/api/data/:templateId/load', requireAdmin, (req, res) => {
  const { templateId } = req.params;
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON array' });
  }
  cacheSet(userScope(req.session.userId, templateId), req.body);
  res.json({ ok: true, rowCount: req.body.length });
});

// Filter menus always describe the complete uploaded dataset. Active filters
// affect dashboard rows, but do not hide valid choices from another menu.
app.get('/api/options/:templateId', requireAuth, (req, res) => {
  const FIELDS = ['region', 'orgType', 'stage', 'owner', 'source', 'type', 'industry', 'pod', 'team', 'product', 'productGroup', 'continentGroup'];
  const all = dashboardRows(req.session.userId,req.params.templateId);
  const out = {};
  FIELDS.forEach(field => {
    out[field] = [...new Set(all.map(r => r[field]).filter(Boolean))].sort();
  });

  res.json(out);
});

app.use('/api/datasources', createDataSourceRouter({
  requireAuth,
  store: {
    setSourceRows,
    removeSourceRows,
    getSourceRawData,
  },
}));

app.use('/api/charts', createChartRouter({ requireAuth, store: { getSourceRawData } }));
app.use('/api/custom-dashboards', createCustomDashboardRouter({ requireAuth }));

app.get('/api/win-board/metrics', allowShareToken(() => 'win-board'), (req, res) => {
  res.json(buildWinBoardSnapshot(dashboardRows(requesterId(req),'win-board'),req.query).metrics);
});

app.get('/api/win-board/snapshot', allowShareToken(() => 'win-board'), (req,res) => {
  res.json(buildWinBoardSnapshot(dashboardRows(requesterId(req),'win-board'),req.query));
});

// Product View: one template, two date-scoped views. Each has its own
// snapshot so the client's per-view filters stay independent server-side too.
app.get('/api/product-view/pipeline/snapshot', allowShareToken(() => 'product-view'), (req, res) => {
  res.json(buildProductPipelineSnapshot(dashboardRows(requesterId(req), 'product-view'), req.query));
});
app.get('/api/product-view/won/snapshot', allowShareToken(() => 'product-view'), (req, res) => {
  res.json(buildProductWonSnapshot(dashboardRows(requesterId(req), 'product-view'), req.query));
});

// Executive Dashboard: every object is computed here from the opportunity ×
// product-line rows; the browser only renders. Board-only (no wall), so a
// share token has nothing to open, but the read path stays uniform.
app.get('/api/executive-dashboard/snapshot', allowShareToken(() => 'executive-dashboard'), (req, res) => {
  res.json(buildExecutiveSnapshot(dashboardRows(requesterId(req), 'executive-dashboard'), req.query));
});

app.get('/api/loss-board/metrics', allowShareToken(() => 'loss-board'), (req, res) => {
  res.json(buildLossBoardSnapshot(dashboardRows(requesterId(req),'loss-board'),req.query).metrics);
});

app.get('/api/loss-board/snapshot', allowShareToken(() => 'loss-board'), (req,res) => {
  res.json(buildLossBoardSnapshot(dashboardRows(requesterId(req),'loss-board'),req.query));
});

// AE Performance is its own connectable data source (see DataSources.jsx's
// dashboard picker) — 'ae-performance' is a distinct cache key, mapped and
// loaded independently of Win Board, not read off Win Board's rows.
// AM Performance is the AE board with one different scope rule. It shares the
// metric code entirely, so a fix to quota, attainment or rep status lands on
// both boards at once and they cannot drift apart.
app.get('/api/am-performance/metrics', allowShareToken(() => 'am-performance'), (req, res) => {
  res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'am-performance'),req.query,{scope:isAmRow}).metrics);
});

app.get('/api/am-performance/snapshot', allowShareToken(() => 'am-performance'), async (req,res,next) => {
  try {
    const [quotaSourceColumn, quotaPriorSourceColumn] = await Promise.all([
      getMappedSourceColumn(requesterId(req),'am-performance','quotaCurrent').catch(()=>null),
      getMappedSourceColumn(requesterId(req),'am-performance','quotaPrior').catch(()=>null),
    ]);
    res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'am-performance'),req.query,
      {quotaSourceColumn, quotaPriorSourceColumn, scope:isAmRow}));
  } catch(error){ next(error); }
});

app.get('/api/ae-performance/metrics', allowShareToken(() => 'ae-performance'), (req, res) => {
  res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'ae-performance'),req.query).metrics);
});

app.get('/api/ae-performance/snapshot', allowShareToken(() => 'ae-performance'), async (req,res,next) => {
  try {
    // The mapped column NAMES are read alongside the rows so the board can
    // warn when a quota column is named for a different quarter than the one
    // being reported. Failing to read them must not fail the board, so a
    // lookup error degrades to "no warning" rather than to no dashboard.
    const [quotaSourceColumn, quotaPriorSourceColumn] = await Promise.all([
      getMappedSourceColumn(requesterId(req),'ae-performance','quotaCurrent').catch(()=>null),
      getMappedSourceColumn(requesterId(req),'ae-performance','quotaPrior').catch(()=>null),
    ]);
    res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'ae-performance'),req.query,
      {quotaSourceColumn, quotaPriorSourceColumn}));
  } catch(error){ next(error); }
});

app.get('/api/comparison/:templateId', allowShareToken(req => req.params.templateId), (req,res) => {
  if(req.params.templateId==='win-board'){
    return res.json(buildWinBoardSnapshot(dashboardRows(requesterId(req),'win-board'),req.query).comparison);
  }
  if(req.params.templateId==='loss-board'){
    return res.json(buildLossBoardSnapshot(dashboardRows(requesterId(req),'loss-board'),req.query).comparison);
  }
  if(req.params.templateId==='ae-performance'){
    return res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'ae-performance'),req.query).comparison);
  }
  if(req.params.templateId==='am-performance'){
    return res.json(buildAePerformanceSnapshot(dashboardRows(requesterId(req),'am-performance'),req.query,{scope:isAmRow}).comparison);
  }
  res.json(buildGenericComparison(dashboardRows(requesterId(req),req.params.templateId),req.query));
});

// Error-handling middleware must stay last: Express only routes thrown/next(error)
// errors to error middleware registered before the route that threw.
// Logging an error object wholesale is a quiet way to write secrets to disk.
// An axios failure carries `config.data` — the outbound request body — so a
// failed Tableau sign-in would print the Personal Access Token in clear text
// to the server log, and a pg failure can carry the connection string. Log the
// parts that aid diagnosis and drop the parts that carry credentials.
function safeError(error) {
  if (!error || typeof error !== 'object') return { message: String(error) };
  return {
    name: error.name, message: error.message, code: error.code,
    status: error.status ?? error.response?.status,
    route: error.config?.url,
    stack: IS_PRODUCTION ? undefined : error.stack,
  };
}

app.use(async (error,req,res,next) => {
  console.error('[error]', req.method, req.originalUrl, safeError(error));
  if(databaseEnabled){
    try{await pool.query(`INSERT INTO application_errors(user_id,route,method,error_code,message,stack_trace)
      VALUES($1,$2,$3,$4,$5,$6)`,[req.session?.userId||null,req.originalUrl,req.method,
      error.code||null,error.message||'Unexpected error',process.env.NODE_ENV==='production'?null:error.stack]);}catch{}
  }
  if(res.headersSent)return next(error);
  res.status(error.status||500).json({error:error.status?error.message:'Unexpected server error'});
});

// ===== STARTUP =====
// Every step below is best-effort. This callback is async, so an unhandled
// rejection here terminates the process: the server would bind the port, print
// "running", then die on the first query if the database refused the
// connection. That turned a diagnosable 503 into a crash loop with no
// explanation. Startup housekeeping must never take the HTTP layer down - if
// the database is unreachable we stay up and let /api/health/database name it.
app.listen(PORT, async () => {
  console.log(`\n📊 Dashboard Server running on http://localhost:${PORT}`);
  console.log(`Auth mode: ${GOOGLE_AUTH_ENABLED ? `Google SSO @${process.env.ALLOWED_DOMAIN || 'any'}` : 'Email and password'}`);
  console.log(`Database: ${databaseEnabled ? 'PostgreSQL' : 'not configured (memory-only development mode)'}`);
  if (databaseEnabled) {
    // Before anything reads or writes, bring the schema up to date — the
    // registry seed immediately below already assumes the tables exist.
    // Non-fatal on purpose, like every other step in this callback: a schema
    // that cannot be reached should surface through /api/health/database, not
    // as a process that binds the port and then dies.
    try {
      const { applied, total } = await runMigrations(pool);
      console.log(applied.length
        ? `Schema: applied ${applied.length} new migration(s) — ${applied.join(', ')}`
        : `Schema: up to date (${total} migrations)`);
    } catch (error) {
      console.error('WARN  database migrations did not run:', error?.message || error);
    }

    // Every template needs a row in `dashboards`: it is the FK target that
    // dashboard_source_bindings joins against, so a template present in code
    // but absent from the table cannot be bound and fails at commit with
    // "Unknown dashboard". Seeding it from TEMPLATES here means registering a
    // dashboard stays ONE edit - add it to TEMPLATES and the row follows.
    // Idempotent, and never fatal: a seeding failure must not stop the server.
    try {
      for (const template of TEMPLATES) {
        await pool.query(
          `INSERT INTO dashboards(template_key,name,description,is_system) VALUES($1,$2,$3,true)
           ON CONFLICT(template_key) DO UPDATE SET name=EXCLUDED.name,
             description=EXCLUDED.description, updated_at=now()`,
          [template.id, template.name, template.description || null]);
      }
    } catch (error) {
      console.error('WARN  dashboard registry seed skipped:', error?.message || error);
    }

    try {
      await pool.query(`UPDATE data_sources SET status='needs_reload',updated_at=now()
        WHERE source_type='file' AND status='loaded'`);
    } catch (error) {
      console.error('WARN  startup housekeeping skipped, database unreachable:', error?.message || error);
      console.error('      The server is still serving. Check /api/health/database for the reason.');
    }
  }

  console.log('\n✅ Server ready\n');
});

// Last line of defence. Anything that still escapes gets logged rather than
// killing a running server: a crashed process cannot report why it crashed.
process.on('unhandledRejection', reason => {
  console.error('WARN  unhandled promise rejection:', reason?.message || reason);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closePool();
    process.exit(0);
  });
}

function establishSession(req, res, user) {
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not create login session' });
    const mustChangePassword = Boolean(user.mustChangePassword ?? user.must_change_password);
    const safe = {
      id: user.id, email: user.email, name: user.displayName,
      picture: user.pictureUrl || '', role: user.role, mustChangePassword,
    };
    Object.assign(req.session, {
      userId: safe.id, email: safe.email, name: safe.name,
      picture: safe.picture, role: safe.role, mustChangePassword,
    });
    res.json(safe);
  });
}

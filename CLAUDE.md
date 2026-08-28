# CLAUDE.md — operating instructions for AI sessions

## Stack

- **Client**: React 18 + Vite 5, plain `.jsx` (no TypeScript), react-router-dom 6,
  Chart.js 4, react-grid-layout 2, axios. One global stylesheet: `client/src/index.css`.
- **Server**: Express 4, plain ESM JavaScript (`"type": "module"`), raw `pg` (no ORM),
  express-session + connect-pg-simple, node-cron, multer, xlsx.
- **Database**: PostgreSQL (Neon). Migrations are plain SQL files in
  `server/db/migrations/`, applied at server boot with a ledger + advisory lock.
- **Deploy**: static client on Vercel, `/api/*` proxied to a persistent Node process
  on Render (`render.yaml`). This is deliberate — do NOT propose serverless,
  Next.js, or Prisma migrations (decided 2026-08-27, free-tier constraints).

## Directory map

```
client/src/pages/        one file per route (Dashboard.jsx is the 6-tab generic board)
client/src/components/   charts.jsx (Chart.js wrappers), BuilderChart, modals, buttons
client/src/hooks/        useAuth, useTemplates, usePresentationLiveness
client/src/lib/api.js    every API call + share-token header + cold-start retry
server/server.js         app wiring, auth, sessions, templates, share tokens, boards
server/datasources.js    OPP_SCHEMA, mapping, Tableau (VDS + views), webhooks, sync cron
server/chartRoutes.js    chart builder API (catalogue, preview, CRUD, custom dashboards)
server/services/         pure logic: metrics, chartEngine, chartCatalog, columnProfile,
                         authGuard, credentialCipher, shareTokenPolicy, mailer
server/repositories/     all SQL, one file per aggregate
server/db/migrations/    append-only numbered SQL; never edit an applied file
server/test/             node --test suites over the pure services
tests/                   Playwright browser suites (baseline walk + feature e2e)
```

## Commands

- Run: `npm run dev` (root; server :3001 + client :5173)
- Server tests: `cd server && npm test` — fast, no DB
- Client build: `cd client && npm run build`
- Browser tests: `npx playwright test tests/ --reporter=list` with
  `AUDIT_EMAIL`/`AUDIT_PASSWORD` env vars set to a test login
- Migrations standalone: `cd server && npm run db:migrate`

## Conventions observed in this codebase

- Comments explain WHY (the bug that motivated the code, the attack it blocks),
  never what the next line does. Match that.
- Server code is dense: compact route handlers, `try { … } catch(error){ next(error); }`.
- Business math lives in `server/services/` as pure functions with tests;
  routes stay thin. New logic goes there, tested the same way.
- Client pages own their state; no global store. Reusable chart pieces live in
  `components/charts.jsx` (fixed boards) and `BuilderChart.jsx` (builder charts).
- Per-user tenancy is sacred: every cache read is keyed by userId
  (`server/server.js` userScope) and every SQL query filters by
  `owner_user_id`. Never widen a scope.
- Chart configs are versioned (`CHART_CONFIG_VERSION` in
  `server/services/chartEngine.js`); saved charts depend on the shape — change
  it only with a migration path.

## Hard rules

- **Never commit, push, branch, or touch any remote.** Propose a commit
  (file list + message) and wait for the human to run it.
- **Never commit secrets.** `server/.env` holds live credentials; only
  `*.env.example` files are tracked. Never print a key, PAT, or token.
- **Boot side effects**: the local `server/.env` points at the SHARED live Neon
  database, and every server boot runs migrations plus a real Tableau re-sync
  of all saved sources. Boot deliberately.
- **Run tests before claiming done** — and for anything visual, look at it in
  a real browser (the Playwright suites exist for exactly this).
- **Deletions** go through the five-gate protocol: repo-wide string search,
  reference check, client build, full tests, and a Playwright baseline diff
  (`tests/baseline.spec.ts` before vs after). Database columns are never
  dropped without explicit human sign-off.
- Never edit an already-applied migration file; add a new numbered one.

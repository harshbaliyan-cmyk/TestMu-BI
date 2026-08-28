# TestMu BI

Sales analytics for a small internal team, built on live Tableau data. Five
hand-built dashboards (Opportunity Analytics, Win Board, Loss Board, AE
Performance, AM Performance), a chart builder for assembling custom dashboards
from any connected dataset's raw columns, TV presentation modes with revocable
no-login share links, and webhook-driven auto-refresh from Tableau Cloud.

React 18 + Vite client (`client/`), Express server (`server/`, plain ESM
JavaScript, raw `pg`), PostgreSQL on Neon. Deployed as a static client on
Vercel proxying `/api/*` to a persistent Node process on Render — see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

```bash
npm run install:all                     # server and client dependencies

cp server/.env.example server/.env      # then fill in real values
cp client/.env.example client/.env      # optional, public values only

npm run dev                             # client :5173, server :3001
```

Migrations run automatically when the server boots (`server/db/migrate.js`);
`cd server && npm run db:migrate` runs them standalone. The first administrator
is created with `cd server && node scripts/create-admin.mjs` — self-signup is
off by design.

## Testing

```bash
cd server && npm test                   # unit tests (node --test, no DB needed)
cd client && npm run build              # production build

# Browser suites (need a running app and a login):
$env:AUDIT_EMAIL='<test account email>'; $env:AUDIT_PASSWORD='<password>'
npx playwright test tests/ --reporter=list
```

`tests/baseline.spec.ts` walks every route recording console errors and
screenshots into `.playwright/baseline/` — run it before and after any removal
and diff the reports.

## More documentation

| | |
|---|---|
| [SPEC.md](SPEC.md) | What exists today, and explicit non-goals |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, request flow, where state lives |
| [DATA_MODEL.md](DATA_MODEL.md) | Every table, as defined in `server/db/migrations/` |
| [API.md](API.md) | Every endpoint with auth requirements |
| [DECISIONS.md](DECISIONS.md) | Why things are the way they are |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel + Render + Neon runbook |
| [SECURITY.md](SECURITY.md) | Credential rotation |
| [CLAUDE.md](CLAUDE.md) | Operating instructions for AI coding sessions |

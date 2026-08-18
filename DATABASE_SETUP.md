# TestMu BI database and data-source operations

## Local setup

1. Copy the required names from `server/.env.example` into `server/.env`.
2. Set `DATABASE_URL` to the Neon pooled PostgreSQL URL. Never commit it.
3. Set `TABLEAU_CREDENTIAL_ENCRYPTION_KEY` to a base64-encoded 32-byte random key.
4. Run `cd server` and `npm run db:migrate`.
5. Start the app from the repository root with `npm run dev`.

Database health is available at `GET /api/health/database`.

## What PostgreSQL stores

PostgreSQL stores users, server sessions, dashboard preferences, saved views/reports,
Tableau connection metadata and encrypted PAT secrets, source/file metadata, field mappings,
dashboard bindings, sync history, access logs, errors, and audit logs.

Uploaded or Tableau business rows are deliberately not stored in PostgreSQL. They live only
in the server runtime cache. File sources therefore become `needs_reload` after a server restart.
Tableau sources can be restored with Refresh and are refreshed automatically every 12 hours by
default. Override this using `TABLEAU_SOURCE_SYNC_CRON` with a standard cron expression.

## Multiple sources

Each file, Tableau view, or published data source is mapped independently. A source may bind to
multiple dashboards and multiple compatible sources may feed one dashboard. Opportunity data is
unioned at runtime, and the existing API deduplicates nonblank Opportunity IDs before returning rows.
Unrelated entity schemas are not automatically joined.

## Security and key rotation

Tableau PAT secrets use AES-256-GCM. The encryption key must never be stored in the database or
committed to source control. To rotate it safely, decrypt existing credentials with the old key and
re-encrypt with the new key in a controlled maintenance script; alternatively reconnect each Tableau
connection after changing the key. Losing the key makes saved PAT secrets unrecoverable.

## Retention

Admins can use the Logs page to remove audit, access, error, and sync records older than 90 days.
The endpoint is `POST /api/admin/retention-cleanup` with `{ "days": 90 }`.

## Verification

- Server tests: `cd server && npm test`
- Client build: `cd client && npm run build`
- Syntax: `node --check server.js`

The Vite build currently reports a bundle-size warning because Chart.js and Three.js are bundled
with the dashboard. This is a performance warning, not a build failure.

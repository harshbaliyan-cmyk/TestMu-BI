# DECISIONS.md

Architectural choices and why they hold. Entries marked *(inferred — confirm)*
were reconstructed from code rather than a recorded decision.

1. **Persistent Express on Render, not serverless.** Business rows, the sync
   cron, webhook dedupe and the rate limiter live in process memory; free-tier
   constraints rule out the alternatives for now. Explicitly reaffirmed
   2026-08-27: revisit later, do not re-architect casually.
2. **Business rows stay OUT of Postgres.** Tableau is the system of record;
   the app re-pulls at boot and on schedule/webhook. Trade: restarts serve
   empty boards briefly; win: no ETL schema to migrate, datasets stay small
   (~100k rows ceiling). The revisit path is typed `datasets` tables.
3. **Raw `pg` + plain SQL migrations, no ORM.** Migrations run at boot inside
   one transaction with an advisory `xact` lock (Neon's pooler multiplexes in
   transaction mode, so session locks would not hold).
4. **Hand-rolled session auth, not Auth.js.** The app is not Next.js; the
   existing implementation is domain-restricted, invite-only, rate-limited,
   enumeration-safe and heavily tested. Decision 2026-08-27: keep it.
5. **Per-user tenancy everywhere.** Sources, rows, dashboard state and
   tokens are owned; caches are keyed by userId because a template-keyed cache
   once leaked one user's pipeline to everyone (see comments in server.js).
6. **Tableau access = per-user PATs, encrypted AES-256-GCM** under an env key;
   rotation script rotates PAT + key together so stored credentials survive.
7. **VizQL Data Service for published data sources; CSV export for views.**
   Both supported because both exist in the wild here; published data sources
   are the recommended path.
8. **One canonical opportunity schema** (`OPP_SCHEMA`) powers the built-in
   boards, with aliases and manual mapping per source.
9. **Chart builder and custom dashboards retired** at the user's request on
   2026-09-14, including their APIs, renderer, tables and custom TV targets.
10. **Retain historical migrations.** Migration 017 performs the removal
    transactionally while preserving built-in dashboard records and links.
11. **TV walls authenticate with hashed, single-dashboard share tokens** in a
    header (never a query string on API calls), managed session-only, revocable,
    and structurally unable to become a general bypass (required foreign key to one
    template dashboard). The grant never touches the session object, because writing
    to it would mint a real login cookie.
12. **Webhooks are the fast path, polling the safety net** (2 h default).
    Refresh-FAILED marks a source `stale` rather than re-pulling: Tableau
    still serves the last good extract, and re-reading it would dress stale
    data up as fresh.
13. **Metric math lives in pure, tested functions** under `server/services/`;
    AE and AM boards share one implementation differing only in row scope, so
    they cannot drift.
14. **Vercel proxies /api to Render** so the browser sees one origin and
    cookie auth needs no CORS surface. *(inferred — confirm: also gives free
    TLS + CDN for the static client.)*
15. **Chart.js for all built-in boards** — one theming system,
    no second charting stack. Decision 2026-08-27.
16. **The client retries gateway failures on safe requests** (8×5 s) because
    Render's free tier spins down and cold-boots in ~40 s, which otherwise
    masquerades as a wrong password.

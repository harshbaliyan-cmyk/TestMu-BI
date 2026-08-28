# ARCHITECTURE.md

## Components

```
Browser (React SPA, Vite build)
   │  same-origin /api/* (cookies)                Tableau Cloud
   ▼                                                  ▲   │ webhooks (POST)
Vercel ── static files + /api proxy ──► Render        │   ▼
                                        Express ──────┴── REST 3.19 (PAT signin,
                                        server.js          views CSV) + VizQL Data
                                           │               Service (metadata, rows)
                                           ▼
                                        Neon PostgreSQL
```

- **Vercel** serves `client/dist` and rewrites `/api/:path*` to the Render
  service (`vercel.json`). The browser only ever sees one origin, so session
  cookies need no CORS gymnastics.
- **Render** runs `server/server.js` as a persistent Node process
  (`render.yaml`). Persistence is load-bearing: business rows, the sync cron,
  webhook dedupe, and the auth rate-limiter all live in process memory.
- **Neon Postgres** stores everything that must survive a restart: users,
  sessions, connections (encrypted PATs), source metadata + column profiles,
  field mappings, bindings, saved charts/dashboards, share-token hashes, sync
  runs, audit/access/error logs. Deliberately NOT the business rows.
- **Tableau Cloud** is the system of record for business data. The server
  pulls rows (VDS for published data sources, CSV export for views) and
  receives push notifications via site-wide webhooks filtered by resource LUID.

## Request flow (the common case)

1. Browser calls `/api/...` with the session cookie; Vercel proxies to Render.
2. `requireAuth` resolves the session (Postgres-backed); admin routes add a
   role check; TV reads instead accept an `X-Share-Token` header resolved
   against hashed, dashboard-scoped tokens (`req.shareAuth`, never the session).
3. Dashboard/chart endpoints read rows from the in-memory cache — mapped
   canonical rows for the fixed boards (`userScope(userId, templateKey)`),
   raw rows for builder charts (`runtimeSourceRawData`, ownership re-checked) —
   aggregate in pure functions (`services/*Metrics.js`, `services/chartEngine.js`),
   and return JSON. No SQL touches business rows; no string-built queries exist.

## Where state lives

| State | Home | Restart behaviour |
|---|---|---|
| Sessions, users, tokens, configs, mappings, logs | Postgres | survives |
| Mapped + raw business rows | server memory | re-pulled at boot for Tableau sources; file sources become `needs_reload` |
| Column profiles | Postgres (`data_sources.column_metadata`) | survives; refreshed each sync |
| Dashboard UI state | Postgres (`saved_dashboard_states`) + localStorage mirror | survives |
| Auth rate-limit counters, webhook dedupe, staged uploads | server memory | reset (safe: fail-open conveniences) |

## Sync and freshness

Startup sweep re-pulls every Tableau source; a cron re-pulls on
`TABLEAU_SOURCE_SYNC_CRON` (default 2 h) as the fallback; webhooks are the fast
path (refresh-succeeded → re-pull, refresh-failed → mark `stale`). Presentation
pages refetch every 60 s, so a wall reflects a webhook-driven re-pull within a
minute; the "Data updated" stamp is the visible contract.

## Known tensions (accepted for now)

- Rows-in-memory means a Render restart briefly serves empty dashboards until
  the sweep finishes, and memory grows with connected sources (~17k rows × 2
  copies per source today). The revisit path is real `datasets` tables in
  Postgres; deferred by decision (free tier, single instance).
- One server instance is assumed: the rate limiter and caches do not replicate.

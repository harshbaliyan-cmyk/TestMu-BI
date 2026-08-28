# SPEC.md — what TestMu BI does today

Everything below exists and works in the current code. Nothing here is planned
or aspirational; see NON-GOALS for what is deliberately absent.

## Accounts and access

- Email/password sign-in (bcrypt, per-IP and per-email rate limiting, timing-
  equalised lookups) and Google ID-token sign-in, both restricted to
  `ALLOWED_DOMAIN`. Self-signup is off: admins invite users and hand over a
  one-time temporary password that must be changed at first sign-in.
- Roles: `user` and `admin`. Admin manages people (invite, disable, reset
  password, remove with source transfer), reads audit/error logs, and can run
  retention cleanup. Last-active-admin lockouts are prevented.
- Sessions live in Postgres, slide on activity, and are revoked in bulk on
  password change/reset and account disable. Security events email the owner
  when SMTP is configured.
- Self-service account deletion (typed email + password confirmation).

## Data sources

- Per-user Tableau Cloud connections with a Personal Access Token, encrypted
  AES-256-GCM at rest, never returned to the client or logged.
- Three source kinds: file upload (CSV/TSV/XLSX/XLS/JSON, 25 MB cap), Tableau
  **view** (CSV export), Tableau **published data source** (VizQL Data Service).
- Import flow: preview → auto-mapped field suggestions against the canonical
  opportunity schema (`OPP_SCHEMA`, ~35 fields) → manual mapping with fill
  rates and samples → commit to one or more dashboards. Re-committing the same
  underlying source supersedes its previous binding.
- At every sync the server captures per-column profiles (type, fill rate,
  capped distinct count, min/max) and keeps the raw rows in memory alongside
  the mapped rows.
- Refresh: manual per-source, a polling cron (default every 2 h,
  `TABLEAU_SOURCE_SYNC_CRON`), a full re-pull of every Tableau source at boot,
  and Tableau **webhooks** — refresh-succeeded re-pulls within moments;
  refresh-failed marks the source `stale` instead of re-reading old data.
  Webhook callbacks are secret-URL authenticated, LUID-filtered, and de-duped.
- Sync history per source; audit and access logging throughout.

## Fixed dashboards

- **Opportunity Analytics**: six tabs (Pulse, Diagnostics, Velocity & Aging,
  Where We Win, Rep Performance, Accounts & Whitespace) over the canonical
  schema, with searchable multi-select filters, date ranges, saved views,
  saved dashboard state (server + localStorage), and Top-N tables.
- **Win Board / Loss Board / AE Performance / AM Performance**: dedicated
  boards with period comparison, POD/team contribution, quota attainment
  (AE/AM share one metric engine), and rep-status rules. All metric math is
  in tested pure functions under `server/services/`.
- Event Analytics and Tenant Health exist as gallery templates only and reuse
  the generic opportunity dashboard.

## Chart builder and custom dashboards

- Pick any connected source; chart types that the dataset cannot satisfy are
  greyed out with the reason. Slots (category, value + aggregation, series,
  date + grain…) arrive pre-filled from the column profiles and stay
  overridable. Live preview while editing.
- Chart types: bar, time series, donut, KPI tile, scatter, table — declared as
  data in `server/services/chartCatalog.js`.
- Filters (value lists and number/date ranges) apply before aggregation.
  Clicking a bar/point/slice opens the raw rows behind it, with one-click
  "filter chart to this".
- A saved chart is a versioned config (dataset id, type, bindings, filters) —
  rendering is a pure function of config + current rows, so charts follow
  every sync.
- Custom dashboards: named grids of saved charts, drag/resize (12-column
  grid), layout persisted, one chart usable on many dashboards.

## TV / presentation

- Every fixed board has a 16:9 presentation mode: auto-rotating slides
  (generic board), fullscreen with auto-hiding controls, dark high-contrast
  layout.
- All presentation pages refetch data every 60 s (and immediately on network
  reconnect or tab return), hold a screen wake lock, and show a "Data updated
  HH:MM" stamp that turns red when offline. Failed background refreshes keep
  the last good numbers — the stalled stamp is the signal.
- **Share links**: `/tv/<token>` opens one board — a template board or a
  custom dashboard — with no login. Tokens are stored hash-only, scoped to
  exactly one dashboard, revocable from the Account page, optionally
  expiring, and refused for anything else (other dashboards, token
  management, writes). Custom-dashboard walls reproject the saved grid to the
  full screen and follow layout changes live.

## NON-GOALS

- **No AI/LLM layer.** No model-generated SQL, no natural-language querying,
  no insight generation, no Anthropic/OpenAI SDKs.
- **No public signup** and no anonymous access beyond scoped TV share tokens.
- **No serverless backend.** The Express process is persistent by design;
  business rows live in its memory, not in Postgres (revisit-later decision).
- **No cross-user sharing of dashboards or data** — every user sees only the
  sources they connected. TV tokens show the owner's data read-only.
- **No workbook-embedded Tableau sources** — published views and data sources
  only.
- **No mobile-first design** — desk browsers and 16:9 TVs.

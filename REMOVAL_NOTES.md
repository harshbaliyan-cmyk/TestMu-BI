# My dashboards and Chart builder removal

Removed at the user's request on 2026-09-14.

- Removed custom dashboard and chart builder pages, routes, gallery sections,
  sidebar/search entries, custom TV rendering, API helpers, server routers,
  repositories, chart catalogue/engine, drill-down modal, and feature-only CSS.
- Removed the unused dashboard switcher and moved the gallery's existing
  deterministic preview-color helper to `client/src/lib/dashboardColor.js`.
- Removed `react-grid-layout` and its unused dependency graph from the client.
- Removed the builder-only source-schema endpoint. Source upload, preview,
  profiling, remapping, connections, refresh and synchronization remain.
- Old feature bookmarks return to the gallery. Custom favorites are ignored;
  built-in favorites and the grid/list preference still work.
- TV links now target built-in templates only. Creation, clipboard fallback,
  account management, expiry, revocation and Product View selection remain.

## Database cleanup

Migration `017_remove_dashboard_builder.sql` deletes custom TV tokens, removes
their target column from `share_tokens`, requires a template target, and drops
`saved_charts` and `custom_dashboards`. It never uses `CASCADE`.

Historical migrations 013 and 014 are retained. The existing migration runner
applies unapplied files in one transaction and records them in its ledger.
Migration 017 also tolerates a manual replay. An unexpected dependency causes
a rollback, preserving the schema and records instead of deleting extra data.

The configured shared database was not modified during this task. Cleanup
applies on the next server startup/deployment, or with the existing
`cd server && npm run db:migrate` command. Built-in dashboards, their saved
state/views, data sources, bindings and template TV tokens are preserved.

## Verification

- Production Vite build passed; the JavaScript bundle is about 841 kB before
  gzip. The existing bundle-size advisory remains.
- All 194 server tests passed. Isolated PGlite tests execute the actual SQL
  migrations for both a fresh install and an upgrade containing all nine
  built-in dashboards, verify retained rows, check replay, and force a rollback.
- An isolated HTTP test explicitly disables `DATABASE_URL`, confirms all
  retired API methods return 404, and checks surviving authentication guards.
- All 61 browser checks passed across landing, gallery, workspace, management,
  dashboard interiors and removal/TV suites. Three initial failures were test
  selectors aimed at the wrong existing controls; corrected tests passed.
- Browser tests use intercepted synthetic API responses and do not write to
  the shared database. The credential-dependent live baseline suite was not
  run. Desktop/mobile screenshots were inspected, and every built-in board
  was exercised with populated charts, along with its surviving controls.
- Repository searches found no remaining runtime references to the removed
  modules, APIs or dependency. Remaining removal references are migration
  history, documentation and regression assertions.
- SHA-256 checks confirmed all ten landing and presentation files still match
  the existing baseline. Browser test discovery and `git diff --check` passed.

Logs and screenshots are in the ignored `.playwright/removal`,
`.playwright/workspace` and `.playwright/dashboard-refresh` directories.

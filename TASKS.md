# TASKS.md

No `TODO`/`FIXME` comments exist in the source (verified by repo-wide search,
2026-08-27); this list is seeded from the upgrade work instead.

## Done (2026-08-27 upgrade, uncommitted — commit slices are listed in chat)

- Fix AdminLogs `useEffect(async)` crash
- Remove the legacy env-driven worksheet sync (five-gate protocol)
- TV liveness: 60 s refetch, wake lock, reconnect, "Data updated" stamp
- Revocable TV share tokens (`/tv/:token`) for template boards
- Webhook failure watch → sources marked `stale`; delivery dedupe; 2 h poll default
- Dataset column profiling at sync + raw-row retention
- Chart builder: catalogue, suggestion, live preview, saved chart configs
- Custom dashboards: drag/resize grid, gallery section
- Chart filters + click-to-drill (rows behind an element, filter-to-this)
- Custom dashboards on TV share links
- Documentation rewrite (this file and siblings)

## In progress

- (nothing — pick up from Blocked or the ideas below)

## Blocked / waiting on a human

- Enable webhooks in production: set `APP_BASE_URL` on Render, then
  per-source "Enable auto-refresh" (needs the owner's login)
- Commit the upgrade slices (agent is forbidden from git)
- Decide the fate of the temporary `claude-audit@lambdatest.com` account
- Decide whether `PROJECT_DOCUMENTATION.md` (pre-upgrade snapshot) is kept or
  deleted now that the split docs exist

## Ideas / later

- Move business rows into typed Postgres `datasets` tables (kills the
  restart gap and memory ceiling; revisit when off free tiers)
- Dashboard-level filters applied across every tile of a custom dashboard
- Playlists: rotate several dashboards on one TV token
- Email verification, to allow self-signup safely
- Multi-instance safety: move rate limiting + webhook dedupe to Postgres

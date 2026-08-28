# DATA_MODEL.md

Source of truth: `server/db/migrations/*.sql` (applied in filename order at
boot, recorded in `schema_migrations`). All ids are `uuid`, all timestamps
`timestamptz`. Soft deletes use `deleted_at`.

## Identity and access

- **users** — `email` (citext, unique), `google_subject`, `display_name`,
  `picture_url`, `role` (`user`|`admin`), `status` (`active`|`disabled`),
  `password_hash`, `auth_provider`, `must_change_password` (via repository
  logic), `last_login_at`.
- **session** — created by connect-pg-simple at runtime; sessions are rows,
  which is what makes bulk revocation possible.

## Dashboards and UI state

- **dashboards** — the template registry (`template_key` unique, `name`,
  `is_system`). Seeded from `TEMPLATES` in server.js at boot; FK target for
  bindings, saved state, and share tokens.
- **user_preferences** — theme, default dashboard, presentation interval,
  `preferences` jsonb. (Table exists; only lightly used.)
- **saved_dashboard_states** — one row per (user, dashboard): `selected_view`,
  `filters`, `table_top_n`, `table_sorting`, `presentation_settings` jsonb.
- **saved_views / saved_reports** — named `configuration` jsonb per (user,
  dashboard).

## Sources and sync

- **tableau_connections** — per-user Tableau credentials: `server_url`,
  `site_id`, `pat_name`, `encrypted_pat_secret` (AES-256-GCM under
  `TABLEAU_CREDENTIAL_ENCRYPTION_KEY`), `status`, sync timestamps.
- **data_sources** — one row per committed source: `source_type`
  (`tableau_view`|`tableau_datasource`|`file`), `external_id` (Tableau LUID),
  `source_name`, `status` (`staged`|`loaded`|`syncing`|`error`|`needs_reload`|`stale`),
  `column_metadata` jsonb (per-column profiles: name, type, fillRate,
  distinct, min/max, samples), `last_row_count`, sync timestamps, and the
  webhook fields: `webhook_id`, `webhook_failed_id`, `webhook_secret`,
  `webhook_event`, `webhook_enabled`, `webhook_resource_luid`,
  `last_webhook_event_at`.
- **uploaded_files** — file-source metadata (name, mime, size, checksum);
  bytes themselves are never stored.
- **field_mappings** — versioned `mapping` jsonb (canonical field → source
  column) per (source, dashboard, schema_key).
- **dashboard_source_bindings** — which sources feed which dashboard
  (`enabled`, `combination_mode` union, `deduplication_key` id). Unique per
  (dashboard, source).
- **sync_runs** — one row per refresh attempt: `trigger_type`
  (`manual`|`scheduled`|`startup`|`webhook`), `status`
  (`running`|`succeeded`|`failed`), row counts, error message.

## Chart builder

- **saved_charts** — a chart is a CONFIG, never data: `data_source_id`,
  `chart_type`, `config` jsonb (`{version, type, slots, filters}`),
  `config_version`. Rendering = `chartEngine.buildChartData(rows, config)`.
- **custom_dashboards** — `name` + `layout` jsonb
  (`[{chartId, x, y, w, h}]` in 12-column grid units).

## Sharing

- **share_tokens** — TV wall credentials: `token_hash` (SHA-256; raw token
  shown once), exactly one of `dashboard_id` (template) or
  `custom_dashboard_id` (CHECK-enforced), `label`, `expires_at`,
  `revoked_at`, `last_used_at`.

## Observability

- **data_access_log** — reads of business data (who, which dashboard/source,
  row count).
- **audit_logs** — security-relevant actions (auth attempts, invites, role
  changes, source commits, token mint/revoke) with before/after state, IP,
  user agent.
- **application_errors** — server errors with route and (non-production)
  stack.

## Relationships at a glance

```
users ─┬─< tableau_connections ─< data_sources ─┬─< field_mappings >─ dashboards
       ├─< data_sources                          ├─< sync_runs
       ├─< saved_dashboard_states >─ dashboards  ├─< uploaded_files (file kind)
       ├─< saved_views / saved_reports           └─< dashboard_source_bindings >─ dashboards
       ├─< saved_charts >─ data_sources
       ├─< custom_dashboards ─< (layout references saved_charts by id)
       └─< share_tokens ─── dashboards ⊕ custom_dashboards (exactly one)
```

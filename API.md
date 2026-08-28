# API.md

All routes are JSON over `/api`. Auth column: **session** = signed-in cookie
(`requireAuth`), **admin** = session with the admin role, **public** = no auth,
**+token** = also accepts a scoped `X-Share-Token` header (TV walls).
Errors are `{ error: string }` with 400/401/403/404/409/429/502/503 as noted;
unexpected failures are 500 `{ error: 'Unexpected server error' }`.

## Auth and account

| Method & path | Auth | Notes |
|---|---|---|
| POST `/auth/login` | public | `{email,password}` → user; 401 uniform wrong-cred, 429 rate-limited |
| POST `/auth/verify` | public | `{credential}` Google ID token; domain-restricted; 503 if Google disabled |
| POST `/auth/signup` | public | 403 unless `ALLOW_SELF_SIGNUP=true`; membership-oracle-safe |
| GET `/auth/config` | public | `{googleClientId, selfSignupEnabled}` |
| GET `/auth/me` | public | session user or `null` |
| POST `/auth/logout` | session | |
| POST `/auth/change-password` | session | verifies current, revokes other sessions, 429-limited |
| DELETE `/auth/account` | session | `{confirmEmail, currentPassword}`; last-admin refused |

## Admin

| Method & path | Auth | Notes |
|---|---|---|
| GET `/admin/users` | admin | |
| POST `/admin/users` | admin | invite `{email,name,role}` → `{user, temporaryPassword}` (shown once) |
| PATCH `/admin/users/:id` | admin | `{role?, status?}`; self/last-admin lockout guards |
| DELETE `/admin/users/:id` | admin | transfers their sources to the acting admin |
| POST `/admin/users/:id/reset-password` | admin | → one-time temp password; revokes sessions |
| GET `/admin/logs?type=audit|errors&limit=` | admin | |
| POST `/admin/retention-cleanup` | admin | `{days}` (default 90) |

## Health

| GET `/health/database` | public | `{ok}` or 503 `{reason, summary}` (classified, no secrets) |

## Templates, state, share tokens

| Method & path | Auth | Notes |
|---|---|---|
| GET `/templates` | session | the five system boards + field sets |
| GET `/dashboards/:templateId/state` | session **+token** | token must match the template |
| PUT `/dashboards/:templateId/state` | session | |
| GET/POST `/dashboards/:templateId/saved-views` (and `saved-reports`) | session | |
| DELETE `/saved-views/:id` (and `saved-reports/:id`) | session | |
| POST `/share-tokens` | session | exactly one of `{templateId}` or `{customDashboardId}`, optional `label`, `expiresDays` → `{token}` shown once |
| GET `/share-tokens` | session | list mine, both kinds |
| DELETE `/share-tokens/:id` | session | revoke |
| GET `/share/resolve` | public+token | `{templateKey, customDashboardId}` for a valid token; 401 otherwise |

## Board data (all GET, session **+token** scoped to that board)

`/data/:templateId` (filtered canonical rows) · `/options/:templateId`
(session only; filter menus) · `/win-board/metrics|snapshot` ·
`/loss-board/metrics|snapshot` · `/ae-performance/metrics|snapshot` ·
`/am-performance/metrics|snapshot` · `/comparison/:templateId`.
POST `/data/:templateId/load` (admin) loads a JSON row array into the caller's
own scope — dev/testing helper.

## Data sources (`/datasources`)

| Method & path | Auth | Notes |
|---|---|---|
| POST `upload/preview`, `upload/batch-preview` | session | multipart; → `stagingId` + auto-mapping preview |
| POST `preview/rows` | session | coerced rows + fill rates for a candidate mapping |
| POST `upload/commit` | session | `{stagingId, templateIds, fieldMapping}`; supersedes prior binding of the same source |
| GET `staged` / POST `staged/clear` | session | staging survives page reloads, not restarts |
| GET `/` | session | my sources with bindings, webhook state, last sync |
| GET `sync-history?sourceId=` | session | last 100 runs |
| GET `/:sourceId/schema` | session | column profiles + `live` (rows in memory now) |
| DELETE `/:sourceId` | session | soft delete + unbind |
| POST `/:sourceId/refresh` | session | re-pull now; 502 with actionable Tableau error |
| POST `/:sourceId/webhook/enable|disable` | session | registers success+failure webhooks; needs `APP_BASE_URL` |
| POST `webhook/:sourceId/:secret` | public | Tableau callback; 200-fast, LUID-filtered, failure→`stale`, deduped |
| POST `tableau/connect|disconnect|restore` | session | PAT stored encrypted; restore re-signs-in |
| GET `tableau/connections|status|views|datasources` | session | 409 when not connected |
| POST `tableau/preview`, `tableau/datasource-preview` | session | stage a view (CSV) or datasource (VDS) |

## Chart builder (`/charts`)

| Method & path | Auth | Notes |
|---|---|---|
| GET `options/:sourceId` | session | catalogue + per-type availability/reason + suggested bindings + columns |
| POST `preview` | session | `{sourceId, config}` → render data; 409 if rows not loaded |
| POST `inspect` | session | `{chartId | sourceId+config, where}` → raw rows behind an element (≤100) |
| POST `/` · GET `/` · GET `/:chartId` · PUT `/:chartId` · DELETE `/:chartId` | session | config is validated structurally; version must match |
| GET `/:chartId/data` | session **+token** | token must be a custom-dashboard token whose layout contains this chart |

## Custom dashboards (`/custom-dashboards`)

| Method & path | Auth | Notes |
|---|---|---|
| POST `/` · GET `/` · PUT `/:id` · DELETE `/:id` | session | layout validated (`[{chartId,x,y,w,h}]`, ≤40 tiles) |
| GET `/:id` | session **+token** | token must target exactly this dashboard; includes resolved charts |

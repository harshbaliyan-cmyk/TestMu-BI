# TestMu BI — Project Documentation

**Current implementation as of:** 14 August 2026  
**Repository:** `saas-dashboard`  
**Status:** Local full-stack application connected to Neon PostgreSQL; deployment is not currently in scope.

> This document is the current source of truth for the code in this workspace. The older `PROJECT_PRD.md` outside the repository is useful as historical context, but it no longer accurately describes the application, authentication, filters, database, mapping workflow, dashboards, or presentation layer.

## 1. Executive summary

TestMu BI is a sales analytics application built around opportunity data imported from files or Tableau Cloud. It currently contains:

- A real account and session system with email/password authentication, optional Google authentication, admin roles, and an explicitly enabled development login.
- A dashboard gallery containing Opportunity Analytics, Win Board, Event Analytics, and Tenant Health entries.
- A six-view Opportunity Analytics dashboard.
- A dedicated single-view Win Board focused on Won ARR, ARR win rate, opportunity-count win rate, and contribution.
- Searchable multi-select filters, advanced date ranges, sortable tables, Top N controls, interactive tooltips, dark/light themes, and a fixed floating filter launcher.
- TV-oriented presentation modes for both Opportunity Analytics and Win Board, each with their own dedicated slide builder.
- Multi-file upload and Tableau Cloud ingestion, separate preview and mapping steps, mapping to multiple dashboards, saved source metadata, refresh controls, and sync history.
- Neon PostgreSQL for application metadata, sessions, saved dashboard state, connection metadata, mappings, logs, and saved content.

The application is intentionally **not an analytics warehouse yet**. Uploaded file bytes and imported business rows are held in server memory, not PostgreSQL. See [Known limitations and next steps](#20-known-limitations-and-next-steps).

## 2. Current dashboard scope

| Dashboard | Current state | Views |
|---|---|---|
| Opportunity Analytics | Implemented | Pulse, Diagnostics, Velocity & Aging, Where We Win, Rep Performance, Accounts & Whitespace |
| Win Board | Implemented as a dedicated single view | One view with a global percentage-display selector |
| Event Analytics | Gallery/template entry only | Currently reuses the generic opportunity dashboard and mapping schema |
| Tenant Health | Gallery/template entry only | Currently reuses the generic opportunity dashboard and mapping schema |

## 3. Architecture

```text
Files (CSV/TSV/XLSX/JSON) ─┐
                            ├─> Express import/mapping layer ─> in-memory business-row cache
Tableau views/data sources ─┘                                      │
                                                                  ├─> Opportunity Analytics APIs
React + Vite UI <─ cookie session ─> Express API                   └─> Win Board snapshot API
                                  │
                                  └─> Neon PostgreSQL
                                      users, sessions, preferences,
                                      mappings, bindings, source metadata,
                                      sync/audit/error logs, saved content
```

### 3.1 Frontend

- React 18 and React Router.
- Vite development/build tooling.
- Chart.js plus custom React/SVG/CSS visualizations.
- Axios with cookie credentials for API calls.
- Global styling and theme tokens in [`client/src/index.css`](client/src/index.css).

Primary files:

- [`client/src/App.jsx`](client/src/App.jsx) — authenticated route configuration and global background.
- [`client/src/pages/Dashboard.jsx`](client/src/pages/Dashboard.jsx) — Opportunity Analytics.
- [`client/src/pages/WinBoard.jsx`](client/src/pages/WinBoard.jsx) — Win Board. Also exports its chart components (`TrendChart`, `TeamContributionDonut`, `OrgTypeFillBars`, `PodRadialScorecards`, `RankFunnel`, `PercentChart`) and a few small helpers so the presentation page can reuse the exact same visuals instead of a simplified rebuild.
- [`client/src/pages/Presentation.jsx`](client/src/pages/Presentation.jsx) — TV presentation mode for Opportunity Analytics.
- [`client/src/pages/WinBoardPresentation.jsx`](client/src/pages/WinBoardPresentation.jsx) — TV presentation mode for Win Board.
- [`client/src/pages/DataSources.jsx`](client/src/pages/DataSources.jsx) — upload, Tableau, preview, mapping, refresh, and sync UI.
- [`client/src/components/charts.jsx`](client/src/components/charts.jsx) — shared chart and filter components.
- [`client/src/components/AdvancedDateRange.jsx`](client/src/components/AdvancedDateRange.jsx) — Win Board date presets.

### 3.2 Backend

- Express API server.
- `express-session`; PostgreSQL-backed sessions when `DATABASE_URL` is configured.
- `pg` connection pool for Neon/PostgreSQL.
- `multer` for in-memory uploads.
- `xlsx` for spreadsheet and delimited-file parsing.
- Tableau REST/VizQL Data Service integration through Axios.
- `node-cron` for scheduled Tableau refreshes.

Primary files:

- [`server/server.js`](server/server.js) — API, authentication, runtime dashboard cache, dashboard endpoints, and legacy sync path.
- [`server/datasources.js`](server/datasources.js) — canonical mapping schema and data-source router.
- [`server/services/winBoardMetrics.js`](server/services/winBoardMetrics.js) — Win Board aggregation and category comparisons.
- [`server/services/periodComparison.js`](server/services/periodComparison.js) — comparison-period boundaries and overall deltas.
- [`server/repositories`](server/repositories) — PostgreSQL data access.
- [`server/db/migrations`](server/db/migrations) — database schema.

### 3.3 Durable versus runtime data

Neon is the durable **application metadata and session database**.

Stored durably:

- Users and password/Google identity data.
- Login sessions.
- Dashboard catalogue, saved filters, Top N, sorting, presentation settings, saved views, and saved reports.
- Tableau connection settings and encrypted PAT secrets.
- Data-source and uploaded-file metadata.
- Field mappings and dashboard-source bindings.
- Sync runs, access records, audit logs, and application errors.

Not stored durably:

- Uploaded file bytes.
- Parsed opportunity/business rows.
- Staged upload rows after a server restart.

Tableau-backed sources can be refreshed and rehydrated. File-backed sources require the user to reload the file after a restart and are marked `needs_reload`.

## 4. Prerequisites and quick start

### 4.1 Prerequisites

- A supported Node.js/npm installation. The current machine uses Node 24 and npm 11, but the project does not yet declare an `engines` policy.
- A Neon PostgreSQL project and pooled connection URL.
- Optional Tableau Cloud PAT credentials.
- Optional Google OAuth client ID.

### 4.2 Install

From the repository root:

```powershell
npm install
npm run install:all
```

### 4.3 Configure

Copy the variable names from `server/.env.example` into `server/.env`, then provide local values. Never commit `.env`.

At minimum for database-backed accounts and sessions:

```dotenv
DATABASE_URL=postgresql://...
DATABASE_SSL=true
SESSION_SECRET=use-a-long-random-value
TABLEAU_CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate a compatible encryption key in Windows PowerShell, including versions where the static `Fill` method is unavailable:

```powershell
$keyBytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($keyBytes)
$random.Dispose()
[Convert]::ToBase64String($keyBytes)
```

### 4.4 Run migrations

```powershell
Set-Location server
npm run db:migrate
```

Migrations are idempotent sorted SQL files. There is no migration-ledger or rollback mechanism yet.

### 4.5 Start locally

From the root:

```powershell
npm run dev
```

Default services:

- Client: `http://localhost:5173` (Vite may choose another free port).
- Server: `http://localhost:3001`.
- Database health: `GET http://localhost:3001/api/health/database`.

The root `server` script uses plain `node`, while `npm --prefix server run dev` uses `node --watch`. Restart the server when changing backend routes if it was started through the root script.

## 5. Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Development/production behavior |
| `PORT` | Express port, normally `3001` |
| `CLIENT_ORIGIN` | Allowed browser origin for CORS |
| `DATABASE_URL` | Neon/PostgreSQL connection URL |
| `DATABASE_SSL` | Enables PostgreSQL SSL |
| `DATABASE_POOL_SIZE` | Maximum PostgreSQL pool size |
| `SESSION_SECRET` | Server-side session signing secret |
| `SESSION_COOKIE_NAME` | Cookie name, default `testmu.sid` |
| `SESSION_MAX_AGE_HOURS` | Session lifetime |
| `GOOGLE_CLIENT_ID` | Optional Google Identity client ID |
| `ALLOWED_DOMAIN` | Optional permitted email domain |
| `ALLOW_DEV_LOGIN` | Enables explicit developer login outside production |
| `ADMIN_EMAILS` | Emails granted the admin role |
| `TABLEAU_CREDENTIAL_ENCRYPTION_KEY` | Base64 32-byte AES-256-GCM key |
| `TABLEAU_SOURCE_SYNC_CRON` | Saved Tableau-source refresh schedule; default every 12 hours |
| `CRON_TZ_OFFSET` | Cron timezone configuration |

The server also contains a legacy, environment-driven Tableau worksheet sync path using variables such as `TABLEAU_SERVER`, `TABLEAU_SITE_ID`, `TABLEAU_PAT_NAME`, `TABLEAU_PAT_SECRET`, `TABLEAU_VIEW_ID_*`, and `SYNC_ON_STARTUP`. This path should eventually be consolidated with the newer database-backed Tableau connection system.

## 6. Authentication, sessions, and security

Implemented:

- Email/password account creation and login.
- Password hashing with bcrypt cost 12.
- A minimum 10-character password enforced during signup.
- Google ID-token authentication when configured.
- Separate Google signup and login intent; login does not silently create an account.
- Optional allowed-domain restriction.
- Disabled-account checks.
- Explicit developer login only when enabled and not running in production.
- PostgreSQL session storage when the database is configured.
- HTTP-only cookies, SameSite `Lax`, and secure cookies in production.
- User/admin authorization guards.
- Logout and session regeneration.
- Tableau PAT encryption using AES-256-GCM.

Not yet implemented:

- Password reset.
- Email verification.
- MFA.
- Login rate limiting.
- CSRF tokens.
- User-facing session/device management.

## 7. Database model

Migrations live in [`server/db/migrations`](server/db/migrations):

1. `001_application_metadata.sql` — main application schema.
2. `002_password_accounts.sql` — password hash and authentication provider.
3. `003_sync_tracking.sql` — source sync-attempt tracking.
4. `004_win_board.sql` — Win Board dashboard seed.

Key tables:

| Table | Purpose |
|---|---|
| `users` | Accounts, roles, status, Google identity, login timestamps |
| `dashboards` | Dashboard template catalogue |
| `user_preferences` | Theme/default dashboard/general preference schema; repository/API not yet wired |
| `saved_dashboard_states` | Active view, filters, Top N, sorting, and presentation preferences |
| `saved_views` | Named dashboard configurations |
| `saved_reports` | Saved report definitions/configurations, not rendered report files |
| `tableau_connections` | Tableau server/site and encrypted PAT metadata |
| `data_sources` | File/Tableau source metadata and refresh state |
| `uploaded_files` | Filename, size, checksum, and row/column metadata |
| `field_mappings` | Canonical field mapping per source/dashboard/schema |
| `dashboard_source_bindings` | Many-to-many source/dashboard binding, union mode, precedence, dedup key |
| `sync_runs` | Sync status, row counts, errors, and timing |
| `data_access_log` | Source/dashboard access events |
| `audit_logs` | Administrative/entity changes |
| `application_errors` | Persisted uncaught API errors |

`connect-pg-simple` also creates/uses the session table.

## 8. Data-source workflow

### 8.1 File uploads

Supported formats:

- CSV
- TSV
- XLSX
- XLS
- JSON

Limits:

- Up to 10 files in one batch.
- Up to 25 MB per file.
- Uploads are held in memory.

Workflow:

1. Upload one or more files.
2. Preview headers, samples, and rows on a dedicated preview page.
3. Click **Map fields** to move to the mapping page.
4. Select one or more target dashboards.
5. Review automatic mappings and fill rates.
6. Search source columns and fix unmatched or incorrect fields.
7. Load the source.
8. Reopen the staged source to remap without immediately uploading again.

### 8.2 Tableau Cloud

Implemented:

- PAT connection and connection restore.
- Encrypted PAT persistence; secrets are never returned to the browser.
- Published workbook view discovery and CSV download.
- Published data-source discovery and VizQL Data Service queries.
- Search and multi-selection for Tableau items.
- Manual refresh of saved Tableau sources.
- Scheduled refresh, defaulting to every 12 hours.
- Sync status and history.

### 8.3 Multiple sources and dashboards

- One file, Tableau view, or Tableau published data source is mapped independently.
- One source can be connected to several dashboards at commit time.
- Several compatible sources can feed one dashboard.
- Rows are unioned in runtime memory.
- Nonblank Opportunity IDs are used as the deduplication key.
- Unrelated entity schemas are not automatically joined.
- The current commit UI submits one mapping for all selected dashboards, even though the database schema supports separate per-dashboard mappings.

## 9. Canonical opportunity mapping

The canonical mapping schema is `OPP_SCHEMA` in [`server/datasources.js`](server/datasources.js), grouped into essential, segmentation, metrics, and other fields.

Important identity rules:

- Distinct opportunities use **Opportunity ID**, never Opportunity Name.
- Distinct accounts use **Account ID**, never Account Name.
- Names remain display labels.

Important preferred automatic mappings:

| Canonical field | Preferred source field |
|---|---|
| Owner Name | `Owner Name` |
| Created Date | `Opportunity Created Date` |
| BDR name | `BDR Owner Name` |
| Opportunity identity | `Opportunity ID` |
| Account identity | `Account ID` |
| Team | `Team Name` |

The auto-mapper:

- Uses preferred headers, aliases, and fuzzy scoring.
- Prevents one source column being assigned to multiple canonical fields.
- Avoids mapping BDR Owner to Owner Name.
- Derives closed/won from Stage when explicit boolean fields are not mapped.
- Coerces booleans, currency/numeric values, and dates.

Win Board only shows the subset of mapping fields it consumes: Opportunity ID, Stage, ARR, Opportunity Created Date, Closed, Won, Region, Org Type, Industry, POD, Team Name, and Opportunity Type.

## 10. Opportunity Analytics

Opportunity Analytics contains six interactive views.

### 10.1 Pulse

- Total opportunities and open opportunities.
- Weighted forecast.
- Win rate, Open ARR, Won ARR, and cycle KPIs.
- Open opportunities by stage.
- Outcome mix.
- Bookings/win-rate trend.
- Pipeline created versus closed, with Created Date filtering.
- Region performance.
- Largest open opportunities table.

### 10.2 Diagnostics

- Loss-rate/value and open health KPIs.
- Open ARR by deal health.
- Win rate by org type.
- Loss reason Pareto chart with distinct opportunity counts.
- Scrollable loss-reason concentration matrix.
- At-risk pipeline table.

### 10.3 Velocity & Aging

- Average/median stage age and sales-cycle KPIs.
- Stalled opportunity and stalled ARR KPIs.
- Org-specific stale thresholds.
- Aging buckets.
- Average days by stage.
- Won/lost cycle comparisons.
- Org/type cycle tables.
- Stalled-opportunity table.

### 10.4 Where We Win

- Best org type and best industry, ranked primarily by Won ARR.
- Weakest industry and tracked-industry coverage.
- Region × org-type heatmap.
- Product portfolio.
- Source effectiveness and business mix.
- Sortable/Top N industry scorecard.

### 10.5 Rep Performance

- Active-rep and distribution KPIs.
- Rep performance scatter using **Owner Name**, not BDR Owner.
- Rep names appear in tooltips rather than cluttering the plot.
- POD outcomes and POD ARR table.
- Sortable owner scorecard.

### 10.6 Accounts & Whitespace

- Account coverage and opportunity engagement.
- Repeat-loss and expansion KPIs.
- Account outcome charts.
- Repeat-engagement conversion.
- Repeat-loss table.
- Expansion candidates.

### 10.7 Opportunity Analytics filters and interactions

- Searchable checkbox multi-select controls.
- Region, Org Type, Stage, Owner, Source, and Opportunity Type.
- Product was removed from the filter shelf and Stage was added.
- Stage options are sourced from the full active dataset so choosing opportunity types does not incorrectly reduce Stage to only Closed Won/Closed Lost.
- Separate Created Date and Close Date ranges.
- Persistent top shelf plus a fixed bottom-right filter launcher.
- Saved views and saved report definitions.
- Filter and table-state restoration after presentation mode.
- Clickable sortable table headers.
- Top 5/10/20/All controls for table-style charts.
- Horizontal scrolling for high-cardinality charts.
- Interactive hover/focus tooltips and marks.
- Uniform scatter gridlines and Owner Name labels in rep tooltips.
- Counts use Opportunity ID where backend aggregation is available.

## 11. Win Board

Win Board is a dedicated single-view dashboard. Its primary business measure is Won ARR, with rate and contribution percentages available as display modes.

### 11.1 Filters

- Region.
- Org Type.
- Industry.
- Opportunity Type, read dynamically from the uploaded dataset.
- Opportunity Created Date.
- Fixed bottom-right floating filter panel.

Filters and display settings are saved to the user’s dashboard state, with a `localStorage` mirror (same pattern as Opportunity Analytics) so the page has an instant seed before the backend round-trip resolves.

**Defaults**: Win Board now opens with **Current quarter** already selected (not "All dates") and **Won ARR contribution %** already selected as the display metric, so previous-period comparison arrows are visible immediately without the user touching a filter. "Reset" returns to this same default rather than to an empty state.

### 11.2 Global percentage display selector

The filter shelf includes **Display charts by**:

1. Opportunity-count win rate.
2. ARR win rate.
3. Won ARR contribution (default).

This is a display preference, not a row filter. Switching it does not refetch or change the underlying filtered dataset. Every chart's comparison arrow follows whichever metric is currently selected here — there is no independent "always contribution" mode.

### 11.3 KPI summary

The current compact summary strip shows:

- ARR win rate, with a comparison badge (e.g. "↑ 19.1 pp vs previous period").
- Opportunity win rate with closed/won/lost counts, with its own comparison badge.
- A visible line stating the exact comparison period, e.g. "Comparing Jul 1, 2026 – Aug 14, 2026 against the previous period Apr 1, 2026 – Jun 30, 2026" — pulled from the live snapshot response, not hardcoded.

Removed from the KPI row:

- Absolute Won ARR tile.
- Closed ARR tile.
- Standalone Won ARR growth tile.
- Repeated comparison badges that did not belong to the tile’s own metric.

### 11.4 Charts

#### Percentage trend

- Uses Opportunity Created Date.
- Defaults to chronological ascending order.
- Can be reversed with the sort control.
- Changes metric, title, formula, labels, and tooltip with the global percentage selector.
- The trend line uses the reference-inspired electric blue `#126BFF`, a translucent blue area fill, cyan-edged points, smooth interpolation, and a thin glossy highlight traced just above the stroke for a rounded "tube" cross-section (a Chart.js plugin, `lineGlow`, draws both the color-matched glow halo and the highlight).
- Self-contained as its own `TrendChart` component (extracted from the page so the Win Board presentation can reuse it identically).

Contribution trend semantics:

- Each period’s Won ARR divided by total filtered Won ARR across the selected date range.
- Period contribution values therefore divide the selected-period total and sum to approximately 100%.
- Known limitation: when the selected range includes a still-in-progress period (e.g. the current, partially elapsed month), that period will show a naturally smaller share purely because it hasn't finished accumulating — this can visually read as a decline that isn't a real performance drop. Not yet addressed; see [Known limitations](#20-known-limitations-and-next-steps).

#### Team chart

- Contribution mode uses a segmented part-to-whole donut, with an elevation shadow that follows the ring's own circular silhouette.
- ARR win-rate and opportunity-count win-rate modes no longer use nested concentric rings (found to be hard to compare at a glance). Instead each team gets its **own independent donut/ring gauge**, laid out side by side — a small multiples grid rather than one shared shape.
- Each rate gauge independently uses a fixed 0–100% scale; rates are not falsely normalized into a pie.
- Ranked legend, sort direction, previous-period arrows, and complete tooltips remain available.
- Team colors are a dedicated 4-color palette (Blue `#2563EB`, Green `#10B981`, Orange `#F59E0B`, Purple `#8B5CF6`), separate from the palette used by the other Win Board charts.

#### Industry chart

- Top 5 uses a ranked "pyramid" funnel with a beveled, glossy 3D surface treatment (a vertical light-to-shadow gradient layered over each tier's rank color, plus a drop-shadow that follows the trapezoid's own shape) and a color-matched glow.
- Top three are visually highlighted.
- Top 10/20/All use a standard percentage bar chart, rendered with a light-to-dark vertical gradient per bar (via a Chart.js scriptable `backgroundColor`) plus the same glow treatment, so it reads as a raised 3D block rather than a flat fill.
- Ranking follows the selected percentage metric before applying Top N.
- The label explicitly identifies the displayed percentage so a lower rate can legitimately appear above a higher rate when the selected ranking metric differs.

#### Org Type chart

- Horizontal fill bars on a fixed 0–100% scale, styled as a recessed channel with a raised, glossy, glowing fill bar (light-top/shadow-bottom gradient plus an inset bevel).
- Shows selected-period value, closed opportunity count, won/lost split, prior-period marker, and selected-metric change.
- The previous-period marker now shows its own percentage value in a small label next to the dot (previously an unlabeled marker that required reading the legend to understand).
- Uses its own dedicated 4-color palette (cyan `#00A3B8`, magenta `#E63D79`, lime `#66A80F`, blue `#1E7CFF`), separate from the industry chart's palette, so the two never share colors that could be confused as related.

#### POD chart

- Radial scorecards, styled as embossed rings (rim highlight + shadow around the ring's own edge, plus a recessed center) with a color-matched glow.
- Defaults to Top 5; supports Top 10, Top 20, and All.
- Top N is always selected from the highest performers for the active percentage metric.
- Ascending sort only reverses the chosen Top N; it never changes Top N into Bottom N.
- Rank 1, 2, and 3 use progressively larger rings; ranks 4+ remain compact.
- Vivid rank-based colors remain stable when sort direction changes.
- The previous-period marker now shows its own percentage value in a small label, same fix as the Org Type chart's marker.
- Responsive ring sizing is reduced on tablets and phones.
- Selected-period ring, previous-period marker, percentage-point arrow, and all supporting metrics are available.

### 11.5 Win Board tooltips

Custom tooltips are rendered through a body portal so they are not clipped or covered by neighboring animated cards or scroll containers.

The tooltip was redesigned from a dense list of ~9 rows (each spelling out its full formula inline, e.g. "Won ARR contribution (category Won ARR ÷ total filtered Won ARR × 100)") down to four focused pieces, since the long form was reported as crowded and hard to scan:

- One hero number: the current value of the selected percentage metric, in large type.
- One change line: e.g. "↓ 12.9 pp vs previous period (52.7%)", colored green/red/neutral by direction — or "No previous-period comparison yet" for a category with no baseline.
- One context line: closed opportunities and the won/lost split.
- A compact secondary row showing the two percentage metrics *not* currently selected, for reference, without repeating their formulas.

The equivalent Chart.js-native tooltip (used by the industry bar chart) was trimmed the same way — it now leads with the change line, followed by the two non-selected metrics, and no longer repeats the raw ARR-growth percentage alongside the percentage-point change.

Every chart card's subheading (the hint text under its title) was also rewritten from raw formula strings into a plain-English sentence, and it changes with the selected percentage view — e.g. "Shows the share of closed ARR that was won, broken down by team" versus "...each category's share of total Won ARR..." depending on which of the three views is active.

### 11.6 Color system, glow, and motion

Win Board's chart colors were found to fail computable accessibility checks (OKLCH lightness band, chroma floor, colorblind-pair separation, contrast) and were replaced with a validated 10-color palette (`#1E7CFF #D9530F #00A06B #C67900 #E63D79 #2FAE1D #7C5CFA #E84747 #00A3B8 #66A80F`) that passes those checks against both the dark (`#0B0F16`) and light (`#FFFFFF`) card surfaces. The Team and Org Type charts use their own separate, smaller palettes (see above) rather than this shared set.

Every chart — bars, rings, the donut, and the trend line — carries a soft glow in its own color (Chart.js canvas plugins `barGlow`/`lineGlow` for the two Chart.js-rendered charts; CSS `box-shadow`/SVG `drop-shadow` for the rest), plus a beveled/glossy 3D surface treatment (a vertical light-to-shadow gradient overlay and inset highlight/shadow) rather than flat fills. All of this is deliberately achieved through shading, not through actual 3D perspective/rotation — true 3D projection would make a bar's *apparent* size depend on how "far back" it's tilted, misrepresenting the value its width or height encodes.

Two layers of animation, both gated behind `prefers-reduced-motion`:

- A one-time staggered entrance animation on first render (bars grow, rings sweep in, the donut pops, the trend line draws in), driven by a `--i` CSS custom property set per row from each component's real render index.
- A subtle, infrequent "ambient" pulse (a brief brightness/scale lift roughly every 6–7 seconds, staggered per element) so the page reads as alive without competing for attention the way a full auto-cycling spotlight (tried and reverted) did.

All of the above is scoped under a `.win-board-wrap` class on Win Board's root element, so none of it touches Opportunity Analytics, Presentation, or any other page.

## 12. Metric and formula glossary

All counts below use distinct nonblank Opportunity ID in the Win Board backend.

### 12.1 Won ARR

```text
SUM(ARR for opportunities where Closed = true and Won = true)
```

### 12.2 Closed ARR

```text
SUM(ARR for opportunities where Closed = true)
```

This includes both won and lost closed opportunities.

### 12.3 ARR win rate

```text
Won ARR / Closed ARR × 100
```

Equivalent Tableau-style formula:

```text
SUM(IF [Won] THEN [ARR] END)
/
SUM(IF [Closed] THEN [ARR] END)
```

### 12.4 Opportunity-count win rate

```text
COUNTD(won Opportunity ID) / COUNTD(closed Opportunity ID) × 100
```

Equivalent Tableau-style formula:

```text
SUM(IF [Won] = true THEN 1 ELSE 0 END)
/
SUM(IF [Closed] = true THEN 1 ELSE 0 END)
```

The implementation deduplicates Opportunity ID before counting.

### 12.5 Won ARR contribution

```text
Category Won ARR / total filtered Won ARR × 100
```

The denominator is the total selected-period Won ARR after active non-date filters, not merely the visible Top N.

### 12.6 Won ARR growth

```text
(Current-period Won ARR - previous-period Won ARR)
/
Previous-period Won ARR × 100
```

If the prior Won ARR is zero or missing, growth is `N/A`/`No baseline`; the application does not invent a percentage.

### 12.7 Percentage-point change

For rate and contribution metrics:

```text
Current percentage - previous percentage
```

Example: 48% versus 51% is a decrease of **3 percentage points**, not a 3% relative decrease.

## 13. Date filtering and period comparison

Win Board comparisons always use Opportunity Created Date.

Available presets:

- Current week.
- Previous week.
- Current quarter.
- Previous quarter.
- Current year.
- Previous year.
- Last 7, 30, or 90 days.
- Previous N completed weeks, quarters, or years.
- Manual custom date range.

Comparison behavior:

- Custom and rolling ranges use the immediately preceding inclusive equal-length range.
- Calendar presets use calendar-aware comparison periods.
- Current quarter, current year, and current week each compare against the **complete** previous calendar quarter, year, or week — not merely the same number of days elapsed so far in an in-progress current period. (Current quarter already worked this way; current year and current week previously compared partial-to-partial and were corrected to match, since a partially elapsed current period should not be judged against an equally partial slice of the previous one.)
- Previous quarter compares with the preceding calendar quarter.
- Missing category or denominator baselines return null/`N/A`, not fake zero-based growth.

## 14. Presentation mode

Both Opportunity Analytics and Win Board can launch a TV/view-only presentation, each with its own dedicated page and slide builder — they do not share an implementation, since Win Board is server-aggregated (pre-computed metrics) while Opportunity Analytics recomputes everything from raw rows client-side.

### 14.1 Opportunity Analytics (`Presentation.jsx`, route `/present/:templateId`)

- **Present all views** or **Present this view only**.
- Current interactive filters and table Top N passed into the presentation.
- View-specific KPIs repeated across that view’s slides.
- Absolute Won ARR deliberately omitted from the KPI strip.
- Four-chart overview slides.
- Dedicated paginated slides for long tables/lists.
- Automatic slide advance, configurable interval from 10 seconds to 2 minutes, pause/play, previous/next, fullscreen, slide counter, exit.
- Current dashboard view name in the header, live clock and date.
- Fixed non-scrolling desktop slide canvas; responsive scrolling only on small screens.
- Launch config (filters, scope, view, table Top N) is written to `localStorage` **and** the backend (`saved_dashboard_states`) when Present is clicked; the presentation page reads `localStorage` first for an instant same-browser launch, then confirms or overrides from the backend — so a presentation link opened in a different browser/profile still reproduces the launching dashboard's filters.

### 14.2 Win Board (`WinBoardPresentation.jsx`, route `/present/win-board`)

- A single **"▶ Present"** button in Win Board's header (no all-views/this-view-only choice — Win Board has no tabs).
- One fixed, non-scrolling **16:9 TV canvas** rather than multiple chart slides. All graphs remain visible simultaneously.
- The main area contains the full five-metric KPI summary followed by a 2×2 chart grid: **Trend, Team, Industries, and Org Type**.
- A full-height right rail contains **Won ARR contribution % by POD**: one segmented, part-to-whole donut plus a vertically ranked Top-5 POD list with contribution bars, closed/won/lost counts, and prior-period percentage-point changes.
- The POD rail is deliberately fixed to contribution percentage. ARR win rate and opportunity-count win rate are independent rates and therefore are never falsely normalized into one segmented donut.
- The four main cards render the actual interactive Win Board chart components, preserving their formulas, filters, comparison data, colors, and tooltips.
- A subheading showing only the active **Created Date time range** (e.g. "Created date: Current quarter"). Category filters (region, org type, industry, opportunity type) are deliberately *not* listed here — with many or all values selected, spelling out every one produces an unreadable multi-line wall of text rather than a scannable subheading.
- Same launch/config-handoff mechanism as Opportunity Analytics (`localStorage` + backend dual-write, backend as the cross-browser fallback), using its own `testmu-winboard-presentation-config` key and fetching data through `getWinBoardSnapshot`, never the raw-row endpoint.
- Fullscreen and Exit controls float above the canvas and auto-hide in fullscreen instead of consuming a permanent layout row.
- Continuous spin/glow effects are disabled in this always-on TV view; only short entrance animations remain.
- The layout is optimized for 1920×1080 and also scales down to common 1366×768 16:9 displays without introducing page scrolling.

Both presentation modes restore their dashboard without resetting filters on exit.

## 15. Themes, background, accessibility, and performance

### 15.1 Theme

- Dark and light mode across the application.
- Dark mode uses a black page background and dark cards.
- Light mode uses light cards and readable chart labels.
- Theme changes update Chart.js axes, legends, and tooltips.

### 15.2 Background

- The original heavier 3D/WebGL-style concept was toned down.
- The current design uses lightweight CSS slideshow/deck layers and low-cost ambient motion.
- The look is presentation-inspired rather than a continuously rendered 3D scene.
- `prefers-reduced-motion` disables decorative animation.
- Win Board additionally carries its own chart-level glow, beveled 3D surface treatment, and periodic ambient-pulse animation, scoped separately from this app-wide background — see [11.6 Color system, glow, and motion](#116-color-system-glow-and-motion).

### 15.3 Interaction/accessibility

- Filter and date popovers use portals and viewport-aware positioning.
- Tooltips flip and clamp within the viewport.
- Interactive custom marks are keyboard-focusable and carry descriptive ARIA labels.
- Tables expose sort direction through their headers.
- Responsive layouts preserve controls and chart readability.

## 16. Saved state and content

Persisted dashboard state includes:

- Active view.
- Filters.
- Table Top N.
- Table sorting.
- Win Board percentage view.
- Industry Top N.
- POD Top N.
- Presentation settings.

Saved views:

- Can be created and restored from Opportunity Analytics.

Saved reports:

- Report definitions/configuration can be created through the API/UI action.
- There is not yet a complete frontend library for listing, opening, renaming, updating, or deleting saved reports.

## 17. Logging and administration

Implemented:

- Admin-only Logs page.
- Audit-log and application-error tabs.
- Confirmed retention cleanup, normally 90 days.
- Sync history on the Data Sources page.
- Source-access records in PostgreSQL.
- Upload commit and Tableau connection audit events.

Retention endpoint:

```text
POST /api/admin/retention-cleanup
{ "days": 90 }
```

The current Admin Logs page does not display the `data_access_log` table.

## 18. API overview

### Authentication

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/verify`
- `POST /api/auth/dev-login`
- `GET /api/auth/config`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### Dashboard state and saved content

- `GET /api/templates`
- `GET /api/dashboards/:templateId/state`
- `PUT /api/dashboards/:templateId/state`
- `GET|POST /api/dashboards/:templateId/saved-views`
- `GET|POST /api/dashboards/:templateId/saved-reports`
- `DELETE /api/saved-views/:id`
- `DELETE /api/saved-reports/:id`

### Dashboard data

- `GET /api/dashboard-data`
- `GET /api/data/:templateId`
- `GET /api/options/:templateId`
- `POST /api/data/:templateId/load`
- `POST /api/refresh-now`
- `GET /api/sync-status`

### Win Board

- `GET /api/win-board/metrics`
- `GET /api/win-board/snapshot`
- `GET /api/comparison/:templateId`

The snapshot endpoint is authoritative for keeping KPI values and comparison badges on the same filtered row snapshot.

### Data sources

Mounted under `/api/datasources`:

- File preview and batch preview.
- Preview rows.
- Staged source access/clear.
- Upload commit.
- Source list.
- Source delete (`DELETE /:sourceId`) — soft-deletes the `data_sources` row, disables its `dashboard_source_bindings`, and evicts its rows from the in-memory runtime cache so a deleted source's data stops appearing on affected dashboards immediately, not only after a restart.
- Sync history.
- Source refresh.
- Tableau connect/disconnect/restore/status.
- Tableau connection list.
- Tableau views and view preview.
- Tableau published data sources and data-source preview.

### Administration and health

- `GET /api/admin/logs`
- `POST /api/admin/retention-cleanup`
- `GET /api/health/database`

## 19. Verification

### 19.1 Server tests

```powershell
Set-Location server
npm test
```

Current result on 14 August 2026:

```text
26 tests passed
0 failed
```

Coverage includes:

- Tableau credential encryption/decryption.
- Preferred field mapping.
- Stage-derived closed/won values.
- Win Board formulas and denominators.
- Opportunity ID distinctness.
- Contribution rules.
- Period boundaries and current/previous-quarter consistency, plus current-year and current-week full-previous-period consistency.
- All three category percentage views.
- Category growth and missing-baseline handling.
- Snapshot/KPI/comparison consistency.
- Closed ARR and deal-win-rate comparisons.

### 19.2 Client production build

```powershell
Set-Location client
npm run build
```

Current result:

```text
Build successful
106 modules transformed
```

Vite reports a chunk-size warning because the main bundle is approximately 609 kB minified. This is a performance warning, not a build failure.

### 19.3 Additional checks

```powershell
node --check server/server.js
node --check server/datasources.js
```

Then verify:

- `GET /api/health/database`
- Login/signup/logout.
- File preview → mapping → load.
- Tableau refresh, and Tableau connection delete.
- Opportunity Analytics filters and saved state.
- Win Board percentage selector, date comparisons, Top N, and tooltips.
- Win Board and Opportunity Analytics presentation entry/exit and filter restoration.

Note for local development: the Express server does not hot-reload on file changes (the root `npm run dev` script uses plain `node`, not `node --watch`). After any backend change, a server process already running from before the change is serving stale code and must be restarted — the symptom is that a fix "doesn't seem to work" even though the code is correct.

## 20. Known limitations and next steps

### Highest priority

1. Persist business rows or move them to an analytics store/object storage so file-backed dashboards survive restarts.
2. Add dedicated Event Analytics and Tenant Health implementations or clearly mark them as unavailable.
3. Consolidate the two Tableau sync architectures into the saved-source system.
4. Add frontend automated tests for filters, mapping, period selection, Top N, tooltip semantics, and presentation state.
5. Fix the Won ARR contribution trend's still-in-progress-period distortion (§11.4): when the selected range includes a partial current period, that period's naturally-smaller share can visually read as a decline that isn't real. Not yet addressed — candidate fixes (excluding the partial period, labeling it distinctly, or switching the trend to absolute ARR) were discussed but not decided.

### Data correctness and scale

- Opportunity Analytics still contains calculations that assume one API row equals one opportunity. Multi-row Tableau extracts can inflate those metrics. Win Board already deduplicates by Opportunity ID in the backend.
- Presentation calculations share the same one-row-per-opportunity assumption.
- Runtime-memory storage scales with uploaded rows and concurrent users.
- File sources need manual reload after a restart.
- Tableau batch imports run sequentially and may finish partially; the UI reports completed items before failure.
- Negative/correction ARR may produce contribution values outside the usual 0–100% range; current chart geometry clamps visual positions.

### Product gaps

- Event Analytics and Tenant Health are not dedicated dashboards.
- Saved reports lack a full management UI.
- Data sources can now be deleted (soft-delete + runtime cache eviction), but there is still no rebind flow (moving an existing source's bindings to a different dashboard without re-uploading).
- No persistent file-row reload endpoint.
- No automatic cross-entity joins.
- Forecast weights remain hardcoded and under review.
- Expected Revenue is mapped but unused.

### Technical debt

- `server/server.js` still contains the legacy, environment-variable-driven Tableau worksheet sync path (`TableauClient`, `syncAllWorksheets`, `scheduleSync`) alongside the canonical, database-backed mapping/sync system in `server/datasources.js`. The vestigial duplicate schema constants that used to sit next to it (`OPP_SCHEMA`, `STAGE_ORDER`, etc., unused and superseded by the real schema in `datasources.js`) have been removed, but the two sync *architectures* themselves are not yet consolidated.
- A stale comment in `server/datasources.js` says Tableau credentials are memory-only; they are now encrypted in PostgreSQL.
- Database migrations have no ledger or rollback system.
- `user_preferences` exists in the schema but has no complete repository/API workflow.
- Generic error persistence does not capture every datasource handler error because several handlers catch and respond directly.
- `GET /api/data/:templateId` reads the runtime cache directly (`cacheGet`), while the Win Board/options/comparison routes read it through `dashboardRows()`, which additionally backfills a few fields from the Opportunity Analytics cache by matching id. The two accessors are not interchangeable; a new route needs to deliberately choose the right one. Not currently causing incorrect output anywhere, but worth being aware of before adding another endpoint.
- The existing `DATABASE_SETUP.md` mentions Three.js in the bundle warning, but the current client has no Three.js dependency.
- The workspace is not currently a Git worktree and has no root `.gitignore`; `.env`, `node_modules`, and build outputs must never be added to source control when version control is initialized.

## 21. Implementation history

This section summarizes the major work completed during the current project iteration.

### Filters and interaction

- Converted single-select dashboard filters into searchable checkbox multi-select dropdowns.
- Preserved an always-visible top filter shelf.
- Added a fixed bottom-right filter launcher and moved it to the right.
- Added floating filter panels to Opportunity Analytics and Win Board.
- Fixed popover clipping/overlap by rendering menus at document level and repositioning them on resize/scroll.
- Repaired date-filter visibility in light mode.
- Replaced Product with Stage on the Opportunity Analytics shelf.
- Added dynamic Opportunity Type options on Win Board.
- Added current/previous week, quarter, year, rolling ranges, previous N periods, and manual dates.
- Ensured filters survive entering and exiting presentation mode.

### Data correctness

- Corrected distinct opportunity counts to use Opportunity ID rather than Opportunity Name.
- Documented Account ID as the distinct-account key.
- Corrected Owner mapping to Owner Name.
- Corrected Created Date mapping to Opportunity Created Date.
- Corrected BDR mapping to BDR Owner Name.
- Corrected rep charts and scorecards to use Owner Name.
- Added distinct opportunity counts to loss charts and tooltips.
- Rechecked percentage and chart calculations against uploaded data rather than hardcoded numbers.
- Fixed date-filter application to the pipeline-created trend.
- Fixed current-quarter comparison so it matches the explicitly selected previous quarter.
- Unified Win Board KPI and comparison data in one snapshot to avoid stale/mismatched percentages.
- Corrected Best Industry logic to rank by Won ARR consistently with its table.

### Dashboard/chart UI

- Applied the TestMu BI logo and brand-inspired color system.
- Added dark/light themes throughout the app.
- Switched dark mode page background to black.
- Replaced the heavy 3D background concept with lightweight presentation-style slideshow layers.
- Improved button/control sizing and responsive layout.
- Reworked low-value bar charts into scatter, donut, funnel, fill-bar, radial, heatmap, gauge, and other modern forms where appropriate.
- Added interactivity and tooltips to charts.
- Standardized scatter gridlines.
- Removed crowded rep labels from the plot and kept them in tooltips.
- Fixed chart colors and light-mode label contrast.
- Added sort ascending/descending controls to charts.
- Added clickable sortable headers to table charts.
- Added Top N to table charts and preserved it in presentation mode.
- Made long heatmaps/matrices scrollable.
- Fixed clipped axes and overflowing tooltips.
- Portalled Win Board custom tooltips so cards cannot cover them.

### Opportunity Analytics changes

- Removed duplicate Open Pipeline and Closed-Won Value tiles.
- Added Total Opportunities and Open Opportunities KPIs.
- Clarified Weighted Forecast semantics.
- Reworked region, aging, org-type, POD, health, product, rep, account, and loss visualizations.
- Added Won ARR as the primary Where We Win ranking and retained win rate as supporting context.
- Added closed, won, and lost counts to POD performance.
- Added Top N and sortable table behavior throughout relevant views.

### Presentation layer

- Added a TV/view-only presentation route.
- Added All views versus This view only launch choices.
- Kept view-specific KPIs on every slide and stopped treating KPIs as charts.
- Added four-chart overview slides and dedicated slides for long content.
- Added auto-play, pause, interval selection, navigation, fullscreen, clock/date, slide/view labels, and exit.
- Removed desktop scrolling and sized content to the viewport.
- Corrected KPI carryover between views.
- Passed filter and Top N state into presentation mode.
- Improved pagination so nearly empty trailing slides are avoided where space permits.

### Data sources, database, and authentication

- Connected the app to Neon PostgreSQL.
- Added database migrations for users, sessions, dashboard state, saved content, Tableau connections, data-source metadata, mappings, bindings, sync history, and logs.
- Added real signup/login instead of automatic login/signup.
- Added optional Google authentication and explicit development login.
- Added encrypted Tableau PAT persistence.
- Added multi-file upload and multi-Tableau-item selection.
- Added simultaneous mapping/binding to multiple dashboards.
- Separated preview and mapping into distinct workflow steps.
- Simplified mapping fields by selected dashboard.
- Added mapping search, unmatched filtering, searchable column dropdowns, fill rates, and validation.
- Added saved source list, refresh, and sync history.
- Added audit/error logs and retention cleanup.

### Win Board

- Added the dedicated single-view Win Board.
- Implemented backend-calculated Won ARR, Closed ARR, ARR win rate, opportunity-count win rate, and contribution.
- Added Created Date, Region, Org Type, Industry, Opportunity Type filters.
- Added global percentage display modes for all breakdown charts.
- Added previous-period comparisons per KPI/category.
- Added meaningful rate-versus-growth labels and formulas.
- Removed absolute Won ARR/Closed ARR/growth KPI tiles as requested and consolidated rate KPIs.
- Added chronological trend and reference-blue styling.
- Added team contribution donut and independent concentric rate donuts.
- Added industry Top N funnel.
- Added org-type horizontal fills with opportunity outcome context.
- Added POD radial scorecards, Top N persistence, distinct rank colors, and enlarged top-three rings.

### Bug fixes (13–14 August 2026)

- Fixed a duplicate, shadowed `GET /staged` route in `server/datasources.js` — Express only ever dispatched the first (inferior) handler, so reopening a staged source to adjust mapping silently discarded previously saved field-mapping edits.
- Moved three routes (`/api/win-board/metrics`, `/api/win-board/snapshot`, `/api/comparison/:templateId`) to before the centralized error-handling middleware in `server/server.js` — they were previously registered after it, so an exception in any of them bypassed both the JSON error response and `application_errors` logging.
- Removed dead, superseded legacy schema constants (`OPP_SCHEMA`, `STAGE_ORDER`, etc.) from `server/server.js`.
- `Presentation.jsx` (Opportunity Analytics) now also reads its launch config from the backend (`getDashboardState`), not only `localStorage` — a presentation link opened in a different browser/profile previously couldn't reproduce the launching dashboard's filters.
- Fixed `current-year` and `current-week` period comparisons in `server/services/periodComparison.js` to compare against the *complete* previous calendar year/week, matching how `current-quarter` already worked — they previously compared only the same number of days elapsed so far in the current, in-progress period, which understates a real comparison.
- Fixed a Tableau connection bug where a sign-in response missing site info was silently accepted, leaving later requests to build a URL like `/sites/null/views` — Tableau's own 404 for that literally reads `Site 'null' could not be found`, a confusing symptom of an earlier failure. `TableauSession.signin()` now throws immediately, with a clear message, at the point the real problem happens.
- `tableauError()` now recognizes an expired/revoked-token response (previously surfaced as Tableau's raw text, e.g. "The provided authentication token failed to authenticate") and returns actionable guidance instead.
- Removed a dead, permanently-hidden "live preview of the mapped data" table in `DataSources.jsx`.

### Win Board comparison feature (13–14 August 2026)

- Win Board now defaults to **Current quarter** and **Won ARR contribution %** on load (previously "All dates" and ARR win rate), so comparison arrows are visible immediately.
- Added dip/up comparison badges to the two top-level KPI tiles and a visible "Comparing X vs Y" line showing the exact current/previous date ranges.
- Added `localStorage` mirroring to Win Board's own state persistence (previously backend-only), matching Opportunity Analytics' existing dual-write pattern.
- Renamed the compact "Won ARR contribution %" label to "Contribution %" in per-row badges (chart titles keep the full name).
- Added the previous-period percentage value directly on the Org Type and POD charts' previous-period markers (previously an unlabeled dot).
- Redesigned the custom metric tooltip from ~9 dense rows (each spelling out its full formula) to four focused pieces: a hero number, a change line, a context line, and a compact secondary row for the two non-selected percentage views. Shrank its max width from 410px to 280px.
- Rewrote every chart's subheading from a raw formula string into a plain-English sentence that changes with the selected percentage view.

### Win Board visual redesign (14 August 2026)

- Replaced Win Board's chart colors with a validated 10-color palette (passes computable OKLCH lightness-band, chroma-floor, colorblind-separation, and contrast checks against both the dark and light card surfaces) — the original palette failed these checks, which read as the washed-out, low-contrast look that prompted the change. The Team chart and the Org Type chart each use their own separate, smaller palettes.
- Added a glow and a beveled/glossy 3D surface treatment to every chart (bars, rings, the donut, the trend line) — achieved entirely through shading/shadow, not actual 3D perspective, so no value's apparent size is distorted.
- Replaced the Team chart's nested concentric rate rings (hard to compare at a glance) with individual donut/ring gauges per team.
- Added a one-time staggered entrance animation and a separate, infrequent "ambient pulse" animation (both skipped under `prefers-reduced-motion`); an earlier auto-cycling "spotlight" that dimmed all but one item was built, found too distracting, and reverted in favor of the ambient pulse.
- See [§11.6](#116-color-system-glow-and-motion) for the full design rationale.

### Data sources

- Added a **Delete** action for connected data sources (any status — loaded, syncing, or error), including eviction from the in-memory runtime cache so removal takes effect immediately.
- Converted the always-visible "Sync history" table into a collapsed-by-default button that expands on click.

### Win Board presentation layer (14 August 2026)

- Added a dedicated presentation mode for Win Board (`WinBoardPresentation.jsx`, route `/present/win-board`), reusing Win Board's actual chart components rather than a simplified rebuild — see [§14.2](#142-win-board-winboardpresentationjsx-route-presentwin-board).
- Extracted the trend chart out of `WinBoard.jsx`'s main component into its own reusable, exported `TrendChart` component so the presentation page could import it directly.
- Sized the Team donut/gauges up substantially, and the industry funnel bars thicker, specifically within the presentation's much larger card — scoped so the interactive dashboard's layout is untouched.
- Fixed an industry-funnel overflow bug: `.rank-funnel`'s percentage-width rows resolved against an ambiguous ancestor inside the presentation's wide card, letting bars render past the card's edge with badges clipped off-screen. Gave the container an explicit `width:100%` and an `overflow:hidden` safety net.
- Enlarged the small "Ring = ...", "Marker = ..." legend/key rows across the funnel, Org Type, and POD charts for TV-viewing distance.
- The subheading showing what's driving the data on screen was scoped down from a full filter breakdown (region/org type/industry/opportunity type) to the Created Date time range only — with many or all category values selected, the full breakdown produced an unreadably long, multi-line wall of text.

### Win Board single-screen TV layout (17 August 2026)

- Replaced the stacked/cycling presentation layout with one fixed TV canvas containing every graph.
- Moved the KPI summary and four main charts into a left-side 2×2 board and added a dedicated full-height POD rail on the right.
- Added a mathematically correct segmented POD contribution donut that preserves each POD's share of total filtered Won ARR and leaves omitted/unassigned share as a neutral remainder instead of renormalizing Top 5 to 100%.
- Added a Top-5 vertical POD list with exact contribution percentages, outcome counts, prior-period change, shared dashboard tooltips, and stable rank colors.
- Converted driver controls into an auto-hidden overlay so they no longer reduce chart space.
- Reduced continuous presentation animation load for always-on TV use.

## 22. Ownership map

| Area | Main file(s) |
|---|---|
| Routes/application shell | `client/src/App.jsx` |
| Login and signup | `client/src/pages/Login.jsx`, `client/src/hooks/useAuth.js` |
| Dashboard gallery | `client/src/pages/Gallery.jsx` |
| Opportunity Analytics UI/calculations | `client/src/pages/Dashboard.jsx` |
| Win Board UI | `client/src/pages/WinBoard.jsx` |
| Opportunity Analytics presentation | `client/src/pages/Presentation.jsx` |
| Win Board presentation | `client/src/pages/WinBoardPresentation.jsx` (imports its charts from `WinBoard.jsx`) |
| Upload/Tableau/mapping UI | `client/src/pages/DataSources.jsx` |
| Shared charts/filters | `client/src/components/charts.jsx` |
| Date presets | `client/src/components/AdvancedDateRange.jsx` |
| Theme/background | `client/src/components/ThemeToggle.jsx`, `client/src/components/NeonVoidBackground.jsx`, `client/src/index.css` |
| API client | `client/src/lib/api.js` |
| Express API/auth/cache | `server/server.js` |
| Canonical mapping and datasource APIs | `server/datasources.js` |
| Win Board metrics | `server/services/winBoardMetrics.js` |
| Period comparisons | `server/services/periodComparison.js` |
| Credential encryption | `server/services/credentialCipher.js` |
| PostgreSQL repositories | `server/repositories/*` |
| Database migrations | `server/db/migrations/*` |
| Server tests | `server/test/core.test.js` |

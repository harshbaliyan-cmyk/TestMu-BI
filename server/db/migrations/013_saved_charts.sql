-- The chart builder's storage. A saved chart is a CONFIG — dataset id, chart
-- type, field bindings, filters, display options — never a stored image or a
-- stored query result. Rendering is a pure function of the config plus the
-- source's current rows (services/chartEngine.js), which is what lets one
-- saved chart appear on a dashboard, a TV wall, and a preview, and what makes
-- auto-refresh just "run it again". config_version is the compatibility
-- contract: bump it only with a migration path for existing rows.
CREATE TABLE IF NOT EXISTS saved_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  chart_type text NOT NULL,
  config jsonb NOT NULL,
  config_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS saved_charts_owner_idx ON saved_charts(owner_user_id, updated_at DESC);

-- A custom dashboard is a named grid of saved charts. layout holds
-- [{chartId, x, y, w, h}] in grid units; the charts themselves stay
-- independent rows so one chart can sit on several dashboards.
CREATE TABLE IF NOT EXISTS custom_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS custom_dashboards_owner_idx ON custom_dashboards(owner_user_id, updated_at DESC);

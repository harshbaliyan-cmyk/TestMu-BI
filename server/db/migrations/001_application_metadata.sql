CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  google_subject text UNIQUE,
  display_name text,
  picture_url text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  owner_user_id uuid REFERENCES users(id),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme text,
  default_dashboard_id uuid REFERENCES dashboards(id),
  presentation_interval_seconds integer CHECK (presentation_interval_seconds BETWEEN 3 AND 3600),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_dashboard_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  selected_view text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_top_n jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_sorting jsonb NOT NULL DEFAULT '{}'::jsonb,
  presentation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, dashboard_id)
);

CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tableau_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  server_url text NOT NULL,
  site_id text,
  pat_name text NOT NULL,
  encrypted_pat_secret text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  last_connected_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tableau_connection_id uuid REFERENCES tableau_connections(id),
  source_type text NOT NULL CHECK (source_type IN ('tableau_view', 'tableau_datasource', 'file')),
  external_id text,
  workbook_name text,
  project_name text,
  source_name text NOT NULL,
  source_table_name text,
  status text NOT NULL DEFAULT 'staged',
  column_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_row_count bigint,
  last_accessed_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid UNIQUE NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  mime_type text,
  byte_size bigint,
  checksum text,
  row_count bigint,
  column_count integer,
  status text NOT NULL DEFAULT 'staged',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  schema_key text NOT NULL DEFAULT 'opportunity',
  mapping jsonb NOT NULL,
  mapping_version integer NOT NULL DEFAULT 1,
  validation_status text NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(data_source_id, dashboard_id, schema_key, mapping_version)
);

CREATE TABLE IF NOT EXISTS dashboard_source_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  field_mapping_id uuid REFERENCES field_mappings(id),
  enabled boolean NOT NULL DEFAULT true,
  combination_mode text NOT NULL DEFAULT 'union' CHECK (combination_mode = 'union'),
  precedence integer NOT NULL DEFAULT 0,
  deduplication_key text NOT NULL DEFAULT 'id',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dashboard_id, data_source_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  initiated_by uuid REFERENCES users(id),
  trigger_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_read bigint,
  rows_accepted bigint,
  rows_rejected bigint,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS data_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  data_source_id uuid REFERENCES data_sources(id),
  dashboard_id uuid REFERENCES dashboards(id),
  action text NOT NULL,
  source_system text,
  row_count bigint,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  request_id text,
  route text,
  method text,
  error_code text,
  message text NOT NULL,
  stack_trace text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_states_user_dashboard_idx ON saved_dashboard_states(user_id, dashboard_id);
CREATE INDEX IF NOT EXISTS data_sources_external_idx ON data_sources(tableau_connection_id, external_id);
CREATE INDEX IF NOT EXISTS bindings_dashboard_idx ON dashboard_source_bindings(dashboard_id, enabled);
CREATE INDEX IF NOT EXISTS sync_runs_source_started_idx ON sync_runs(data_source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS access_log_created_idx ON data_access_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS errors_created_idx ON application_errors(created_at DESC);

INSERT INTO dashboards (template_key, name, description, is_system)
VALUES
  ('opportunity-analytics', 'Opportunity Analytics', 'Revenue funnel, win rates, rep performance', true),
  ('event-analytics', 'Event Analytics', 'Feature adoption and churn signals', true),
  ('tenant-health', 'Tenant Health', 'Account whitespace and expansion candidates', true)
ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at = now();

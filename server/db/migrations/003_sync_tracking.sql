ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS data_sources_owner_updated_idx ON data_sources(owner_user_id, updated_at DESC);

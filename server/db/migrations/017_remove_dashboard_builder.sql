-- Retire saved charts and user-built dashboards. Keep applied migrations
-- unchanged so existing installations and fresh databases converge here.
-- Template dashboards, their data sources, states and TV tokens are retained.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'share_tokens'
      AND column_name = 'custom_dashboard_id'
  ) THEN
    DELETE FROM share_tokens WHERE custom_dashboard_id IS NOT NULL;
    ALTER TABLE share_tokens DROP CONSTRAINT IF EXISTS share_tokens_one_target;
    ALTER TABLE share_tokens DROP COLUMN custom_dashboard_id;
  END IF;
END $$;
ALTER TABLE share_tokens ALTER COLUMN dashboard_id SET NOT NULL;

-- No CASCADE: an unexpected dependent object should fail the transaction
-- instead of silently removing anything beyond these retired features.
DROP TABLE IF EXISTS saved_charts;
DROP TABLE IF EXISTS custom_dashboards;

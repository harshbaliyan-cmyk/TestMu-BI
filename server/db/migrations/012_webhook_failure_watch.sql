-- A refresh-FAILED event from Tableau means the extract on their side is
-- broken: re-pulling would only re-read the last good extract and present it
-- as fresh. The source is marked 'stale' instead, so the Data Sources page
-- says so. One Tableau webhook watches exactly one event type, so success and
-- failure each need their own registration — this records the failure one.
ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS webhook_failed_id text;

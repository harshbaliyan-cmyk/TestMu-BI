-- finishSyncRun compared its mapped status column ('loaded'/'error') against
-- the sync_runs vocabulary ('succeeded'/'failed'), so the CASE never matched
-- and last_successful_sync_at was never written. Sources that had synced
-- hundreds of times still reported "Last refreshed: Never".
--
-- The real history is recoverable: sync_runs recorded every successful run
-- correctly. This restores it from there. Only NULL rows are touched, so
-- re-running never overwrites a timestamp the fixed code has since written.
UPDATE data_sources ds
SET last_successful_sync_at = latest.finished_at
FROM (
  SELECT data_source_id, max(finished_at) AS finished_at
  FROM sync_runs
  WHERE status = 'succeeded' AND finished_at IS NOT NULL
  GROUP BY data_source_id
) AS latest
WHERE ds.id = latest.data_source_id
  AND ds.last_successful_sync_at IS NULL;

-- Tableau registers webhooks per EVENT TYPE for the whole site: the create
-- payload accepts no resource filter, so one enabled source receives every
-- matching refresh on the site. This records which Tableau resource the
-- source actually watches (a datasource LUID, or the parent workbook's id
-- for a view source) so the callback can ignore events about anything else
-- instead of re-pulling its full extract each time.
ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS webhook_resource_luid text;

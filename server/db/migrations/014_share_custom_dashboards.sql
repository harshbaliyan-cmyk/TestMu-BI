-- Share tokens can now put a CUSTOM dashboard on a wall, not only the five
-- template boards. A token targets exactly one of the two — the CHECK makes a
-- token that opens "everything" unrepresentable, keeping the no-general-
-- purpose-bypass rule structural rather than behavioural.
ALTER TABLE share_tokens ALTER COLUMN dashboard_id DROP NOT NULL;
ALTER TABLE share_tokens
  ADD COLUMN IF NOT EXISTS custom_dashboard_id uuid REFERENCES custom_dashboards(id) ON DELETE CASCADE;

ALTER TABLE share_tokens DROP CONSTRAINT IF EXISTS share_tokens_one_target;
ALTER TABLE share_tokens ADD CONSTRAINT share_tokens_one_target
  CHECK ((dashboard_id IS NULL) <> (custom_dashboard_id IS NULL));

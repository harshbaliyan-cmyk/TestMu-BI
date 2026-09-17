-- Account erasure (deleteUserData) keeps a departed user's mappings, since the
-- sources they map were transferred to an admin, and nulls created_by so the
-- row stops pointing at a deleted person. That column was NOT NULL, so the
-- whole erasure transaction rolled back with 23502 for anyone who had ever
-- committed a mapping, which is every real user. The authorship is already
-- preserved in audit_logs.
ALTER TABLE field_mappings ALTER COLUMN created_by DROP NOT NULL;

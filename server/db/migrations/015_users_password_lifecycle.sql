-- users.js has read and written these three columns since admin invites and
-- forced password changes shipped, but no migration ever created them: the
-- live database got them by hand, and any database built from this folder
-- (a Neon branch, a colleague's local copy, a restore) fails every login with
-- 42703 "column must_change_password does not exist". Idempotent so the live
-- database is untouched.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- TV wall displays authenticate with a scoped, revocable share token instead
-- of a login session: a wall has nobody to type a password. Each token is
-- bound to exactly ONE dashboard and to the owner whose data it shows — never
-- a general-purpose bypass. Only a SHA-256 hash is stored; the token itself is
-- shown once at creation, so a database read can never recover a live link.
CREATE TABLE IF NOT EXISTS share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS share_tokens_owner_idx ON share_tokens(owner_user_id, created_at DESC);

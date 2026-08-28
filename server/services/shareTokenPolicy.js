// Whether a stored share token may still be used. Pure so the rule is
// testable without a database: revocation always wins, and an expiry in the
// past is as dead as a revocation. A token with neither lives until revoked —
// a wall display should not go dark on an arbitrary anniversary, and the
// Account page gives every token a visible Revoke button instead.
export function shareTokenUsable({ revokedAt, expiresAt } = {}, now = new Date()) {
  if (revokedAt) return false;
  if (expiresAt && new Date(expiresAt) <= now) return false;
  return true;
}

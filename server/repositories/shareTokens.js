import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { shareTokenUsable } from '../services/shareTokenPolicy.js';

// Store only the hash. A token grants read access to one template dashboard.
const hashToken = token => createHash('sha256').update(String(token)).digest('hex');

// Accept a query adapter so the same SQL can be checked against an isolated database.
export function createShareTokenStore(runQuery) {
  async function createShareToken({ userId, templateKey, label = null, expiresAt = null }) {
    if (!templateKey) throw Object.assign(new Error('A share token requires a dashboard template'), { status: 400 });
    const token = randomBytes(32).toString('base64url');
    const { rows } = await runQuery(`INSERT INTO share_tokens(owner_user_id,dashboard_id,token_hash,label,expires_at)
      SELECT $1, d.id, $2, $3, $4 FROM dashboards d WHERE d.template_key=$5
      RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`,
      [userId, hashToken(token), label, expiresAt, templateKey]);
    if (!rows[0]) throw Object.assign(new Error('Unknown dashboard'), { status: 400 });
    return { ...rows[0], token, templateKey };
  }

  async function listShareTokens(userId) {
    const { rows } = await runQuery(`SELECT st.id, st.label,
        d.template_key AS "templateKey", d.name AS "dashboardName",
        st.created_at AS "createdAt", st.expires_at AS "expiresAt", st.revoked_at AS "revokedAt",
        st.last_used_at AS "lastUsedAt"
      FROM share_tokens st
      JOIN dashboards d ON d.id = st.dashboard_id
      WHERE st.owner_user_id = $1 ORDER BY st.created_at DESC`, [userId]);
    return rows;
  }

  async function revokeShareToken(userId, tokenId) {
    const { rows } = await runQuery(`UPDATE share_tokens SET revoked_at = now()
      WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING id`, [tokenId, userId]);
    return Boolean(rows[0]);
  }

  // Unknown, revoked and expired links get the same refusal. An inner join also
  // rejects links without a surviving template target, even during an upgrade.
  async function resolveShareToken(token) {
    if (!token || typeof token !== 'string' || token.length > 128) return null;
    const { rows } = await runQuery(`SELECT st.id, st.owner_user_id AS "userId",
        d.template_key AS "templateKey", st.expires_at AS "expiresAt", st.revoked_at AS "revokedAt"
      FROM share_tokens st
      JOIN dashboards d ON d.id = st.dashboard_id
      WHERE st.token_hash = $1`, [hashToken(token)]);
    const found = rows[0];
    if (!found || !shareTokenUsable(found)) return null;
    runQuery('UPDATE share_tokens SET last_used_at = now() WHERE id = $1', [found.id]).catch(() => {});
    return { userId: found.userId, templateKey: found.templateKey };
  }

  return { createShareToken, listShareTokens, revokeShareToken, resolveShareToken };
}

export const { createShareToken, listShareTokens, revokeShareToken, resolveShareToken } = createShareTokenStore(query);

import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { shareTokenUsable } from '../services/shareTokenPolicy.js';

// Only the hash is ever stored or compared. The raw token exists exactly
// twice: in the creation response, and in the URL on the wall display.
const hashToken = token => createHash('sha256').update(String(token)).digest('hex');

// A token targets exactly one thing: a template board (templateKey) or a
// custom dashboard (customDashboardId). The schema CHECK enforces the same
// rule, so a both-or-neither call fails loudly instead of storing a token
// with ambiguous reach.
export async function createShareToken({ userId, templateKey = null, customDashboardId = null, label = null, expiresAt = null }) {
  if (Boolean(templateKey) === Boolean(customDashboardId)) {
    throw Object.assign(new Error('A share token targets exactly one dashboard'), { status: 400 });
  }
  const token = randomBytes(32).toString('base64url');
  const { rows } = templateKey
    ? await query(`INSERT INTO share_tokens(owner_user_id,dashboard_id,token_hash,label,expires_at)
        SELECT $1, d.id, $2, $3, $4 FROM dashboards d WHERE d.template_key=$5
        RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`,
        [userId, hashToken(token), label, expiresAt, templateKey])
    : await query(`INSERT INTO share_tokens(owner_user_id,custom_dashboard_id,token_hash,label,expires_at)
        SELECT $1, cd.id, $2, $3, $4 FROM custom_dashboards cd
        WHERE cd.id=$5 AND cd.owner_user_id=$1 AND cd.deleted_at IS NULL
        RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`,
        [userId, hashToken(token), label, expiresAt, customDashboardId]);
  if (!rows[0]) throw Object.assign(new Error('Unknown dashboard'), { status: 400 });
  return { ...rows[0], token, templateKey, customDashboardId };
}

export async function listShareTokens(userId) {
  const { rows } = await query(`SELECT st.id, st.label,
      d.template_key AS "templateKey", st.custom_dashboard_id AS "customDashboardId",
      COALESCE(d.name, cd.name) AS "dashboardName",
      st.created_at AS "createdAt", st.expires_at AS "expiresAt", st.revoked_at AS "revokedAt",
      st.last_used_at AS "lastUsedAt"
    FROM share_tokens st
    LEFT JOIN dashboards d ON d.id = st.dashboard_id
    LEFT JOIN custom_dashboards cd ON cd.id = st.custom_dashboard_id
    WHERE st.owner_user_id = $1 ORDER BY st.created_at DESC`, [userId]);
  return rows;
}

export async function revokeShareToken(userId, tokenId) {
  const { rows } = await query(`UPDATE share_tokens SET revoked_at = now()
    WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING id`, [tokenId, userId]);
  return Boolean(rows[0]);
}

// The grant a presented token carries: whose data, and which ONE dashboard —
// templateKey for a template board, customDashboardId for a custom one.
// Returns null for unknown, revoked and expired tokens alike — the caller
// cannot tell which, and neither can whoever is probing.
export async function resolveShareToken(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const { rows } = await query(`SELECT st.id, st.owner_user_id AS "userId",
      d.template_key AS "templateKey", st.custom_dashboard_id AS "customDashboardId",
      st.expires_at AS "expiresAt", st.revoked_at AS "revokedAt"
    FROM share_tokens st
    LEFT JOIN dashboards d ON d.id = st.dashboard_id
    WHERE st.token_hash = $1`, [hashToken(token)]);
  const found = rows[0];
  if (!found || !shareTokenUsable(found)) return null;
  // Best-effort bookkeeping; a failed timestamp write must not fail the wall.
  query('UPDATE share_tokens SET last_used_at = now() WHERE id = $1', [found.id]).catch(() => {});
  return { userId: found.userId, templateKey: found.templateKey, customDashboardId: found.customDashboardId };
}

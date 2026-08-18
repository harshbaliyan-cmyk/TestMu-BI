import { databaseEnabled, query } from '../db/pool.js';

const publicColumns = `id, name, server_url AS "server", site_id AS "siteId",
  pat_name AS "patName", status, last_connected_at AS "lastConnectedAt",
  last_successful_sync_at AS "lastSuccessfulSyncAt", last_sync_attempt_at AS "lastSyncAttemptAt"`;

export async function saveTableauConnection({ userId, name, server, siteId, patName, encryptedPatSecret }) {
  if (!databaseEnabled || !userId) return null;
  const existing = await query(`SELECT id FROM tableau_connections
    WHERE owner_user_id=$1 AND server_url=$2 AND COALESCE(site_id,'')=COALESCE($3,'') AND deleted_at IS NULL
    ORDER BY updated_at DESC LIMIT 1`, [userId, server, siteId || '']);
  if (existing.rows[0]) {
    const { rows } = await query(`UPDATE tableau_connections SET name=$2, pat_name=$3,
      encrypted_pat_secret=$4, status='connected', last_connected_at=now(), updated_at=now()
      WHERE id=$1 RETURNING ${publicColumns}`,
      [existing.rows[0].id, name, patName, encryptedPatSecret]);
    return rows[0];
  }
  const { rows } = await query(`INSERT INTO tableau_connections
    (owner_user_id,name,server_url,site_id,pat_name,encrypted_pat_secret,status,last_connected_at)
    VALUES ($1,$2,$3,$4,$5,$6,'connected',now()) RETURNING ${publicColumns}`,
    [userId, name, server, siteId || '', patName, encryptedPatSecret]);
  return rows[0];
}

export async function listTableauConnections(userId) {
  if (!databaseEnabled || !userId) return [];
  const { rows } = await query(`SELECT ${publicColumns} FROM tableau_connections
    WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC`, [userId]);
  return rows;
}

export async function getRestorableTableauConnection(userId, connectionId = null) {
  if (!databaseEnabled || !userId) return null;
  const params = [userId];
  let condition = '';
  if (connectionId) { params.push(connectionId); condition = 'AND id=$2'; }
  const { rows } = await query(`SELECT ${publicColumns}, encrypted_pat_secret AS "encryptedPatSecret"
    FROM tableau_connections WHERE owner_user_id=$1 ${condition} AND deleted_at IS NULL
    ORDER BY last_connected_at DESC NULLS LAST LIMIT 1`, params);
  return rows[0] || null;
}

export async function setTableauConnectionStatus(userId, connectionId, status) {
  if (!databaseEnabled || !userId || !connectionId) return;
  await query(`UPDATE tableau_connections SET status=$3, updated_at=now()
    WHERE owner_user_id=$1 AND id=$2`, [userId, connectionId, status]);
}

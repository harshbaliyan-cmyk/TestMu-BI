import { databaseEnabled, query } from '../db/pool.js';

// ipAddress and user_agent have dedicated columns, so they are written there
// rather than buried in the after_state JSON. That keeps them queryable for
// "where did this come from", and — more to the point for privacy — keeps them
// in one known place that a retention sweep or an erasure request can find,
// instead of scattered through free-form JSON.
export async function logAudit({
  userId, action, entityType, entityId = null, afterState = null,
  requestId = null, ipAddress = null, userAgent = null,
}) {
  if (!databaseEnabled) return;
  await query(`INSERT INTO audit_logs
    (actor_user_id,action,entity_type,entity_id,after_state,request_id,ip_address,user_agent)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [userId || null, action, entityType, entityId,
    afterState ? JSON.stringify(afterState) : null, requestId,
    // inet rejects a malformed value; an unparseable address must not take the
    // request down, so it is stored as unknown instead.
    /^[0-9a-fA-F:.]+$/.test(String(ipAddress || '')) ? ipAddress : null,
    userAgent ? String(userAgent).slice(0, 200) : null]);
}

export async function logSourceAccess({ userId, sourceId = null, dashboardKey = null, action, rowCount = null, details = {} }) {
  if (!databaseEnabled) return;
  let dashboardId = null;
  if (dashboardKey) {
    const result = await query('SELECT id FROM dashboards WHERE template_key=$1', [dashboardKey]);
    dashboardId = result.rows[0]?.id || null;
  }
  await query(`INSERT INTO data_access_log
    (user_id,data_source_id,dashboard_id,action,source_system,row_count,details)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [userId || null, sourceId, dashboardId, action,
    sourceId ? 'uploaded-source' : 'dashboard', rowCount, JSON.stringify(details)]);
}

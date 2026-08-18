import { query } from '../db/pool.js';

export async function listAdminLogs(type='audit', limit=100) {
  const safeLimit = Math.min(Math.max(Number(limit)||100,1),500);
  if (type === 'errors') {
    const { rows } = await query(`SELECT id,request_id AS "requestId",route,method,error_code AS "errorCode",message,created_at AS "createdAt"
      FROM application_errors ORDER BY created_at DESC LIMIT $1`,[safeLimit]); return rows;
  }
  const { rows } = await query(`SELECT a.id,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",
    a.after_state AS details,a.created_at AS "createdAt",u.email
    FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT $1`,[safeLimit]);
  return rows;
}

export async function cleanupOldRecords(days=90) {
  const safeDays = Math.min(Math.max(Number(days)||90,7),3650);
  const counts={};
  for (const table of ['audit_logs','data_access_log','application_errors']) {
    const result=await query(`DELETE FROM ${table} WHERE created_at < now() - ($1 * interval '1 day')`,[safeDays]);
    counts[table]=result.rowCount;
  }
  const syncResult=await query(`DELETE FROM sync_runs WHERE started_at < now() - ($1 * interval '1 day')`,[safeDays]);
  counts.sync_runs=syncResult.rowCount;
  return counts;
}

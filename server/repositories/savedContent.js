import { query } from '../db/pool.js';

const tableFor = kind => kind === 'reports' ? 'saved_reports' : 'saved_views';

export async function listSavedContent(userId, templateKey, kind) {
  const table = tableFor(kind);
  const { rows } = await query(`SELECT c.id,c.name,c.description,c.configuration,c.created_at AS "createdAt",c.updated_at AS "updatedAt"
    FROM ${table} c JOIN dashboards d ON d.id=c.dashboard_id
    WHERE c.user_id=$1 AND d.template_key=$2 ORDER BY c.updated_at DESC`, [userId, templateKey]);
  return rows;
}

export async function createSavedContent(userId, templateKey, kind, body) {
  const table = tableFor(kind);
  const dashboard = await query('SELECT id FROM dashboards WHERE template_key=$1', [templateKey]);
  if (!dashboard.rows[0]) throw Object.assign(new Error('Unknown dashboard'), { status: 404 });
  const reportFields = kind === 'reports' ? ',report_type' : ',is_default,is_shared';
  const reportValues = kind === 'reports' ? ',$6' : ',false,false';
  const params = [userId,dashboard.rows[0].id,body.name,body.description||null,JSON.stringify(body.configuration||{})];
  if (kind === 'reports') params.push(body.reportType || 'dashboard_snapshot');
  const { rows } = await query(`INSERT INTO ${table} (user_id,dashboard_id,name,description,configuration${reportFields})
    VALUES ($1,$2,$3,$4,$5${reportValues}) RETURNING id,name,description,configuration,created_at AS "createdAt"`, params);
  return rows[0];
}

export async function deleteSavedContent(userId, id, kind) {
  const table = tableFor(kind);
  const result = await query(`DELETE FROM ${table} WHERE id=$1 AND user_id=$2`, [id,userId]);
  return result.rowCount > 0;
}

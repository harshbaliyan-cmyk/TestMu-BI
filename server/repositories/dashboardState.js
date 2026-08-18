import { databaseEnabled, query } from '../db/pool.js';

async function resolveDashboard(templateKey) {
  const { rows } = await query('SELECT id FROM dashboards WHERE template_key = $1', [templateKey]);
  return rows[0]?.id;
}

export async function getDashboardState(userId, templateKey) {
  if (!databaseEnabled || !userId) return null;
  const dashboardId = await resolveDashboard(templateKey);
  if (!dashboardId) return null;
  const { rows } = await query(`SELECT selected_view AS "view", filters,
    table_top_n AS "tableTops", table_sorting AS "tableSorting",
    presentation_settings AS "presentationSettings", version
    FROM saved_dashboard_states WHERE user_id=$1 AND dashboard_id=$2`, [userId, dashboardId]);
  return rows[0] || null;
}

export async function saveDashboardState(userId, templateKey, state) {
  if (!databaseEnabled || !userId) return { ...state, persisted: false };
  const dashboardId = await resolveDashboard(templateKey);
  if (!dashboardId) throw Object.assign(new Error('Unknown dashboard'), { status: 404 });
  const { rows } = await query(`INSERT INTO saved_dashboard_states
    (user_id,dashboard_id,selected_view,filters,table_top_n,table_sorting,presentation_settings)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id,dashboard_id) DO UPDATE SET
      selected_view=EXCLUDED.selected_view, filters=EXCLUDED.filters,
      table_top_n=EXCLUDED.table_top_n, table_sorting=EXCLUDED.table_sorting,
      presentation_settings=EXCLUDED.presentation_settings,
      version=saved_dashboard_states.version+1, updated_at=now()
    RETURNING selected_view AS "view", filters, table_top_n AS "tableTops",
      table_sorting AS "tableSorting", presentation_settings AS "presentationSettings", version`,
    [userId,dashboardId,state.view||'pulse',state.filters||{},state.tableTops||{},state.tableSorting||{},state.presentationSettings||{}]);
  return { ...rows[0], persisted: true };
}

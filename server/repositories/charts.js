import { query } from '../db/pool.js';

// ===== Saved charts =====

export async function createChart({ userId, sourceId, name, chartType, config }) {
  const { rows } = await query(`INSERT INTO saved_charts
    (owner_user_id, data_source_id, name, chart_type, config, config_version)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, name, chart_type AS "chartType", config, created_at AS "createdAt"`,
    [userId, sourceId, name, chartType, JSON.stringify(config), config.version || 1]);
  return rows[0];
}

export async function listCharts(userId) {
  const { rows } = await query(`SELECT c.id, c.name, c.chart_type AS "chartType", c.config,
      c.data_source_id AS "sourceId", ds.source_name AS "sourceName", ds.status AS "sourceStatus",
      c.updated_at AS "updatedAt"
    FROM saved_charts c JOIN data_sources ds ON ds.id = c.data_source_id
    WHERE c.owner_user_id = $1 AND c.deleted_at IS NULL AND ds.deleted_at IS NULL
    ORDER BY c.updated_at DESC`, [userId]);
  return rows;
}

export async function getChart(userId, chartId) {
  const { rows } = await query(`SELECT c.id, c.name, c.chart_type AS "chartType", c.config,
      c.data_source_id AS "sourceId", ds.source_name AS "sourceName", ds.owner_user_id AS "sourceOwnerId"
    FROM saved_charts c JOIN data_sources ds ON ds.id = c.data_source_id
    WHERE c.id = $1 AND c.owner_user_id = $2 AND c.deleted_at IS NULL`, [chartId, userId]);
  return rows[0] || null;
}

export async function updateChart(userId, chartId, { name, config }) {
  const { rows } = await query(`UPDATE saved_charts SET
      name = COALESCE($3, name),
      config = COALESCE($4, config),
      config_version = COALESCE(($4::jsonb ->> 'version')::int, config_version),
      updated_at = now()
    WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
    RETURNING id, name, chart_type AS "chartType", config`,
    [chartId, userId, name ?? null, config ? JSON.stringify(config) : null]);
  return rows[0] || null;
}

export async function deleteChart(userId, chartId) {
  const { rows } = await query(`UPDATE saved_charts SET deleted_at = now()
    WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL RETURNING id`, [chartId, userId]);
  return Boolean(rows[0]);
}

// ===== Custom dashboards =====

export async function createCustomDashboard({ userId, name }) {
  const { rows } = await query(`INSERT INTO custom_dashboards (owner_user_id, name)
    VALUES ($1, $2) RETURNING id, name, layout, created_at AS "createdAt"`, [userId, name]);
  return rows[0];
}

export async function listCustomDashboards(userId) {
  const { rows } = await query(`SELECT id, name, layout, updated_at AS "updatedAt"
    FROM custom_dashboards WHERE owner_user_id = $1 AND deleted_at IS NULL
    ORDER BY updated_at DESC`, [userId]);
  return rows;
}

export async function getCustomDashboard(userId, dashboardId) {
  const { rows } = await query(`SELECT id, name, layout, updated_at AS "updatedAt"
    FROM custom_dashboards WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [dashboardId, userId]);
  return rows[0] || null;
}

export async function updateCustomDashboard(userId, dashboardId, { name, layout }) {
  const { rows } = await query(`UPDATE custom_dashboards SET
      name = COALESCE($3, name),
      layout = COALESCE($4, layout),
      updated_at = now()
    WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
    RETURNING id, name, layout`,
    [dashboardId, userId, name ?? null, layout ? JSON.stringify(layout) : null]);
  return rows[0] || null;
}

export async function deleteCustomDashboard(userId, dashboardId) {
  const { rows } = await query(`UPDATE custom_dashboards SET deleted_at = now()
    WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL RETURNING id`, [dashboardId, userId]);
  return Boolean(rows[0]);
}

// server/chartRoutes.js
// The chart builder's API: catalogue + suggestion, live preview, saved-chart
// CRUD, per-chart data, and custom dashboard CRUD. Everything is scoped to the
// signed-in user; the data paths read RAW source rows from the in-memory store
// (store.getSourceRawData enforces ownership a second time).

import { Router } from 'express';
import { CHART_TYPES, chartType, chartTypeAvailability, suggestBindings } from './services/chartCatalog.js';
import { buildChartData, rowsBehind, CHART_CONFIG_VERSION } from './services/chartEngine.js';
import { getSourceSchema } from './repositories/dataSources.js';
import {
  createChart, listCharts, getChart, updateChart, deleteChart,
  createCustomDashboard, listCustomDashboards, getCustomDashboard,
  updateCustomDashboard, deleteCustomDashboard,
} from './repositories/charts.js';
import { resolveShareToken } from './repositories/shareTokens.js';
import { logAudit } from './repositories/activityLogs.js';

// A wall showing a CUSTOM dashboard authenticates with a share token scoped to
// that one dashboard (see server.js's TV SHARE TOKENS note for the model).
// The token reaches exactly two reads here: the dashboard itself, and the data
// of charts ON its layout — checked per request, because the layout can change
// after the token was minted. Like the template variant, the grant lives on
// req.shareAuth and never touches the session.
const requesterId = req => req.shareAuth?.userId ?? req.session?.userId;

const sessionOrDashboardShare = (requireAuth, authorize) => async (req, res, next) => {
  if (req.session?.email) return requireAuth(req, res, next);
  try {
    const grant = await resolveShareToken(req.get('x-share-token'));
    if (!grant?.customDashboardId || !(await authorize(req, grant))) {
      return res.status(401).json({ error: 'This share link is invalid, revoked, or expired.' });
    }
    req.shareAuth = { userId: grant.userId, customDashboardId: grant.customDashboardId };
    next();
  } catch (error) { next(error); }
};

// Structural checks only — whether the bound columns still make SENSE is the
// engine's job at render time, because the source's columns can change
// underneath a saved chart between syncs.
function configProblem(config) {
  if (!config || typeof config !== 'object') return 'A chart config is required';
  if (config.version !== CHART_CONFIG_VERSION) return `Config version must be ${CHART_CONFIG_VERSION}`;
  if (!chartType(config.type)) return `Unknown chart type: ${config.type}`;
  if (!config.slots || typeof config.slots !== 'object') return 'Field bindings are required';
  return null;
}

// Raw rows live in process memory. After a restart they are gone until the
// source refreshes (Tableau sources refresh themselves at boot; file sources
// need a re-upload) — that is a 409 with instructions, not a 500.
function rowsOr409(store, sourceId, userId, res) {
  const raw = store.getSourceRawData(sourceId, userId);
  if (!raw) {
    res.status(409).json({ error: 'This source\'s rows are not loaded right now. Refresh the source from the Data Sources page, then try again.' });
    return null;
  }
  return raw;
}

export function createChartRouter({ requireAuth, store }) {
  const router = Router();

  // Everything except /:chartId/data is session-only; that one route also
  // accepts a custom-dashboard share token, checked below. Registered FIRST
  // so the blanket requireAuth beneath never sees it.
  router.get('/:chartId/data', sessionOrDashboardShare(requireAuth, async (req, grant) => {
    const dashboard = await getCustomDashboard(grant.userId, grant.customDashboardId);
    return (dashboard?.layout || []).some(tile => tile.chartId === req.params.chartId);
  }), async (req, res) => {
    try {
      const chart = await getChart(requesterId(req), req.params.chartId);
      if (!chart) return res.status(404).json({ error: 'Chart not found' });
      const raw = rowsOr409(store, chart.sourceId, requesterId(req), res);
      if (!raw) return;
      res.json({ chartId: chart.id, type: chart.config.type, data: buildChartData(raw.rows, chart.config) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.use(requireAuth);

  // The full catalogue plus, per chart type, whether THIS source can satisfy
  // it and the suggested bindings when it can. One round trip powers the whole
  // builder screen.
  router.get('/options/:sourceId', async (req, res, next) => {
    try {
      const schema = await getSourceSchema(req.session.userId, req.params.sourceId);
      if (!schema) return res.status(404).json({ error: 'Data source not found' });
      const columns = (Array.isArray(schema.columns) ? schema.columns : [])
        .filter(column => typeof column === 'object');
      const availability = new Map(chartTypeAvailability(columns).map(entry => [entry.key, entry]));
      const types = CHART_TYPES.map(type => {
        const entry = availability.get(type.key);
        return {
          ...type,
          available: entry.available,
          reason: entry.reason || null,
          suggestion: entry.available ? suggestBindings(type.key, columns).slots : null,
        };
      });
      const raw = store.getSourceRawData(req.params.sourceId, req.session.userId);
      res.json({ source: { id: schema.id, name: schema.name, rowCount: schema.rowCount, live: Boolean(raw) },
        columns, types, configVersion: CHART_CONFIG_VERSION });
    } catch (error) { next(error); }
  });

  // Live preview while building — nothing is saved.
  router.post('/preview', async (req, res, next) => {
    try {
      const { sourceId, config } = req.body ?? {};
      const problem = configProblem(config);
      if (problem) return res.status(400).json({ error: problem });
      const schema = await getSourceSchema(req.session.userId, sourceId);
      if (!schema) return res.status(404).json({ error: 'Data source not found' });
      const raw = rowsOr409(store, sourceId, req.session.userId, res);
      if (!raw) return;
      res.json({ data: buildChartData(raw.rows, config) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Drill-down: the raw rows behind one chart element (or behind the whole
  // chart when `where` is empty). Works for a SAVED chart (chartId) and for
  // the builder's unsaved config (sourceId + config) alike.
  router.post('/inspect', async (req, res) => {
    try {
      const { chartId, where = {} } = req.body ?? {};
      let sourceId = req.body?.sourceId;
      let config = req.body?.config;
      if (chartId) {
        const chart = await getChart(req.session.userId, chartId);
        if (!chart) return res.status(404).json({ error: 'Chart not found' });
        sourceId = chart.sourceId;
        config = chart.config;
      }
      const problem = configProblem(config);
      if (problem) return res.status(400).json({ error: problem });
      const raw = rowsOr409(store, sourceId, req.session.userId, res);
      if (!raw) return;
      const matched = rowsBehind(raw.rows, config, where);
      res.json({
        columns: raw.headers,
        rows: matched.slice(0, 100),
        totalRows: matched.length,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { sourceId, name, config } = req.body ?? {};
      const problem = configProblem(config);
      if (problem) return res.status(400).json({ error: problem });
      const trimmed = String(name || '').trim();
      if (!trimmed || trimmed.length > 120) return res.status(400).json({ error: 'Give the chart a name (120 characters max)' });
      const schema = await getSourceSchema(req.session.userId, sourceId);
      if (!schema) return res.status(404).json({ error: 'Data source not found' });
      const chart = await createChart({ userId: req.session.userId, sourceId, name: trimmed,
        chartType: config.type, config });
      await logAudit({ userId: req.session.userId, action: 'chart.created', entityType: 'saved_chart',
        entityId: chart.id, afterState: { name: trimmed, type: config.type, sourceId } });
      res.status(201).json(chart);
    } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    try { res.json({ items: await listCharts(req.session.userId) }); } catch (error) { next(error); }
  });

  router.get('/:chartId', async (req, res, next) => {
    try {
      const chart = await getChart(req.session.userId, req.params.chartId);
      if (!chart) return res.status(404).json({ error: 'Chart not found' });
      res.json(chart);
    } catch (error) { next(error); }
  });

  router.put('/:chartId', async (req, res, next) => {
    try {
      const { name, config } = req.body ?? {};
      if (config) {
        const problem = configProblem(config);
        if (problem) return res.status(400).json({ error: problem });
      }
      const updated = await updateChart(req.session.userId, req.params.chartId,
        { name: name ? String(name).trim().slice(0, 120) : undefined, config });
      if (!updated) return res.status(404).json({ error: 'Chart not found' });
      res.json(updated);
    } catch (error) { next(error); }
  });

  router.delete('/:chartId', async (req, res, next) => {
    try {
      const deleted = await deleteChart(req.session.userId, req.params.chartId);
      if (!deleted) return res.status(404).json({ error: 'Chart not found' });
      await logAudit({ userId: req.session.userId, action: 'chart.deleted', entityType: 'saved_chart',
        entityId: req.params.chartId });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}

export function createCustomDashboardRouter({ requireAuth }) {
  const router = Router();

  // The one read a wall display needs, so it also accepts that dashboard's
  // own share token. Registered before the blanket requireAuth.
  router.get('/:dashboardId', sessionOrDashboardShare(requireAuth,
    async (req, grant) => grant.customDashboardId === req.params.dashboardId), async (req, res, next) => {
    try {
      const dashboard = await getCustomDashboard(requesterId(req), req.params.dashboardId);
      if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
      // The charts the layout references, resolved in one response so the grid
      // can render without one request per tile.
      const charts = await listCharts(requesterId(req));
      const used = new Set((dashboard.layout || []).map(tile => tile.chartId));
      res.json({ ...dashboard, charts: charts.filter(chart => used.has(chart.id)) });
    } catch (error) { next(error); }
  });

  router.use(requireAuth);

  const layoutProblem = layout => {
    if (!Array.isArray(layout)) return 'layout must be an array';
    if (layout.length > 40) return 'A dashboard holds at most 40 tiles';
    for (const tile of layout) {
      if (!tile || typeof tile.chartId !== 'string') return 'Every tile needs a chartId';
      for (const key of ['x', 'y', 'w', 'h']) {
        if (!Number.isFinite(Number(tile[key]))) return `Tile ${tile.chartId} is missing ${key}`;
      }
    }
    return null;
  };

  router.post('/', async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name || name.length > 120) return res.status(400).json({ error: 'Give the dashboard a name (120 characters max)' });
      const dashboard = await createCustomDashboard({ userId: req.session.userId, name });
      await logAudit({ userId: req.session.userId, action: 'custom_dashboard.created',
        entityType: 'custom_dashboard', entityId: dashboard.id, afterState: { name } });
      res.status(201).json(dashboard);
    } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    try { res.json({ items: await listCustomDashboards(req.session.userId) }); } catch (error) { next(error); }
  });

  router.put('/:dashboardId', async (req, res, next) => {
    try {
      const { name, layout } = req.body ?? {};
      if (layout !== undefined) {
        const problem = layoutProblem(layout);
        if (problem) return res.status(400).json({ error: problem });
      }
      const updated = await updateCustomDashboard(req.session.userId, req.params.dashboardId,
        { name: name ? String(name).trim().slice(0, 120) : undefined, layout });
      if (!updated) return res.status(404).json({ error: 'Dashboard not found' });
      res.json(updated);
    } catch (error) { next(error); }
  });

  router.delete('/:dashboardId', async (req, res, next) => {
    try {
      const deleted = await deleteCustomDashboard(req.session.userId, req.params.dashboardId);
      if (!deleted) return res.status(404).json({ error: 'Dashboard not found' });
      await logAudit({ userId: req.session.userId, action: 'custom_dashboard.deleted',
        entityType: 'custom_dashboard', entityId: req.params.dashboardId });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}

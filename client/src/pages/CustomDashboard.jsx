import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  getCustomDashboard, updateCustomDashboard, deleteCustomDashboard,
  listCharts, getChartData, inspectChart,
} from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import BuilderChart from '../components/BuilderChart';
import RowsModal from '../components/RowsModal';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import AppLoader from '../components/AppLoader';

// A custom dashboard is a grid of saved charts: drag by the tile header,
// resize by the corner, and the layout persists on every change (debounced —
// mid-drag positions are noise). Each tile renders through the same
// BuilderChart the builder previews with, fed by /api/charts/:id/data.

const COLS = 12;
const ROW_HEIGHT = 56;

function Tile({ chart, editing, onRemove, onEdit }) {
  const [state, setState] = useState({ status: 'loading' });
  const [drill, setDrill] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getChartData(chart.id)
      .then(({ data }) => { if (!cancelled) setState({ status: 'ok', data }); })
      .catch(error => { if (!cancelled) setState({ status: 'error', message: error.response?.data?.error || 'Could not load' }); });
    return () => { cancelled = true; };
  }, [chart.id]);

  return <>
    <header className="tile-head">
      <b className="tile-drag-handle" title={editing ? 'Drag to move' : chart.name}>{chart.name}</b>
      {editing && <span className="tile-actions">
        <button type="button" onClick={onEdit} title="Edit this chart in the builder">Edit</button>
        <button type="button" onClick={onRemove} title="Remove from this dashboard">✕</button>
      </span>}
    </header>
    <div className="tile-body">
      {state.status === 'loading' && <div className="builder-chart-empty">Loading…</div>}
      {state.status === 'error' && <div className="builder-chart-empty" style={{ color: 'var(--red)' }}>{state.message}</div>}
      {state.status === 'ok' && <BuilderChart type={chart.config.type} data={state.data}
        options={chart.config.options}
        onElementClick={editing ? undefined : where => setDrill({ where })} />}
    </div>
    {drill && <RowsModal
      title={`${chart.name} — ${Object.values(drill.where).join(' · ')}`}
      fetcher={() => inspectChart({ chartId: chart.id, where: drill.where })}
      onClose={() => setDrill(null)} />}
  </>;
}

export default function CustomDashboard() {
  const navigate = useNavigate();
  const { dashboardId } = useParams();
  const [dashboard, setDashboard] = useState(null);
  const [allCharts, setAllCharts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef(null);
  const { width, containerRef, mounted } = useContainerWidth();

  useEffect(() => {
    getCustomDashboard(dashboardId).then(setDashboard)
      .catch(e => setError(e.response?.data?.error || 'Could not load the dashboard'));
    listCharts().then(setAllCharts).catch(() => {});
  }, [dashboardId]);

  const chartsById = useMemo(() => new Map((dashboard?.charts || []).concat(allCharts).map(chart => [chart.id, chart])), [dashboard, allCharts]);

  const layout = useMemo(() => (dashboard?.layout || []).map(tile => ({
    i: tile.chartId, x: +tile.x, y: +tile.y, w: +tile.w, h: +tile.h, minW: 2, minH: 3,
  })), [dashboard]);

  const persistLayout = useCallback(next => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateCustomDashboard(dashboardId, {
        layout: next.map(item => ({ chartId: item.i, x: item.x, y: item.y, w: item.w, h: item.h })),
      }).catch(() => {});
    }, 600);
  }, [dashboardId]);

  const onLayoutChange = useCallback(next => {
    setDashboard(current => current && ({
      ...current,
      layout: next.map(item => ({ chartId: item.i, x: item.x, y: item.y, w: item.w, h: item.h })),
    }));
    persistLayout(next);
  }, [persistLayout]);

  const addChart = chartId => {
    if (!chartId) return;
    const maxY = Math.max(0, ...(dashboard.layout || []).map(tile => +tile.y + +tile.h));
    const next = [...(dashboard.layout || []), { chartId, x: 0, y: maxY, w: 6, h: 6 }];
    setDashboard({ ...dashboard, layout: next });
    updateCustomDashboard(dashboardId, { layout: next }).catch(() => {});
  };

  const removeTile = chartId => {
    const next = (dashboard.layout || []).filter(tile => tile.chartId !== chartId);
    setDashboard({ ...dashboard, layout: next });
    updateCustomDashboard(dashboardId, { layout: next }).catch(() => {});
  };

  const rename = () => {
    const name = window.prompt('Dashboard name', dashboard.name);
    if (!name?.trim()) return;
    setDashboard({ ...dashboard, name: name.trim() });
    updateCustomDashboard(dashboardId, { name: name.trim() }).catch(() => {});
  };

  const destroy = async () => {
    if (!window.confirm(`Delete "${dashboard.name}"? The charts on it are kept — only the dashboard goes.`)) return;
    await deleteCustomDashboard(dashboardId).catch(() => {});
    navigate('/gallery');
  };

  if (error) return <div className="wrap"><div className="card" style={{ color: 'var(--red)' }}>{error}</div></div>;
  if (!dashboard) return <AppLoader fullscreen label="Loading dashboard…" />;

  const placed = new Set((dashboard.layout || []).map(tile => tile.chartId));
  const addable = allCharts.filter(chart => !placed.has(chart.id));

  return <div className="wrap">
    <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
      <div className="brand"><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" /><span>{dashboard.name}</span></div>
      <div className="user-pill">
        <ThemeToggle />
        {!editing && <DashboardSwitcher />}
        {editing && <>
          <select defaultValue="" onChange={e => { addChart(e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Add a chart…</option>
            {addable.map(chart => <option key={chart.id} value={chart.id}>{chart.name}</option>)}
            {!addable.length && <option disabled>Every saved chart is already here</option>}
          </select>
          <button className="btn-secondary" onClick={() => navigate(`/charts/new?dashboard=${dashboardId}`)}>New chart</button>
          <button className="btn-secondary" onClick={rename}>Rename</button>
          <button className="btn-danger" onClick={destroy}>Delete</button>
        </>}
        {!editing && <CopyTvLinkButton className="btn-secondary" customDashboardId={dashboardId} />}
        <button className={editing ? 'btn-primary' : 'btn-secondary'} onClick={() => setEditing(e => !e)}>
          {editing ? 'Done' : 'Edit layout'}
        </button>
        <button className="btn-secondary" onClick={() => navigate('/gallery')}>Back</button>
      </div>
    </div>

    {!dashboard.layout?.length && <div className="card" style={{ textAlign: 'center', padding: 40 }}>
      <h3>Nothing here yet</h3>
      <p className="hint">Switch to &ldquo;Edit layout&rdquo; and add a saved chart — or build a new one.</p>
      <button className="btn-primary" onClick={() => navigate(`/charts/new?dashboard=${dashboardId}`)}>Open the chart builder</button>
    </div>}

    <div ref={containerRef} className={`custom-grid${editing ? ' is-editing' : ''}`}>
      {mounted && Boolean(dashboard.layout?.length) && <ReactGridLayout
        width={width}
        layout={layout}
        gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [14, 14] }}
        dragConfig={{ enabled: editing, handle: '.tile-drag-handle' }}
        resizeConfig={{ enabled: editing }}
        compactor={verticalCompactor}
        onLayoutChange={onLayoutChange}>
        {layout.map(item => {
          const chart = chartsById.get(item.i);
          return <div key={item.i} className="card custom-tile">
            {chart
              ? <Tile chart={chart} editing={editing}
                  onEdit={() => navigate(`/charts/${chart.id}/edit`)}
                  onRemove={() => removeTile(item.i)} />
              : <div className="builder-chart-empty">This chart was deleted.
                  {editing && <button type="button" className="btn-secondary" onClick={() => removeTile(item.i)}>Remove tile</button>}
                </div>}
          </div>;
        })}
      </ReactGridLayout>}
    </div>
  </div>;
}

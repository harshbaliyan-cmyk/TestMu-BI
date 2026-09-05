import { useEffect, useState } from 'react';
import { getCustomDashboard, getChartData } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import BuilderChart from '../components/BuilderChart';
import AppLoader from '../components/AppLoader';

// A custom dashboard on a wall. The saved grid layout is reprojected onto the
// full screen proportionally (12 columns wide, as many rows as the layout
// uses), so the wall shows the same arrangement the owner built — just
// stretched to the TV. Read-only by construction: no drag, no drill, no nav.
// Tiles refetch on the shared liveness tick, and the freshness stamp is the
// audience's proof the wall is alive.

function TvTile({ chart, refreshTick, markFresh }) {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    getChartData(chart.id)
      .then(({ data }) => { if (cancelled) return; setState({ status: 'ok', data }); markFresh(); })
      .catch(() => { if (!cancelled) setState(current => (current.status === 'ok' ? current : { status: 'error' })); });
    return () => { cancelled = true; };
    // markFresh is intentionally not a dependency — it is stable enough for
    // this purpose and re-running on its identity would loop the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id, refreshTick]);

  return <>
    <header className="tile-head"><b>{chart.name}</b></header>
    <div className="tile-body">
      {state.status === 'loading' && <div className="builder-chart-empty">Loading…</div>}
      {state.status === 'error' && <div className="builder-chart-empty">Unavailable</div>}
      {state.status === 'ok' && <BuilderChart type={chart.config.type} data={state.data} options={chart.config.options} />}
    </div>
  </>;
}

export default function TvCustomDashboard({ dashboardId }) {
  const [dashboard, setDashboard] = useState(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState('');
  const { refreshTick, online, dataUpdatedAt, markFresh } = usePresentationLiveness();

  // Reloaded on every tick, not just at open: the owner can rearrange or add
  // charts and the wall follows without anyone touching it.
  useEffect(() => {
    getCustomDashboard(dashboardId).then(setDashboard)
      .catch(e => { if (!dashboard) setError(e.response?.data?.error || 'Could not load the dashboard'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId, refreshTick]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <main className="tv-share-error"><h1>{error}</h1></main>;
  if (!dashboard) return <AppLoader fullscreen label="Preparing display…" />;

  const layout = dashboard.layout || [];
  const chartsById = new Map((dashboard.charts || []).map(chart => [chart.id, chart]));
  const totalRows = Math.max(1, ...layout.map(tile => Number(tile.y) + Number(tile.h)));

  return <main className="presentation-shell tv-custom-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v3.png" alt="" /><div><b>TestMu BI</b><span>Live dashboard</span></div></div>
      <div className="presentation-view-label"><b>{dashboard.name}</b></div>
      <div className="presentation-clock">
        <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
        <span>{now.toLocaleDateString()}</span>
        <DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} />
      </div>
    </header>
    <div className="tv-custom-canvas">
      {layout.map(tile => {
        const chart = chartsById.get(tile.chartId);
        if (!chart) return null;
        return <div key={tile.chartId} className="card custom-tile tv-custom-tile" style={{
          left: `${(Number(tile.x) / 12) * 100}%`,
          width: `calc(${(Number(tile.w) / 12) * 100}% - 12px)`,
          top: `${(Number(tile.y) / totalRows) * 100}%`,
          height: `calc(${(Number(tile.h) / totalRows) * 100}% - 12px)`,
        }}>
          <TvTile chart={chart} refreshTick={refreshTick} markFresh={markFresh} />
        </div>;
      })}
    </div>
  </main>;
}

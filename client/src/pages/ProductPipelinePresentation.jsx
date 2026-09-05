import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProductPipelineSnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import AppLoader from '../components/AppLoader';
import {
  TEMPLATE, SeriesLineChart, ForecastBars, StageHeatmap, HBarChart, ProductTable,
  ProductKpis, shortDate,
} from './ProductView';
import { fmtNumber } from '../components/charts';

// The board's full funnel table has eleven columns; the TV rail is ~300px
// wide and a wall viewer cannot scroll, so it gets the four that matter.
const RAIL_COLUMNS = { firstHeader: 'Group', cells: [
  { key: 'openOppCount', label: 'Open #', kind: 'count' },
  { key: 'openPipe', label: 'Open pipe', kind: 'arr' },
  { key: 'closedWonArr', label: 'Won ARR', kind: 'arr' },
  { key: 'winRateCount', label: 'Win rate', kind: 'rate' },
] };

const EMPTY_METRICS = {
  overall: {}, trendYear: null, trend: { monthlyLabels: [], quarterlyLabels: [], series: [] },
  stages: [], stageStack: [], forecastByGroup: [], funnelByGroup: [], funnelByProduct: [], topProducts: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
function describeTimeRange(filters, fromKey, toKey) {
  if (filters.datePreset && filters.datePreset !== 'all') return DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset;
  if (filters[fromKey] || filters[toKey]) return `${shortDate(filters[fromKey]) || 'Start'} – ${shortDate(filters[toKey]) || 'Today'}`;
  return 'All dates';
}

function PresentCard({ title, subtitle, hideKey, children }) {
  return <Hideable k={`card:${hideKey || title}`} label={title}>
    <section className="present-card present-card-wide">
      <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>
      {children}
    </section>
  </Hideable>;
}

// The Pipeline view on a TV: same 16:9 shell as the Win Board presentation —
// KPI strip, 2x2 chart grid, and a vertical rail — so a wall cycling between
// boards reads as one product. `share` marks token-authenticated wall mode.
export default function ProductPipelinePresentation({ share = false } = {}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [comparison, setComparison] = useState({ available: false });
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-productview-pipeline-presentation-config') || '{}'); }
    catch { return {}; }
  });
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboardState(TEMPLATE).then(remote => {
      if (cancelled || !remote) return;
      setConfig(current => ({ ...current, filters: remote.filters?.pipeline || current.filters || {} }));
    }).catch(() => {}).finally(() => { if (!cancelled) setConfigReady(true); });
    return () => { cancelled = true; };
  }, []);

  const { refreshTick, online, dataUpdatedAt, markFresh } = usePresentationLiveness();
  const hideControl = useHiddenTiles(TEMPLATE, { share, refreshTick });
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    if (!loadedOnce.current) setLoading(true);
    getProductPipelineSnapshot(config.filters || {}).then(snapshot => {
      if (cancelled) return;
      setMetrics(snapshot.metrics || EMPTY_METRICS);
      setComparison(snapshot.comparison || { available: false });
      loadedOnce.current = true;
      markFresh();
    }).catch(() => {
      if (cancelled || loadedOnce.current) return;
      setMetrics(EMPTY_METRICS); setComparison({ available: false });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [configReady, config.filters, refreshTick]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  useEffect(() => {
    if (!isFullscreen) { setControlsVisible(true); return; }
    setControlsVisible(true);
    let hideTimer = setTimeout(() => setControlsVisible(false), 3000);
    const onActivity = () => {
      setControlsVisible(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setControlsVisible(false), 3000);
    };
    window.addEventListener('mousemove', onActivity);
    return () => { clearTimeout(hideTimer); window.removeEventListener('mousemove', onActivity); };
  }, [isFullscreen]);

  const timeRangeSummary = useMemo(() => describeTimeRange(config.filters || {}, 'createdFrom', 'createdTo'), [config.filters]);
  const topProductsN = Number.isFinite(config.topProductsN) ? config.topProductsN : 10;
  const granularity = config.granularity === 'quarterly' ? 'quarterly' : 'monthly';

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v3.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>Pipeline built by product.</span>
          <i aria-hidden="true">•</i>
          <span>Created date: {timeRangeSummary}{comparison.available && comparison.period && <> — comparing with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</>}</span>
        </div>
      </div></div>
      <div className="presentation-view-label"><b>Product View — Pipeline</b>
        <small>Scoped by the Opp CREATED date — when the pipeline was built, not when it will close</small>
      </div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} /></div>
    </header>
    <div className="presentation-slide win-board-tv-layout">
      <section className="win-board-tv-main" aria-label="Product pipeline charts and KPIs">
        <div className="presentation-kpi-strip pv-tv-kpis"><ProductKpis view="pipeline" overall={metrics.overall} comparison={comparison} metrics={metrics}/></div>
        <div className="win-board-tv-chart-grid">
          <PresentCard hideKey="trend" title="Pipeline created trend" subtitle={`Created ARR per ${granularity === 'quarterly' ? 'quarter' : 'month'} of ${metrics.trendYear || ''} · one line per Product Group`}>
            <SeriesLineChart trend={metrics.trend} granularity={granularity} byGroup fill/>
          </PresentCard>
          <PresentCard hideKey="forecast" title="Forecast vs open pipe" subtitle="Open pipe next to Commit, Best Case and No Projection, per Product Group">
            <ForecastBars items={metrics.forecastByGroup} fill/>
          </PresentCard>
          <PresentCard hideKey="stages" title="Open pipeline by stage" subtitle="Darker cell = more open ARR · stages early → late">
            <StageHeatmap stages={metrics.stages} stack={metrics.stageStack} fill/>
          </PresentCard>
          <PresentCard hideKey="top-products" title={`Top products by open pipe${topProductsN > 0 ? ` · Top ${topProductsN}` : ''}`}>
            <HBarChart items={topProductsN > 0 ? metrics.topProducts.slice(0, topProductsN) : metrics.topProducts}
              measures={[{ key: 'openPipe', label: 'Open pipe' }]} tooltipExtra={item => `${fmtNumber(item.openOppCount)} open opps`} fill/>
          </PresentCard>
        </div>
      </section>
      <aside className="win-board-tv-pod-rail" aria-label="Funnel by Product Group">
        <PresentCard hideKey="funnel-rail" title="Funnel by Product Group" subtitle={`${timeRangeSummary} · distinct opportunity counts`}>
          <ProductTable rows={metrics.funnelByGroup} grandTotal={metrics.overall} columns={RAIL_COLUMNS}/>
        </PresentCard>
      </aside>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      {!share && <span className="hide-hint">Double-click any tile to hide it from the TV</span>}
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      {!share && <CopyTvLinkButton templateId={TEMPLATE} />}
      {!share && <button onClick={() => navigate('/dashboard/product-view')}>Exit</button>}
    </footer>
  </main></HideableProvider>;
}

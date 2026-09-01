import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProductWonSnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import AppLoader from '../components/AppLoader';
import {
  TEMPLATE, SeriesLineChart, ProductMixChart, HBarChart, ProductTable,
  ProductKpis, shortDate, winLossDetail,
} from './ProductView';
import { fmtPercent } from '../components/charts';

// Condensed for the ~300px TV rail — a wall viewer cannot scroll a table.
const RAIL_COLUMNS = { firstHeader: 'Group', cells: [
  { key: 'closedWonArr', label: 'Won ARR', kind: 'arr' },
  { key: 'closedLostArr', label: 'Lost ARR', kind: 'arr' },
  { key: 'winRateCount', label: 'Win rate', kind: 'rate' },
  { key: 'avgDealSize', label: 'Avg deal', kind: 'avg' },
] };

const EMPTY_METRICS = {
  overall: {}, trendYear: null,
  trendByGroup: { monthlyLabels: [], quarterlyLabels: [], series: [] },
  trendByProduct: { monthlyLabels: [], quarterlyLabels: [], series: [] },
  productMix: { labels: [], groups: [] },
  winRateByGroup: [], winRateByProduct: [], avgDealSizeByProduct: [], wonLostByGroup: [], wonLostByProduct: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
function describeTimeRange(filters) {
  if (filters.datePreset && filters.datePreset !== 'all') return DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset;
  if (filters.closeFrom || filters.closeTo) return `${shortDate(filters.closeFrom) || 'Start'} – ${shortDate(filters.closeTo) || 'Today'}`;
  return 'All dates';
}

function PresentCard({ title, subtitle, hideKey, children }) {
  return <Hideable k={`card:won-${hideKey || title}`} label={title}>
    <section className="present-card present-card-wide">
      <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>
      {children}
    </section>
  </Hideable>;
}

// The Won ARR view on a TV — actuals only, scoped by close date. Same shell
// as the Win Board presentation. `share` marks token-authenticated wall mode.
export default function ProductWonPresentation({ share = false } = {}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [comparison, setComparison] = useState({ available: false });
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-productview-won-presentation-config') || '{}'); }
    catch { return {}; }
  });
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboardState(TEMPLATE).then(remote => {
      if (cancelled || !remote) return;
      setConfig(current => ({ ...current, filters: remote.filters?.won || current.filters || {} }));
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
    getProductWonSnapshot(config.filters || {}).then(snapshot => {
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

  const timeRangeSummary = useMemo(() => describeTimeRange(config.filters || {}), [config.filters]);
  const granularity = config.granularity === 'quarterly' ? 'quarterly' : 'monthly';
  const trendTopN = Number.isFinite(config.trendTopN) ? config.trendTopN : 5;

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>Actual Won ARR by product — no open pipeline.</span>
          <i aria-hidden="true">•</i>
          <span>Close date: {timeRangeSummary}{comparison.available && comparison.period && <> — comparing with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</>}</span>
        </div>
      </div></div>
      <div className="presentation-view-label"><b>Product View — Won ARR</b>
        <small>Scoped by the Opp CLOSE date — revenue lands in the period the deal closed in</small>
      </div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} /></div>
    </header>
    <div className="presentation-slide win-board-tv-layout">
      <section className="win-board-tv-main" aria-label="Won ARR charts and KPIs">
        <div className="presentation-kpi-strip pv-tv-kpis"><ProductKpis view="won" overall={metrics.overall} comparison={comparison}/></div>
        <div className="win-board-tv-chart-grid">
          <PresentCard hideKey="trend-group" title="Won ARR trend by Product Group" subtitle={`Closed Won ARR per ${granularity === 'quarterly' ? 'quarter' : 'month'} of ${metrics.trendYear || ''}`}>
            <SeriesLineChart trend={metrics.trendByGroup} granularity={granularity} byGroup fill/>
          </PresentCard>
          <PresentCard hideKey="trend-product" title={`Won ARR trend by Product · Top ${trendTopN}`}>
            <SeriesLineChart trend={metrics.trendByProduct} granularity={granularity} topN={trendTopN} fill/>
          </PresentCard>
          <PresentCard hideKey="mix" title="Product mix % of Won ARR" subtitle="Each group's share per quarter — columns add to 100%">
            <ProductMixChart mix={metrics.productMix} trend={metrics.trendByGroup} fill/>
          </PresentCard>
          <PresentCard hideKey="win-rate" title="Win rate by Product Group" subtitle={`Overall: ${fmtPercent(metrics.overall.winRateCount)} by count · ${fmtPercent(metrics.overall.winRateArr)} by ARR`}>
            <HBarChart items={metrics.wonLostByGroup} percentAxis format={fmtPercent}
              measures={[{ key: 'winRateCount', label: 'By count' }, { key: 'winRateArr', label: 'By ARR' }]}
              tooltipExtra={winLossDetail} fill/>
          </PresentCard>
        </div>
      </section>
      <aside className="win-board-tv-pod-rail" aria-label="Won vs Lost by Product Group">
        <PresentCard hideKey="won-lost-rail" title="Won vs Lost by Product Group" subtitle={`${timeRangeSummary} · distinct opportunity counts`}>
          <ProductTable rows={metrics.wonLostByGroup} grandTotal={metrics.overall} columns={RAIL_COLUMNS}/>
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

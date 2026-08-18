import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWinBoardSnapshot, getDashboardState } from '../lib/api';
import {
  TrendChart, TeamContributionDonut, OrgTypeFillBars, PodRadialScorecards, RankFunnel, PercentChart,
  WinRateSummary, percentageView, sortMetricRows, shortDate, DEFAULT_PERCENTAGE_VIEW,
} from './WinBoard';
import AppLoader from '../components/AppLoader';

const TEMPLATE = 'win-board';
const EMPTY_METRICS = {
  overall: { opportunities: 0, open: 0, wonArr: 0, closedArr: 0, totalArr: 0, openArr: 0, closed: 0, wins: 0, losses: 0,
    arrWinRate: 0, dealWinRate: 0, dealWinRateOfAll: 0, openArrPct: 0, openOppRate: 0 },
  trend: { monthly: [], quarterly: [] }, trendYear: null, teams: [], industries: [], orgTypes: [], pods: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
// The active time range only — a TV viewer has no access to the filter shelf,
// so this is the only place they can see it. Category filters (region, org
// type, industry, opportunity type) are deliberately omitted: with many
// values selected (or all of them, which is the common case), listing every
// selected value produces an unreadable multi-line wall of text instead of a
// scannable subheading.
function describeTimeRange(filters) {
  if (filters.datePreset && filters.datePreset !== 'all') {
    return DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset;
  }
  if (filters.createdFrom || filters.createdTo) {
    return `${shortDate(filters.createdFrom) || 'Start'} – ${shortDate(filters.createdTo) || 'Today'}`;
  }
  return 'All dates';
}

function PresentCard({ title, subtitle, children }) {
  return <section className="present-card present-card-wide">
    <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>
    {children}
  </section>;
}

export default function WinBoardPresentation() {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [comparison, setComparison] = useState({ available: false });
  // Same-browser launches get their config instantly from localStorage (written by
  // WinBoard.jsx's startPresentation()). The backend fetch below then confirms or
  // overrides it, so a presentation link opened in a different browser/profile still
  // reproduces the launching dashboard's filters and display settings.
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-winboard-presentation-config') || '{}'); }
    catch { return {}; }
  });
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboardState(TEMPLATE).then(remote => {
      if (cancelled || !remote) return;
      setConfig(current => ({
        filters: remote.filters || current.filters || {},
        percentageMetric: remote.tableSorting?.percentageMetric || current.percentageMetric || DEFAULT_PERCENTAGE_VIEW,
        topN: Number.isFinite(Number(remote.tableTops?.industry)) ? Number(remote.tableTops.industry) : (current.topN ?? 5),
        podTopN: [0, 5, 10, 20].includes(Number(remote.tableTops?.pod)) ? Number(remote.tableTops.pod) : (current.podTopN ?? 5),
      }));
    }).catch(() => {}).finally(() => { if (!cancelled) setConfigReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    setLoading(true);
    getWinBoardSnapshot(config.filters || {}).then(snapshot => {
      if (cancelled) return;
      setMetrics(snapshot.metrics || EMPTY_METRICS);
      setComparison(snapshot.comparison || { available: false });
    }).catch(() => {
      if (cancelled) return;
      setMetrics(EMPTY_METRICS); setComparison({ available: false });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [configReady, config.filters]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // On a TV/projector, the control bar is only useful to the person driving
  // the presentation, so it auto-hides in fullscreen and reappears on mouse
  // movement — the same pattern video players use.
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

  const percentageMetric = config.percentageMetric || DEFAULT_PERCENTAGE_VIEW;
  const definition = percentageView(percentageMetric);
  const topN = Number.isFinite(config.topN) ? config.topN : 5;
  const groupComparisons = comparison.groups || {};
  const timeRangeSummary = useMemo(() => describeTimeRange(config.filters || {}), [config.filters]);
  const rankedIndustries = useMemo(() => sortMetricRows(metrics.industries || [], percentageMetric, 'desc'), [metrics.industries, percentageMetric]);
  const industries = topN > 0 ? rankedIndustries.slice(0, topN) : rankedIndustries;
  const { overall } = metrics;

  // Built for a fixed 16:9 TV display, not a scrolling page. The four main
  // charts share a 2x2 grid while POD contribution gets a dedicated vertical
  // rail, so every graph is visible at once and horizontal TV space is used
  // instead of stacking a third chart row below the fold.
  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>Opp Type — New Business, New Business AM and Existing Business Up-Sell.</span>
          <i aria-hidden="true">•</i>
          <span>Created date: {timeRangeSummary}{comparison.available && comparison.period && <> — comparing with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</>}</span>
        </div>
      </div></div>
      {/* One line, under the board name: a TV audience cannot open a tooltip,
          and "contribution" is the one word on this screen that is routinely
          read as a win rate. */}
      <div className="presentation-view-label"><b>Win Board</b>
        <small>Contribution % = each slice&rsquo;s share of all Won ARR shown — the slices add up to 100%</small>
      </div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span></div>
    </header>
    <div className="presentation-slide win-board-tv-layout">
      <section className="win-board-tv-main" aria-label="Win Board charts and KPIs">
        <div className="presentation-kpi-strip"><WinRateSummary overall={overall} comparison={comparison}/></div>
        <div className="win-board-tv-chart-grid">
          <PresentCard title={`${definition.label} trend`} subtitle={`${metrics.trendYear||''} vs ${comparison.previousTrendYear||'prior year'} · month or quarter view`}>
            <TrendChart trend={metrics.trend} previousTrend={comparison.previousTrend} metric={percentageMetric} year={metrics.trendYear} previousYear={comparison.previousTrendYear} fill/>
          </PresentCard>
          <PresentCard title={`${definition.label} by team`}>
            <TeamContributionDonut items={metrics.teams} comparisons={groupComparisons.teams} metric={percentageMetric} showCallouts />
          </PresentCard>
          <PresentCard title={`Top industries by ${definition.label}`}>
            {topN === 5
              ? <RankFunnel items={industries} comparisons={groupComparisons.industries} metric={percentageMetric} />
              : <PercentChart items={industries} comparisons={groupComparisons.industries} metric={percentageMetric} label={definition.shortLabel} heading="Industry performance" fill/>}
          </PresentCard>
          <PresentCard title={`${definition.label} by org type`}>
            <OrgTypeFillBars items={metrics.orgTypes} comparisons={groupComparisons.orgTypes} metric={percentageMetric} />
          </PresentCard>
        </div>
      </section>
      <aside className="win-board-tv-pod-rail" aria-label="Won ARR contribution by POD">
        <PresentCard title="Won ARR contribution % by POD" subtitle={`${timeRangeSummary} · Top 5 · gauge = current, dot = previous`}>
          <PodRadialScorecards items={metrics.pods} comparisons={groupComparisons.pods} metric="contribution" topN={5}
            showCenterLabel={false} previousPeriodLabel="Previous period Contribution" showContext comparisonBesideGauge/>
        </PresentCard>
      </aside>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      <button onClick={() => navigate('/dashboard/win-board')}>Exit</button>
    </footer>
  </main>;
}

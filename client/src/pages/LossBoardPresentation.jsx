import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLossBoardSnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import {
  TrendChart, OrgTypeFillBars, PodRadialScorecards, RankFunnel, PercentChart,
  percentageView, sortMetricRows, shortDate,
} from './WinBoard';
import { LostAfterTrialCard, LossRateSummary, DEFAULT_PERCENTAGE_VIEW, LOSS_VIEW_KEYS } from './LossBoard';
import AppLoader from '../components/AppLoader';

const TEMPLATE = 'loss-board';
const EMPTY_METRICS = {
  overall: { opportunities: 0, open: 0, lostArr: 0, closedArr: 0, totalArr: 0, openArr: 0, closed: 0, wins: 0, losses: 0,
    arrLostRate: 0, lossOppRate: 0, lossOppRateOfAll: 0, openArrPct: 0, openOppRate: 0, lossContribution: 0,
    lostAfterTrial: { count: 0, trialClosedCount: 0, rate: 0 } },
  trend: { monthly: [], quarterly: [] }, trendYear: null, pods: [], orgTypes: [], lossReasons: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
// The active time range only — see the identical note in WinBoardPresentation.jsx:
// category filters are deliberately omitted since listing every selected value
// (often all of them) produces an unreadable wall of text, not a subheading.
function describeTimeRange(filters) {
  if (filters.datePreset && filters.datePreset !== 'all') {
    return DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset;
  }
  if (filters.createdFrom || filters.createdTo) {
    return `${shortDate(filters.createdFrom) || 'Start'} – ${shortDate(filters.createdTo) || 'Today'}`;
  }
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

// `share` marks token-authenticated wall mode (rendered via TvDisplay):
// controls that lead back into the logged-in app are hidden there.
export default function LossBoardPresentation({ share = false } = {}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [comparison, setComparison] = useState({ available: false });
  // Same-browser launches get their config instantly from localStorage (written by
  // LossBoard.jsx's startPresentation()). The backend fetch below then confirms or
  // overrides it, so a presentation link opened in a different browser/profile still
  // reproduces the launching dashboard's filters and display settings.
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-lossboard-presentation-config') || '{}'); }
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
        reasonTopN: Number.isFinite(Number(remote.tableTops?.lossReason)) ? Number(remote.tableTops.lossReason) : (current.reasonTopN ?? 5),
        podTopN: [0, 5, 10, 20].includes(Number(remote.tableTops?.pod)) ? Number(remote.tableTops.pod) : (current.podTopN ?? 5),
      }));
    }).catch(() => {}).finally(() => { if (!cancelled) setConfigReady(true); });
    return () => { cancelled = true; };
  }, []);

  const { refreshTick, online, dataUpdatedAt, markFresh } = usePresentationLiveness();
  const hideControl = useHiddenTiles(TEMPLATE, { share, refreshTick });
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    // Only the first load shows the loader; background refreshes swap the
    // numbers in place, and a failed one keeps the last good numbers — the
    // freshness stamp stopping is the honest signal. Same policy as
    // WinBoardPresentation.jsx.
    if (!loadedOnce.current) setLoading(true);
    getLossBoardSnapshot(config.filters || {}).then(snapshot => {
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

  const percentageMetric = LOSS_VIEW_KEYS.includes(config.percentageMetric) ? config.percentageMetric : DEFAULT_PERCENTAGE_VIEW;
  const definition = percentageView(percentageMetric);
  const reasonTopN = Number.isFinite(config.reasonTopN) ? config.reasonTopN : 5;
  const groupComparisons = comparison.groups || {};
  const timeRangeSummary = useMemo(() => describeTimeRange(config.filters || {}), [config.filters]);
  const rankedReasons = useMemo(() => sortMetricRows(metrics.lossReasons || [], percentageMetric, 'desc'), [metrics.lossReasons, percentageMetric]);
  const lossReasons = reasonTopN > 0 ? rankedReasons.slice(0, reasonTopN) : rankedReasons;
  const { overall } = metrics;

  // Built for a fixed 16:9 TV display, not a scrolling page — the same canvas
  // as WinBoardPresentation.jsx and sharing its CSS verbatim: the four main
  // charts share a 2x2 grid while POD gets a dedicated vertical rail, so
  // every graph is visible at once and horizontal TV space is used instead of
  // stacking a third chart row below the fold. Column placement mirrors the
  // Win Board's too — the rank funnel sits in the narrower left column and
  // the org-type bars in the wider right one, which is what the shared
  // .win-board-tv-chart-grid track sizing was tuned against.
  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v3.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>Where business is being lost — Lost ARR is the primary measure.</span>
          <i aria-hidden="true">•</i>
          <span>Created date: {timeRangeSummary}{comparison.available && comparison.period && <> — comparing with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</>}</span>
        </div>
      </div></div>
      <div className="presentation-view-label"><b>Loss Board</b>
        <small>Contribution % = each slice&rsquo;s share of all Lost ARR shown — the slices add up to 100%</small>
      </div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} /></div>
    </header>
    <div className="presentation-slide win-board-tv-layout">
      <section className="win-board-tv-main" aria-label="Loss Board charts and KPIs">
        <div className="presentation-kpi-strip"><LossRateSummary overall={overall} comparison={comparison}/></div>
        <div className="win-board-tv-chart-grid">
          <PresentCard hideKey="lost-after-trial" title="Lost after trial" subtitle="Of the closed opportunities that reached a trial, the share that were lost">
            <LostAfterTrialCard stat={metrics.overall.lostAfterTrial} changePoints={comparison.lostAfterTrialRatePointChange} />
          </PresentCard>
          <PresentCard hideKey="trend" title={`${definition.label} trend`} subtitle={`${metrics.trendYear||''} vs ${comparison.previousTrendYear||'prior year'} · month or quarter view`}>
            <TrendChart trend={metrics.trend} previousTrend={comparison.previousTrend} metric={percentageMetric} year={metrics.trendYear} previousYear={comparison.previousTrendYear} fill/>
          </PresentCard>
          <PresentCard hideKey="loss-reasons" title={`Top loss reasons by ${definition.label}`}>
            {reasonTopN === 5
              ? <RankFunnel items={lossReasons} comparisons={groupComparisons.lossReasons} metric={percentageMetric} dimension="loss reason" dimensionLabel="Loss reason" dimensionPlural="loss reasons" />
              : <PercentChart items={lossReasons} comparisons={groupComparisons.lossReasons} metric={percentageMetric} label={definition.shortLabel} heading="Loss reason performance" fill/>}
          </PresentCard>
          <PresentCard hideKey="org-type" title={`${definition.label} by org type`}>
            <OrgTypeFillBars items={metrics.orgTypes} comparisons={groupComparisons.orgTypes} metric={percentageMetric} />
          </PresentCard>
        </div>
      </section>
      {/* Fixed at 5, like the Win Board rail: the shared rail CSS lays the
          gauge cards out as exactly five equal rows, so honouring the
          dashboard's Top N here would overflow or leave the rail short. */}
      <aside className="win-board-tv-pod-rail" aria-label={`${definition.label} by POD`}>
        <PresentCard hideKey="pod-rail" title={`${definition.label} by POD`} subtitle={`${timeRangeSummary} · Top 5 · gauge = current, dot = previous`}>
          <PodRadialScorecards items={metrics.pods} comparisons={groupComparisons.pods} metric={percentageMetric} topN={5}
            showCenterLabel={false} previousPeriodLabel={`Previous period ${definition.shortLabel}`} showContext comparisonBesideGauge/>
        </PresentCard>
      </aside>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      {!share && <span className="hide-hint">Double-click any tile to hide it from the TV</span>}
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      {!share && <CopyTvLinkButton templateId={TEMPLATE} />}
      {!share && <button onClick={() => navigate('/dashboard/loss-board')}>Exit</button>}
    </footer>
  </main></HideableProvider>;
}

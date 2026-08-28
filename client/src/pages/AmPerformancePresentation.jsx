import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAmPerformanceSnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import { RepLeaderboard, POD_LEADERS } from './AePerformance';
import { fmtPercent } from '../components/charts';
import AppLoader from '../components/AppLoader';

const TEMPLATE = 'am-performance';
const EMPTY_METRICS = {
  overall: { opportunities: 0, closed: 0, wins: 0, losses: 0, closedArr: 0, wonArr: 0, dealWinRate: 0, arrWinRate: 0, contribution: 0 },
  reps: [], pods: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
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
export default function AmPerformancePresentation({ share = false } = {}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [quotaMetrics, setQuotaMetrics] = useState(EMPTY_METRICS);
  const [quota, setQuota] = useState(null);
  const [comparison, setComparison] = useState({ available: false });
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-amperformance-presentation-config') || '{}'); }
    catch { return {}; }
  });
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDashboardState(TEMPLATE).then(remote => {
      if (cancelled || !remote) return;
      setConfig(current => ({
        filters: remote.filters || current.filters || {},
        repTopN: [0, 5, 10, 20].includes(Number(remote.tableTops?.rep)) ? Number(remote.tableTops.rep) : (current.repTopN ?? 5),
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
    getAmPerformanceSnapshot(config.filters || {}).then(snapshot => {
      if (cancelled) return;
      // The rankings read quotaMetrics, not metrics: attainment is only
      // computed on the quarter-anchored set. Reading metrics here is what
      // made every row on the TV shell say "No quota".
      setQuotaMetrics(snapshot.quotaMetrics || EMPTY_METRICS);
      setQuota(snapshot.quota || null);
      setComparison(snapshot.comparison || { available: false });
      loadedOnce.current = true;
      markFresh();
    }).catch(() => {
      if (cancelled || loadedOnce.current) return;
      setQuotaMetrics(EMPTY_METRICS); setQuota(null); setComparison({ available: false });
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

  const repTopN = [0, 5, 10, 20].includes(Number(config.repTopN)) ? Number(config.repTopN) : 5;
  const podTopN = [0, 5, 10, 20].includes(Number(config.podTopN)) ? Number(config.podTopN) : 5;
  const groupComparisons = comparison.groups || {};
  // Defaulted for the same reason as the dashboard: an older server process
  // returns metrics without a `pods` key.
  const reps = quotaMetrics.reps || [];
  const pods = quotaMetrics.pods || [];
  const measured = reps.filter(rep => rep.attainment !== null && rep.attainment !== undefined);
  const quarterLabel = quota?.currentQuarter || 'the current quarter';
  // Same rule as the dashboard: both lists arrive sorted with unmeasurable
  // entries last, so the leader is the first one carrying a number.
  const topRep = measured[0] || null;
  const topPod = (pods || []).find(pod => pod.attainment !== null && pod.attainment !== undefined) || null;

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>AM-owned opportunities only.</span>
          <i aria-hidden="true">•</i>
          <span>Quota: all of {quarterLabel}, not narrowed by the date filter</span>
        </div>
      </div></div>
      <div className="presentation-view-label"><b>AM Performance</b><small className="board-scope-note">Opp type = New Business, New Business AM, Existing Business - Up-sell</small></div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} /></div>
    </header>
    {/* The two names lead the slide. On a wall display the question is who is
        winning, and the rankings below answer it only after you read them. */}
    <div className="ae-top-tiles ae-top-tiles-tv">
      <Hideable k="kpi:top-rep" label="Top AM performer"><div className="ae-top-tile">
        <span className="ae-quota-label">Top AM performer</span>
        {topRep
          ? <><span className="ae-top-name">{topRep.label}</span>
              <span className="ae-top-value">{fmtPercent(topRep.attainment)}<small> of quota</small></span></>
          : <span className="ae-top-empty">No rep carries a measurable target</span>}
      </div></Hideable>
      <Hideable k="kpi:top-pod" label="Top POD"><div className="ae-top-tile">
        <span className="ae-quota-label">Top POD</span>
        {topPod
          ? <><span className="ae-top-name">{topPod.label}</span>
              <span className="ae-top-value">{fmtPercent(topPod.attainment)}<small> of quota</small></span></>
          : <span className="ae-top-empty">No POD carries a measurable target</span>}
      </div></Hideable>
    </div>
    <div className="presentation-slide ae-performance-slide">
      <PresentCard hideKey="rep-leaderboard" title="AM Quota Attainment" subtitle={`Won ARR closed in ${quarterLabel} ÷ each rep's quota · ${measured.length} of ${reps.length} carry a target`}>
        <RepLeaderboard reps={reps} comparisons={groupComparisons.reps} topN={repTopN} />
      </PresentCard>
      <PresentCard hideKey="pod-leaderboard" title="AM POD Quota Attainment" subtitle={`A POD's quota is the sum of its reps' targets · ${quarterLabel}`}>
        <RepLeaderboard reps={pods} comparisons={groupComparisons.pods} topN={podTopN} showAvatar={false} leaders={POD_LEADERS} />
      </PresentCard>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      {!share && <span className="hide-hint">Double-click any tile to hide it from the TV</span>}
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      {!share && <CopyTvLinkButton templateId={TEMPLATE} />}
      {!share && <button onClick={() => navigate('/dashboard/am-performance')}>Exit</button>}
    </footer>
  </main></HideableProvider>;
}

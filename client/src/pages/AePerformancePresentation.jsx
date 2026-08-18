import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAePerformanceSnapshot, getDashboardState } from '../lib/api';
import { RepLeaderboard } from './AePerformance';
import { shortDate } from './WinBoard';
import { fmtNumber } from '../components/charts';
import AppLoader from '../components/AppLoader';

const TEMPLATE = 'ae-performance';
const EMPTY_METRICS = {
  overall: { opportunities: 0, closed: 0, wins: 0, losses: 0, closedArr: 0, wonArr: 0, dealWinRate: 0, arrWinRate: 0, contribution: 0 },
  reps: [], pods: [],
};

const DATE_PRESET_LABELS = {
  currentWeek: 'Current week', previousWeek: 'Previous week', currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};
function describeTimeRange(filters) {
  if (filters.datePreset && filters.datePreset !== 'all') {
    return DATE_PRESET_LABELS[filters.datePreset] || filters.datePreset;
  }
  if (filters.closeFrom || filters.closeTo) {
    return `${shortDate(filters.closeFrom) || 'Start'} – ${shortDate(filters.closeTo) || 'Today'}`;
  }
  return 'All dates';
}

function PresentCard({ title, subtitle, children }) {
  return <section className="present-card present-card-wide">
    <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>
    {children}
  </section>;
}

export default function AePerformancePresentation() {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [comparison, setComparison] = useState({ available: false });
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-aeperformance-presentation-config') || '{}'); }
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

  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    setLoading(true);
    getAePerformanceSnapshot(config.filters || {}).then(snapshot => {
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
  const timeRangeSummary = useMemo(() => describeTimeRange(config.filters || {}), [config.filters]);
  // Defaulted for the same reason as the dashboard: an older server process
  // returns metrics without a `pods` key.
  const { overall } = metrics;
  const reps = metrics.reps || [];
  const pods = metrics.pods || [];

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <main className="presentation-shell win-board-wrap win-board-tv-shell">
    <header className="presentation-header">
      <div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b>
        <div className="presentation-brand-context">
          <span>AE-owned opportunities only.</span>
          <i aria-hidden="true">•</i>
          <span>Close date: {timeRangeSummary}{comparison.available && comparison.period && <> — comparing with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</>}</span>
        </div>
      </div></div>
      <div className="presentation-view-label"><b>AE Performance</b></div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span></div>
    </header>
    <div className="presentation-slide ae-performance-slide">
      <PresentCard title="AE Top Performer" subtitle={`Contribution % of total AE Won ARR · ${fmtNumber(overall.wins)} won · ${timeRangeSummary}`}>
        <RepLeaderboard reps={reps} comparisons={groupComparisons.reps} topN={repTopN} />
      </PresentCard>
      <PresentCard title="AE POD Performance Ranking" subtitle={`Same Won ARR contribution, grouped by POD · ${timeRangeSummary}`}>
        <RepLeaderboard reps={pods} comparisons={groupComparisons.pods} topN={podTopN} showAvatar={false} />
      </PresentCard>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      <button onClick={() => navigate('/dashboard/ae-performance')}>Exit</button>
    </footer>
  </main>;
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAePerformanceSnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import { AeQuarterPanel, AeLeaderSpotlight, AeRankingPanel } from '../components/AePerformanceUI';
import AppLoader from '../components/AppLoader';

const TEMPLATE = 'ae-performance';
const EMPTY_METRICS = {
  overall: { opportunities: 0, closed: 0, wins: 0, losses: 0, closedArr: 0, wonArr: 0, dealWinRate: 0, arrWinRate: 0, contribution: 0 },
  reps: [], pods: [],
};

// `share` marks token-authenticated wall mode (rendered via TvDisplay):
// controls that lead back into the logged-in app are hidden there.
export default function AePerformancePresentation({ share = false } = {}) {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [quotaMetrics, setQuotaMetrics] = useState(EMPTY_METRICS);
  const [quota, setQuota] = useState(null);
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
    getAePerformanceSnapshot(config.filters || {}).then(snapshot => {
      if (cancelled) return;
      // The rankings read quotaMetrics, not metrics: attainment is only
      // computed on the quarter-anchored set. Reading metrics here is what
      // made every row on the TV shell say "No quota".
      setQuotaMetrics(snapshot.quotaMetrics || EMPTY_METRICS);
      setQuota(snapshot.quota || null);
      loadedOnce.current = true;
      markFresh();
    }).catch(() => {
      if (cancelled || loadedOnce.current) return;
      setQuotaMetrics(EMPTY_METRICS); setQuota(null);
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

  const teamQuota = measured.reduce((total, rep) => total + (rep.quota || 0), 0);
  const teamWon = measured.reduce((total, rep) => total + (rep.quotaWonArr || 0), 0);
  const teamAttainment = teamQuota ? teamWon / teamQuota * 100 : null;
  const priorMeasured = reps.filter(rep => rep.priorAttainment !== null && rep.priorAttainment !== undefined);
  const priorQuota = priorMeasured.reduce((total, rep) => total + (rep.priorQuota || 0), 0);
  const priorWon = priorMeasured.reduce((total, rep) => total + (rep.priorWonArr || 0), 0);
  const priorTeamAttainment = priorQuota ? priorWon / priorQuota * 100 : null;

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell ae-studio ae-studio-tv">
    <header className="ae-tv-header">
      <div className="ae-tv-heading"><img src="/testmu-bi-logo-v3.png" alt="TestMu BI"/><div><h1>AE Performance</h1><p>AE-owned opportunities / Full quarter: {quarterLabel}</p></div></div>
      <div className="ae-tv-clock"><strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt}/></div>
    </header>
    <div className="ae-tv-stage">
      <aside className="ae-tv-rail" aria-label="Quarter highlights">
        <AeQuarterPanel quota={quota} teamAttainment={teamAttainment} priorTeamAttainment={priorTeamAttainment} atOrAbove={measured.filter(rep => rep.attainment >= 100).length} measuredCount={measured.length}/>
        <Hideable k="kpi:top-rep" label="Top AE performer"><AeLeaderSpotlight title="Top AE performer" item={topRep}/></Hideable>
        <Hideable k="kpi:top-pod" label="Top POD"><AeLeaderSpotlight title="Top POD" item={topPod} pod/></Hideable>
      </aside>
      <div className="ae-tv-rankings">
        <AeRankingPanel reps={reps} topN={repTopN} presentation share={share}/>
        <AeRankingPanel reps={pods} topN={podTopN} presentation share={share} pod/>
      </div>
    </div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      {!share && <span className="hide-hint">Double-click any tile to hide it from the TV</span>}
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      {!share && <CopyTvLinkButton templateId={TEMPLATE} />}
      {!share && <button onClick={() => navigate('/dashboard/ae-performance')}>Exit</button>}
    </footer>
  </main></HideableProvider>;
}

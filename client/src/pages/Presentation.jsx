import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getOpportunitySnapshot, getDashboardState } from '../lib/api';
import { usePresentationLiveness } from '../hooks/usePresentationLiveness';
import DataFreshnessStamp from '../components/DataFreshnessStamp';
import CopyTvLinkButton from '../components/CopyTvLinkButton';
import { Hideable, HideableProvider, useHiddenTiles } from '../components/Hideable';
import { BarList, Donut, Heatmap, MetricGauges, Pill, fmtNumber, fmtPercent, seriesColor, STATUS_COLORS } from '../components/charts';
import AppLoader from '../components/AppLoader';

// The Opportunity Analytics wall. PUBLIC-DISPLAY POLICY (business ruling,
// 2026-09-04): this layer shows counts, rates and owner names only. No
// currency figure of any kind, no cycle or aging day counts, no account or
// opportunity names. It reads the same server snapshot as the board, so
// every count here is the board's count; it simply never asks for the $.
// tests/opportunity-analytics.spec.ts asserts the rendered DOM stays free of
// currency symbols.

const chunk = (rows, size) => rows.length
  ? Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))
  : [[]];
const VIEW_LABELS = {
  pulse: 'Pipeline Overview', diagnostics: 'Loss Diagnostics', velocity: 'Velocity & Aging',
  wherewewin: 'Where We Win', repperformance: 'Rep Performance',
};
const VIEW_ORDER = Object.keys(VIEW_LABELS);
const HEALTH_COLORS = { Green: STATUS_COLORS.good, Amber: STATUS_COLORS.warn, Red: STATUS_COLORS.bad, 'Not rated': '#898781' };
const rateColor = value => ((value || 0) >= 50 ? STATUS_COLORS.good : (value || 0) >= 35 ? STATUS_COLORS.warn : STATUS_COLORS.bad);
const pctOf = value => fmtPercent(value, 0);
const emphasise = text => String(text || '').split('**').map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part));

function PresentCard({ title, subtitle, wide = false, children }) {
  return <Hideable k={`card:${title}`} label={title}>
    <section className={`present-card${wide ? ' present-card-wide' : ''}`}>
      <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>{children}
    </section>
  </Hideable>;
}

function PresentKpi({ label, value, note, tone = 'cyan' }) {
  return <Hideable k={`kpi:${label}`} label={label}>
    <div className={`present-kpi present-${tone}`}><span>{label}</span><b>{value}</b><small>{note}</small></div>
  </Hideable>;
}

function HighlightsCard({ items, wide = false }) {
  return <PresentCard title="Highlights" subtitle="Read off the same numbers as the board" wide={wide}>
    <div className="present-highlights">
      {(items || []).map(item => <div key={item.tag} className={`present-highlight${item.tone ? ` ${item.tone}` : ''}`}>
        <span>{item.tag}</span><p>{emphasise(item.text)}</p>
      </div>)}
      {!items?.length && <div className="empty">Nothing to read in this scope.</div>}
    </div>
  </PresentCard>;
}

// `share` marks token-authenticated wall mode (rendered via TvDisplay): the
// template comes as a prop instead of the URL, and controls that lead back
// into the logged-in app are hidden — a wall has nobody signed in to use them.
export default function Presentation({ share = false, templateId: templateIdProp } = {}) {
  const { templateId: templateIdParam } = useParams();
  const templateId = templateIdProp || templateIdParam;
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [seconds, setSeconds] = useState(() => +(localStorage.getItem('present-seconds') || 15));
  const [now, setNow] = useState(new Date());
  const [listPageSize, setListPageSize] = useState(() => window.innerHeight >= 900 ? 15 : window.innerHeight >= 720 ? 11 : 8);
  const slideRef = useRef(null);
  // Same-browser launches get their config instantly from localStorage (written by
  // Dashboard.jsx's startPresentation()). The backend fetch below then confirms or
  // overrides it, so a presentation link opened in a different browser/profile (or
  // after clearing site data) still reproduces the launching dashboard's filters.
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('testmu-presentation-config') || '{}'); }
    catch { return {}; }
  });
  const [configReady, setConfigReady] = useState(false);
  const filters = config.filters || {};
  const tableTops = config.tableTops || {};
  const applyTop = (rows, key) => tableTops[key] ? rows.slice(0, tableTops[key]) : rows;

  useEffect(() => {
    let cancelled = false;
    getDashboardState(templateId).then(remote => {
      if (cancelled || !remote) return;
      setConfig(current => ({
        templateId,
        filters: remote.filters || current.filters || {},
        tableTops: remote.tableTops || current.tableTops || {},
        scope: remote.presentationSettings?.scope || current.scope || 'all',
        view: remote.presentationSettings?.view || remote.view || current.view,
      }));
    }).catch(() => {}).finally(() => { if (!cancelled) setConfigReady(true); });
    return () => { cancelled = true; };
  }, [templateId]);

  const { refreshTick, online, dataUpdatedAt, markFresh } = usePresentationLiveness();
  const hideControl = useHiddenTiles(templateId, { share, refreshTick });
  const loadedOnce = useRef(false);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!configReady) return;
    // Only the first load shows the loader; background refreshes swap the
    // numbers in place, and a failed one keeps the last good snapshot — the
    // freshness stamp stopping is the honest signal.
    if (!loadedOnce.current) setLoading(true);
    getOpportunitySnapshot(templateId, filters)
      .then(data => { setSnapshot(data); setLoadError(''); loadedOnce.current = true; markFresh(); })
      .catch(err => {
        // Without this the wall would spin forever on an API process that
        // predates the snapshot route; a refresh failure after a good load
        // keeps the last snapshot and lets the freshness stamp tell the story.
        if (!loadedOnce.current) setLoadError(err.response?.status === 404
          ? 'The API server is running an older build without the dashboard snapshot route. Restart the server and reload.'
          : err.response?.data?.error || err.message || 'Could not load the presentation');
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, filterKey, configReady, refreshTick]);

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

  useEffect(() => {
    const resize = () => setListPageSize(window.innerHeight >= 900 ? 15 : window.innerHeight >= 720 ? 11 : 8);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const M = snapshot?.metrics;
  const highlights = snapshot?.publicHighlights || {};

  const viewKpis = useMemo(() => {
    if (!M) return {};
    const atRisk = M.diagnostics.redCount + M.diagnostics.amberCount;
    return {
      pulse: [
        { label: 'Total opportunities', value: fmtNumber(M.pulse.total), note: 'Filtered scope' },
        { label: 'Open opportunities', value: fmtNumber(M.pulse.openCount), note: `${pctOf(M.pulse.openCount / (M.pulse.total || 1) * 100)} of scope`, tone: 'blue' },
        { label: 'Win rate', value: fmtPercent(M.pulse.winRate), note: `${fmtNumber(M.pulse.wonCount)} of ${fmtNumber(M.pulse.closedCount)} closed`, tone: 'green' },
        { label: 'Closed opportunities', value: fmtNumber(M.pulse.closedCount), note: `${fmtNumber(M.pulse.wonCount)} won · ${fmtNumber(M.pulse.lostCount)} lost`, tone: 'amber' },
      ],
      diagnostics: [
        { label: 'Lost opportunities', value: fmtNumber(M.diagnostics.lostCount), note: `${fmtNumber(M.pulse.closedCount)} closed` },
        { label: 'Loss rate', value: fmtPercent(M.diagnostics.lossRate), note: 'Share of closed deals lost', tone: 'blue' },
        { label: 'Disengagement losses', value: pctOf(M.diagnostics.disengagementRate), note: `${fmtNumber(M.diagnostics.disengagedCount)} of closed deals`, tone: 'green' },
        { label: 'At risk', value: fmtNumber(atRisk), note: `Red or Amber of ${fmtNumber(M.diagnostics.ratedCount)} rated`, tone: 'amber' },
      ],
      velocity: [
        { label: 'Open opportunities', value: fmtNumber(M.pulse.openCount), note: 'In play' },
        { label: 'Stalled', value: fmtNumber(M.velocity.stalledCount), note: 'Past stage threshold', tone: 'blue' },
        { label: 'Stalled share', value: pctOf(M.velocity.stalledShare), note: 'Of open opportunities', tone: 'green' },
        { label: 'Twice over threshold', value: fmtNumber(M.velocity.wayOverCount), note: 'Effectively dormant', tone: 'amber' },
      ],
      wherewewin: [
        { label: 'Best org type', value: M.whereWeWin.bestOrg?.label || '—', note: M.whereWeWin.bestOrg ? `${pctOf(M.whereWeWin.bestOrg.winRate)} win rate` : 'No closed deals' },
        { label: 'Best industry', value: M.whereWeWin.bestIndustry?.label || '—', note: M.whereWeWin.bestIndustry ? `${pctOf(M.whereWeWin.bestIndustry.winRate)} win rate` : '3+ closed required', tone: 'blue' },
        { label: 'Win rate', value: fmtPercent(M.pulse.winRate), note: 'All closed deals', tone: 'green' },
        { label: 'Industries tracked', value: fmtNumber(M.whereWeWin.industriesTracked), note: `${fmtNumber(M.whereWeWin.rankable)} with 3+ closed`, tone: 'amber' },
      ],
      repperformance: [
        { label: 'Owners tracked', value: fmtNumber(M.repSummary.activeReps), note: `${fmtNumber(M.repSummary.qualifiedReps)} with 3+ closed` },
        { label: 'Median win rate', value: fmtPercent(M.repSummary.medianWinRate), note: 'Owners with 3+ closed', tone: 'blue' },
        { label: 'Top by wins', value: M.repSummary.topByWins?.rep || '—', note: M.repSummary.topByWins ? `${fmtNumber(M.repSummary.topByWins.wins)} wins` : '', tone: 'green' },
        { label: 'Top by win rate', value: M.repSummary.topByWinRate?.rep || '—', note: M.repSummary.topByWinRate ? `${pctOf(M.repSummary.topByWinRate.winRate)} on ${fmtNumber(M.repSummary.topByWinRate.closed)} closed` : '3+ closed required', tone: 'amber' },
      ],
    };
  }, [M]);

  const allSlides = useMemo(() => {
    if (!M) return [];
    const outcomeData = M.outcomeMix.map((d, i) => ({ ...d, color: [STATUS_COLORS.good, STATUS_COLORS.bad, STATUS_COLORS.info][i] }));
    const stageData = M.funnel.map(f => ({ label: f.stage, value: f.count, meta: `${pctOf(f.share)} of open`, color: seriesColor(0) }));
    const continentGauges = M.byContinent.map((d, i) => ({ label: d.label, value: d.winRate || 0, meta: `${fmtNumber(d.closed)} closed · ${fmtNumber(d.won)} won`, color: seriesColor(i) }));
    const healthData = M.healthMix.map(d => ({ label: d.label, value: d.count, meta: `${pctOf(d.share)} of open`, color: HEALTH_COLORS[d.label] }));
    const familyData = M.lossFamilies.map(f => ({ label: f.family, value: f.count, meta: `${pctOf(f.share)} of losses`, color: STATUS_COLORS.bad }));
    const lossByOrg = M.winRateByOrg.map((d, i) => ({ label: d.label, value: d.lossRate || 0, meta: `${fmtNumber(d.lost)} of ${fmtNumber(d.closed)} closed`, color: seriesColor(i) }));
    const stalledSplit = [
      { label: 'Stalled', value: M.velocity.stalledCount, color: STATUS_COLORS.bad },
      { label: 'On track', value: Math.max(0, M.pulse.openCount - M.velocity.stalledCount), color: STATUS_COLORS.good },
    ];
    const stalledByStage = M.daysByStage.filter(s => s.stalled > 0).map(s => ({ label: s.stage, value: s.stalled, meta: `of ${fmtNumber(s.count)} open`, color: STATUS_COLORS.warn }));
    const openByOrg = M.winRateByOrg.map((d, i) => ({ label: d.label, value: d.openCount, meta: `${pctOf(d.openCount / (M.pulse.openCount || 1) * 100)} of open`, color: seriesColor(i) }));
    const sourceData = M.leadSource.filter(d => d.closed > 0).map((d, i) => ({ label: d.label, value: d.winRate || 0, meta: `${fmtNumber(d.closed)} closed`, color: seriesColor(i) }));
    const typeData = M.typeHealth.filter(d => d.closed > 0).map((d, i) => ({ label: d.type, value: d.winRate || 0, meta: `${fmtNumber(d.closed)} closed`, color: seriesColor(i) }));
    const industryData = [...M.industryScorecard].sort((a, b) => (b.winRate || 0) - (a.winRate || 0)).slice(0, 8).map((d, i) => ({ label: d.industry, value: d.winRate || 0, meta: `${fmtNumber(d.closed)} closed`, color: seriesColor(i) }));
    const podGauges = M.podPerformance.map(p => ({ label: p.pod, value: p.winRate || 0, meta: `${fmtNumber(p.closed)} closed · ${fmtNumber(p.wins)} won`, color: rateColor(p.winRate) }));
    const byWins = [...M.repStats].sort((a, b) => b.wins - a.wins).slice(0, 8).map(r => ({ label: r.rep, value: r.wins, meta: `${pctOf(r.winRate)} win rate`, color: STATUS_COLORS.good }));
    const byRate = M.repStats.filter(r => r.closed >= 3).sort((a, b) => (b.winRate || 0) - (a.winRate || 0)).slice(0, 8).map(r => ({ label: r.rep, value: r.winRate || 0, meta: `${fmtNumber(r.closed)} closed`, color: STATUS_COLORS.info }));
    const repRows = applyTop([...M.repStats].sort((a, b) => b.wins - a.wins), 'reps');
    const repSlides = chunk(repRows, Math.max(6, listPageSize - 1)).map((rows, index, pages) => ({
      view: 'repperformance', title: 'Rep performance', content: <PresentCard title={`Owner scorecard${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`} subtitle="Ranked by wins" wide>
        <table className="presentation-table"><thead><tr><th>Owner</th><th>POD</th><th className="n">Closed</th><th className="n">Wins</th><th className="n">Win rate</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.rep}><td>{r.rep}</td><td>{r.pod}</td><td className="n">{fmtNumber(r.closed)}</td><td className="n">{fmtNumber(r.wins)}</td><td className="n"><Pill tone={(r.winRate || 0) >= 50 ? 'good' : (r.winRate || 0) >= 35 ? 'warn' : 'bad'}>{pctOf(r.winRate)}</Pill></td></tr>)}</tbody></table>
      </PresentCard>,
    }));
    return [
      { view: 'pulse', title: 'Pipeline overview', content: <div className="presentation-grid">
        <PresentCard title="Opportunity outcomes"><Donut data={outcomeData} centerLabel="Opportunities" /></PresentCard>
        <PresentCard title="Open opportunities by stage"><BarList data={stageData.slice(0, 7)} format={fmtNumber} sortable={false} /></PresentCard>
        <PresentCard title="Win rate by continent"><MetricGauges data={continentGauges} format={pctOf} /></PresentCard>
        <HighlightsCard items={highlights.pulse} />
      </div> },
      { view: 'diagnostics', title: 'Loss diagnostics', content: <div className="presentation-grid">
        <PresentCard title="Why deals are lost" subtitle="Lost opportunities by reason family"><BarList data={familyData} format={fmtNumber} sortable={false} /></PresentCard>
        <PresentCard title="Deal health of open pipeline"><Donut data={healthData} centerLabel="Open deals" /></PresentCard>
        <PresentCard title="Loss rate by org type"><MetricGauges data={lossByOrg} format={pctOf} /></PresentCard>
        <HighlightsCard items={highlights.diagnostics} />
      </div> },
      { view: 'velocity', title: 'Velocity & aging', content: <div className="presentation-grid">
        <PresentCard title="Stalled vs on track" subtitle="Open opportunities against their stage threshold"><Donut data={stalledSplit} centerLabel="Open deals" /></PresentCard>
        <PresentCard title="Stalled deals by stage"><BarList data={stalledByStage.slice(0, 7)} format={fmtNumber} sortable={false} /></PresentCard>
        <PresentCard title="Open opportunities by org type"><BarList data={openByOrg} format={fmtNumber} sortable={false} /></PresentCard>
        <HighlightsCard items={highlights.velocity} />
      </div> },
      { view: 'wherewewin', title: 'Where we win', content: <div className="presentation-grid">
        <PresentCard title="Win rate: continent × org type" subtitle="Colour is win rate; the number beneath is closed deal count" wide>
          <Heatmap rows={M.heat.continents} cols={M.heat.orgs} cell={(continent, org) => { const c = M.heat.cells[continent]?.[org]; return { count: c?.closed || 0, value: c?.winRate || 0 }; }} />
        </PresentCard>
        <HighlightsCard items={highlights.wherewewin} wide />
      </div> },
      { view: 'wherewewin', title: 'Where we win', content: <div className="presentation-grid">
        <PresentCard title="Win rate by deal source"><BarList data={sourceData} format={pctOf} sortable={false} /></PresentCard>
        <PresentCard title="Win rate by opportunity type"><BarList data={typeData} format={pctOf} sortable={false} /></PresentCard>
        <PresentCard title="Top industries by win rate" subtitle="Industries with three or more closed deals"><BarList data={industryData} format={pctOf} sortable={false} /></PresentCard>
        <PresentCard title="Win rate by POD"><MetricGauges data={podGauges} format={pctOf} /></PresentCard>
      </div> },
      { view: 'repperformance', title: 'Rep performance', content: <div className="presentation-grid">
        <PresentCard title="Most wins"><BarList data={byWins} format={fmtNumber} sortable={false} /></PresentCard>
        <PresentCard title="Best win rate" subtitle="Owners with three or more closed deals"><BarList data={byRate} format={pctOf} sortable={false} /></PresentCard>
        <PresentCard title="Win rate by POD"><MetricGauges data={podGauges} format={pctOf} /></PresentCard>
        <HighlightsCard items={highlights.repperformance} />
      </div> },
      ...repSlides,
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [M, highlights, listPageSize, JSON.stringify(tableTops)]);

  const scopedSlides = config.scope === 'current' ? allSlides.filter(s => s.view === config.view) : allSlides;
  const slides = scopedSlides.length ? scopedSlides : allSlides;
  const activeSlide = slides[Math.min(slide, slides.length - 1)] || allSlides[0];
  const activeKpis = viewKpis[activeSlide?.view] || viewKpis.pulse || [];
  const activeViewNumber = Math.max(1, VIEW_ORDER.indexOf(activeSlide?.view) + 1);

  useEffect(() => {
    if (slide >= slides.length) setSlide(Math.max(0, slides.length - 1));
  }, [slide, slides.length]);

  useEffect(() => {
    if (!playing || slides.length < 2) return;
    const timer = setInterval(() => setSlide(s => (s + 1) % slides.length), seconds * 1000);
    return () => clearInterval(timer);
  }, [playing, seconds, slides.length]);

  const move = delta => setSlide(s => (s + delta + slides.length) % slides.length);
  const changeSeconds = value => { setSeconds(value); localStorage.setItem('present-seconds', value); };

  if (loadError && !M) return <main className="presentation-loading"><div className="error">{loadError}</div></main>;
  if (loading || !M) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <HideableProvider value={hideControl}><main className="presentation-shell">
    <header className="presentation-header"><div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b><span>Counts and rates only — no revenue figures on the wall</span></div></div>
      <div className="presentation-view-label"><span>VIEW {activeViewNumber} OF {VIEW_ORDER.length}</span><b>{VIEW_LABELS[activeSlide?.view] || activeSlide?.title}</b></div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span><DataFreshnessStamp online={online} dataUpdatedAt={dataUpdatedAt} /></div>
    </header>
    <div className="presentation-kpi-strip">
      {activeKpis.map(kpi => <PresentKpi key={kpi.label} {...kpi} />)}
    </div>
    <div className="presentation-slide" ref={slideRef}>{activeSlide?.content}</div>
    <footer className={`presentation-controls${isFullscreen && !controlsVisible ? ' controls-hidden' : ''}`}>
      <button onClick={() => move(-1)} aria-label="Previous slide">‹</button>
      <button onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</button>
      <span>{Math.min(slide + 1, slides.length)} / {slides.length}</span>
      <button onClick={() => move(1)} aria-label="Next slide">›</button>
      <label>Change every <select value={seconds} onChange={e => changeSeconds(+e.target.value)}><option value="10">10 sec</option><option value="15">15 sec</option><option value="30">30 sec</option><option value="60">1 min</option><option value="120">2 min</option></select></label>
      {!share && <span className="hide-hint">Double-click any tile to hide it from the TV</span>}
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      {!share && <CopyTvLinkButton templateId={templateId} />}
      {!share && <button onClick={() => navigate(`/dashboard/${templateId}`)}>Exit</button>}
    </footer>
  </main></HideableProvider>;
}

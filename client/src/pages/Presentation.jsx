import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getData, getDashboardState } from '../lib/api';
import { BarList, Donut, MetricGauges, NeonColumns, Pill,
  fmtCurrency, fmtNumber, fmtPercent, CHART_PALETTE, STATUS_COLORS } from '../components/charts';
import AppLoader from '../components/AppLoader';

const splitProducts = value => String(value || '').split(';').map(v => v.trim()).filter(Boolean);
const chunk = (rows, size) => rows.length
  ? Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))
  : [[]];
const VIEW_LABELS = {
  pulse: 'Pipeline Overview', diagnostics: 'Loss Diagnostics', velocity: 'Velocity & Aging',
  wherewewin: 'Where We Win', repperformance: 'Rep Performance', accounts: 'Accounts & Whitespace',
};
const VIEW_ORDER = Object.keys(VIEW_LABELS);

function PresentCard({ title, subtitle, wide = false, children }) {
  return <section className={`present-card${wide ? ' present-card-wide' : ''}`}>
    <header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header>{children}
  </section>;
}

function PresentKpi({ label, value, note, tone = 'cyan' }) {
  return <div className={`present-kpi present-${tone}`}><span>{label}</span><b>{value}</b><small>{note}</small></div>;
}

export default function Presentation() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (!configReady) return;
    setLoading(true);
    getData(templateId, filters).then(setData).finally(() => setLoading(false));
  }, [templateId, filters, configReady]);

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

  const metrics = useMemo(() => {
    const open = data.filter(r => !r.isClosed);
    const closed = data.filter(r => r.isClosed);
    const won = closed.filter(r => r.isWon);
    const lost = closed.filter(r => !r.isWon);
    const sum = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0);
    return { open, closed, won, lost,
      openValue: sum(open, 'amount'), wonArr: sum(won, 'arr'), openArr: sum(open, 'arr'),
      winRate: closed.length ? won.length / closed.length * 100 : 0 };
  }, [data]);

  const regionData = useMemo(() => [...new Set(data.map(r => r.region).filter(Boolean))].map((region, i) => {
    const rows = data.filter(r => r.region === region && r.isWon);
    return { label: region, value: rows.reduce((s, r) => s + (r.arr || 0), 0),
      meta: `${rows.length} wins`, color: CHART_PALETTE[i % CHART_PALETTE.length] };
  }), [data]);

  const stageData = useMemo(() => [...new Set(metrics.open.map(r => r.stage).filter(Boolean))].map(stage => {
    const rows = metrics.open.filter(r => r.stage === stage);
    return { label: stage, value: rows.length, meta: fmtCurrency(rows.reduce((s, r) => s + (r.amount || 0), 0)), color: CHART_PALETTE[0] };
  }), [metrics.open]);

  const healthData = useMemo(() => ['Green','Amber','Red'].map((health, i) => {
    const rows = metrics.open.filter(r => String(r.dealHealth).toLowerCase() === health.toLowerCase());
    return { label: health, value: rows.reduce((s, r) => s + (r.arr || 0), 0),
      meta: `${rows.length} deals`, color: [STATUS_COLORS.good, STATUS_COLORS.warn, STATUS_COLORS.bad][i] };
  }), [metrics.open]);

  const outcomeData = useMemo(() => [
    { label: 'Won', value: metrics.won.length, color: STATUS_COLORS.good },
    { label: 'Lost', value: metrics.lost.length, color: STATUS_COLORS.bad },
    { label: 'Open', value: metrics.open.length, color: STATUS_COLORS.info },
  ], [metrics]);

  const lossData = useMemo(() => {
    const map = new Map();
    metrics.lost.forEach(r => {
      const key = r.lossReason || 'Not recorded';
      const current = map.get(key) || { value: 0, ids: new Set() };
      current.value += r.amount || 0; current.ids.add(r.id); map.set(key, current);
    });
    return [...map].map(([label, v]) => ({ label, value: v.value, meta: `${v.ids.size} opportunities`, color: STATUS_COLORS.bad }));
  }, [metrics.lost]);

  const repData = useMemo(() => [...new Set(data.map(r => r.owner).filter(Boolean))].map(owner => {
    const rows = data.filter(r => r.owner === owner);
    const closed = rows.filter(r => r.isClosed); const won = closed.filter(r => r.isWon);
    return { owner, closed: closed.length, wins: won.length,
      winRate: closed.length ? won.length / closed.length * 100 : 0,
      wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
      openArr: rows.filter(r => !r.isClosed).reduce((s, r) => s + (r.arr || 0), 0) };
  }).sort((a, b) => b.wonArr - a.wonArr), [data]);

  const productData = useMemo(() => [...new Set(data.flatMap(r => splitProducts(r.product)))].map((product, i) => {
    const rows = data.filter(r => splitProducts(r.product).includes(product));
    return { label: product, value: rows.reduce((s, r) => s + (r.amount || 0), 0),
      meta: `${rows.length} opportunities`, color: CHART_PALETTE[i % CHART_PALETTE.length] };
  }), [data]);

  const agingData = useMemo(() => [[0,30,'0–30 days'],[30,60,'30–60 days'],[60,90,'60–90 days'],[90,180,'90–180 days'],[180,Infinity,'180+ days']].map(([min,max,label]) => {
    const rows = metrics.open.filter(r => (r.daysStuck || 0) >= min && (r.daysStuck || 0) < max);
    return { label, value: rows.reduce((s,r) => s + (r.amount || 0), 0), meta: `${rows.length} deals`, color: STATUS_COLORS.warn };
  }), [metrics.open]);

  const stalledData = useMemo(() => metrics.open.filter(r => r.isStalled).sort((a,b) => (b.amount || 0) - (a.amount || 0)).slice(0,8)
    .map(r => ({ label: r.name || r.id, value: r.amount || 0, meta: `${r.daysStuck || 0} days · ${r.stage}`, color: STATUS_COLORS.bad })), [metrics.open]);

  const cycleByOrg = useMemo(() => [...new Set(metrics.closed.map(r => r.orgType).filter(Boolean))].map((org, i) => {
    const cycles = metrics.closed.filter(r => r.orgType === org).map(r => r.cycleDays).filter(Number.isFinite).sort((a,b) => a-b);
    return { label: org, value: Math.min(100, cycles.length ? cycles[Math.floor(cycles.length/2)] : 0),
      meta: `${cycles.length} closed · median days`, color: CHART_PALETTE[i % CHART_PALETTE.length] };
  }), [metrics.closed]);

  const accountData = useMemo(() => {
    const map = new Map();
    data.forEach(r => { if (!r.accountId) return; const a = map.get(r.accountId) || { id:r.accountId, name:r.account || r.accountId, open:0, wins:0, losses:0 };
      if (r.isWon) a.wins++; else if (r.isClosed) a.losses++; else a.open += r.amount || 0; map.set(r.accountId,a); });
    return [...map.values()];
  }, [data]);
  const topOpenAccounts = useMemo(() => [...accountData].sort((a,b) => b.open-a.open).map(a => ({ label:a.name,value:a.open,meta:`${a.wins} wins`,color:STATUS_COLORS.info })), [accountData]);
  const repeatLossAccounts = useMemo(() => accountData.filter(a => a.losses > 1).sort((a,b) => b.losses-a.losses).map(a => ({ label:a.name,value:a.losses,meta:`${a.wins} wins`,color:STATUS_COLORS.bad })), [accountData]);
  const openOpportunityData = useMemo(() => metrics.open.map(r => ({ label: r.name || r.id, value: r.amount || 0, meta: `${r.stage} · ${r.owner}`, color: STATUS_COLORS.info })).sort((a,b) => b.value-a.value), [metrics.open]);
  const atRiskData = useMemo(() => metrics.open.filter(r => ['red','amber'].includes(String(r.dealHealth).toLowerCase())).map(r => ({ label:r.name || r.id,value:r.amount || 0,meta:`${r.dealHealth} · ${r.daysStuck || 0} days`,color:String(r.dealHealth).toLowerCase()==='red'?STATUS_COLORS.bad:STATUS_COLORS.warn })).sort((a,b)=>b.value-a.value), [metrics.open]);
  const stalledPresentationData = useMemo(() => metrics.open.filter(r => r.isStalled).map(r => ({ label:r.name || r.id,value:r.daysStuck || 0,meta:`${fmtCurrency(r.amount)} · limit ${r.staleThreshold || 0}d`,color:STATUS_COLORS.bad })).sort((a,b)=>b.value-a.value), [metrics.open]);
  const businessMixData = useMemo(() => [...new Set(data.map(r=>r.type).filter(Boolean))].map((type,i) => { const rows=data.filter(r=>r.type===type); return {label:type,value:rows.reduce((s,r)=>s+(r.amount||0),0),meta:`${rows.length} opportunities`,color:CHART_PALETTE[i%CHART_PALETTE.length]}; }), [data]);
  const podPresentationData = useMemo(() => [...new Set(data.map(r=>r.pod).filter(Boolean))].map((pod,i) => { const rows=data.filter(r=>r.pod===pod); const closed=rows.filter(r=>r.isClosed); const won=closed.filter(r=>r.isWon); return {label:pod,value:won.reduce((s,r)=>s+(r.arr||0),0),meta:`${closed.length} closed · ${won.length} won · ${closed.length-won.length} lost`,color:CHART_PALETTE[i%CHART_PALETTE.length]}; }), [data]);

  const viewKpis = useMemo(() => {
    const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] || 0), 0);
    const stalled = metrics.open.filter(r => r.isStalled);
    const expansion = accountData.filter(a => a.wins > 0 && a.open > 0);
    const repeatLoss = accountData.filter(a => a.losses > 1);
    const uniqueProducts = new Set(data.flatMap(r => splitProducts(r.product))).size;
    const avgWonArr = metrics.won.length ? metrics.wonArr / metrics.won.length : 0;
    return {
      pulse: [
        { label: 'Total opportunities', value: fmtNumber(data.length), note: 'Filtered scope' },
        { label: 'Open pipeline', value: fmtCurrency(metrics.openValue), note: `${metrics.open.length} active`, tone: 'blue' },
        { label: 'Won ARR', value: fmtCurrency(metrics.wonArr), note: `${metrics.won.length} won`, tone: 'green' },
        { label: 'Win rate', value: fmtPercent(metrics.winRate), note: `${metrics.closed.length} closed`, tone: 'amber' },
      ],
      diagnostics: [
        { label: 'Lost opportunities', value: fmtNumber(metrics.lost.length), note: `${metrics.closed.length} closed` },
        { label: 'Value lost', value: fmtCurrency(sum(metrics.lost, 'amount')), note: 'Closed-lost value', tone: 'blue' },
        { label: 'Loss reasons', value: fmtNumber(lossData.length), note: 'Distinct reasons', tone: 'green' },
        { label: 'Average lost deal', value: fmtCurrency(metrics.lost.length ? sum(metrics.lost, 'amount') / metrics.lost.length : 0), note: 'Per lost opportunity', tone: 'amber' },
      ],
      velocity: [
        { label: 'Open opportunities', value: fmtNumber(metrics.open.length), note: fmtCurrency(metrics.openValue) },
        { label: 'Stalled', value: fmtNumber(stalled.length), note: 'Past stage threshold', tone: 'blue' },
        { label: 'Stalled value', value: fmtCurrency(sum(stalled, 'amount')), note: 'Open value at risk', tone: 'green' },
        { label: 'Closed opportunities', value: fmtNumber(metrics.closed.length), note: 'Cycle-time population', tone: 'amber' },
      ],
      repperformance: [
        { label: 'Owners tracked', value: fmtNumber(repData.length), note: 'Owner Name' },
        { label: 'Closed opportunities', value: fmtNumber(metrics.closed.length), note: `${metrics.won.length} won`, tone: 'blue' },
        { label: 'Won ARR', value: fmtCurrency(metrics.wonArr), note: 'Booked by owners', tone: 'green' },
        { label: 'Team win rate', value: fmtPercent(metrics.winRate), note: 'Closed opportunities', tone: 'amber' },
      ],
      wherewewin: [
        { label: 'Won ARR', value: fmtCurrency(metrics.wonArr), note: 'Primary success metric' },
        { label: 'Won opportunities', value: fmtNumber(metrics.won.length), note: `${metrics.closed.length} closed`, tone: 'blue' },
        { label: 'Win rate', value: fmtPercent(metrics.winRate), note: 'Secondary metric', tone: 'green' },
        { label: 'Products tracked', value: fmtNumber(uniqueProducts), note: `Avg won ARR ${fmtCurrency(avgWonArr)}`, tone: 'amber' },
      ],
      accounts: [
        { label: 'Accounts tracked', value: fmtNumber(accountData.length), note: 'Filtered scope' },
        { label: 'Open accounts', value: fmtNumber(accountData.filter(a => a.open > 0).length), note: fmtCurrency(metrics.openValue), tone: 'blue' },
        { label: 'Expansion candidates', value: fmtNumber(expansion.length), note: 'Won and still open', tone: 'green' },
        { label: 'Repeat-loss accounts', value: fmtNumber(repeatLoss.length), note: 'More than one loss', tone: 'amber' },
      ],
    };
  }, [data, metrics, lossData, repData, accountData]);

  const lossSlides = chunk(lossData, listPageSize).map((rows, index, pages) => ({
    view: 'diagnostics', title: 'Loss diagnostics', content: <PresentCard title={`Loss reasons${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`} subtitle="Value lost with distinct opportunity count" wide>
      <BarList data={rows} format={fmtCurrency} sortable={false} />
    </PresentCard>,
  }));
  const repSlides = chunk(applyTop(repData, 'reps'), Math.max(6, listPageSize - 1)).map((rows, index, pages) => ({
    view: 'repperformance', title: 'Rep performance', content: <PresentCard title={`Owner scorecard${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`} subtitle="Ranked by Won ARR" wide>
      <table className="presentation-table"><thead><tr><th>Owner Name</th><th className="n">Closed</th><th className="n">Wins</th><th className="n">Win rate</th><th className="n">Won ARR</th><th className="n">Open ARR</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.owner}><td>{r.owner}</td><td className="n">{fmtNumber(r.closed)}</td><td className="n">{fmtNumber(r.wins)}</td><td className="n"><Pill tone={r.winRate >= 50 ? 'good' : r.winRate >= 35 ? 'warn' : 'bad'}>{fmtPercent(r.winRate, 0)}</Pill></td><td className="n">{fmtCurrency(r.wonArr)}</td><td className="n">{fmtCurrency(r.openArr)}</td></tr>)}</tbody></table>
    </PresentCard>,
  }));
  const productSlides = chunk(productData, listPageSize).map((rows, index, pages) => ({
    view: 'wherewewin', title: 'Where we win', content: <PresentCard title={`Opportunity value by product${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`} subtitle="Product performance in the filtered scope" wide>
      <BarList data={rows} format={fmtCurrency} sortable={false} />
    </PresentCard>,
  }));
  const listSlides = (view, title, rows, format) => chunk(rows, listPageSize).map((page, index, pages) => ({
    view, title: VIEW_LABELS[view], content: <PresentCard title={`${title}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`} wide><BarList data={page} format={format} sortable={false} /></PresentCard>,
  }));

  const allSlides = [
    { view: 'pulse', title: 'Pipeline overview', content: <div className="presentation-grid">
      <PresentCard title="Won ARR by region"><NeonColumns data={regionData} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="Opportunity outcomes"><Donut data={outcomeData} centerLabel="Opportunities" /></PresentCard>
      <PresentCard title="Open opportunities by stage"><BarList data={[...stageData].sort((a,b) => b.value-a.value).slice(0,5)} format={fmtNumber} sortable={false} /></PresentCard>
      <PresentCard title="Open ARR by health"><MetricGauges data={healthData.map(d => ({ ...d, value: metrics.openArr ? d.value / metrics.openArr * 100 : 0,
        meta: `${fmtCurrency(d.value)} · ${d.meta}` }))} format={v => fmtPercent(v, 0)} /></PresentCard>
    </div> },
    ...listSlides('pulse', 'Open opportunities', applyTop(openOpportunityData, 'largestOpen'), fmtCurrency),
    ...lossSlides,
    ...listSlides('diagnostics', 'At-risk open pipeline', applyTop(atRiskData, 'atRisk'), fmtCurrency),
    { view: 'velocity', title: 'Velocity & aging', content: <div className="presentation-grid">
      <PresentCard title="Aging profile"><BarList data={agingData} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="Open opportunities by stage"><BarList data={[...stageData].sort((a,b)=>b.value-a.value).slice(0,7)} format={fmtNumber} sortable={false} /></PresentCard>
      <PresentCard title="Largest stalled opportunities"><BarList data={stalledData} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="Median cycle days by org type"><MetricGauges data={cycleByOrg} format={v => `${Math.round(v)} d`} /></PresentCard>
    </div> },
    ...listSlides('velocity', 'Stalled open deals', applyTop(stalledPresentationData, 'stalled'), v => `${fmtNumber(v)} d`),
    ...repSlides,
    ...productSlides,
    { view: 'wherewewin', title: 'Where we win', content: <div className="presentation-grid">
      <PresentCard title="Business mix"><BarList data={businessMixData} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="ARR by POD"><BarList data={applyTop(podPresentationData, 'pod')} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="Opportunity outcomes"><Donut data={outcomeData} centerLabel="Opportunities" /></PresentCard>
      <PresentCard title="Won ARR by region"><NeonColumns data={regionData} format={fmtCurrency} sortable={false} /></PresentCard>
    </div> },
    { view: 'accounts', title: 'Accounts & whitespace', content: <div className="presentation-grid">
      <PresentCard title="Account outcomes"><Donut data={[
        {label:'Won accounts',value:accountData.filter(a=>a.wins>0).length,color:STATUS_COLORS.good},
        {label:'Repeat-loss accounts',value:accountData.filter(a=>a.losses>1).length,color:STATUS_COLORS.bad},
        {label:'Open accounts',value:accountData.filter(a=>a.open>0).length,color:STATUS_COLORS.info}]} centerLabel="Accounts" /></PresentCard>
      <PresentCard title="Largest open accounts"><BarList data={topOpenAccounts.slice(0, 5)} format={fmtCurrency} sortable={false} /></PresentCard>
      <PresentCard title="Repeat-loss accounts"><BarList data={applyTop(repeatLossAccounts, 'repeatLoss').slice(0, 5)} format={fmtNumber} sortable={false} /></PresentCard>
      <PresentCard title="Expansion candidates"><BarList data={applyTop(topOpenAccounts.filter(a => /[1-9]/.test(a.meta)), 'expansion').slice(0, 5)} format={fmtCurrency} sortable={false} /></PresentCard>
    </div> },
    ...listSlides('accounts', 'Repeat-loss accounts', applyTop(repeatLossAccounts, 'repeatLoss'), fmtNumber),
    ...listSlides('accounts', 'Expansion candidates', applyTop(topOpenAccounts.filter(a => /[1-9]/.test(a.meta)), 'expansion'), fmtCurrency),
  ];
  const scopedSlides = config.scope === 'current' ? allSlides.filter(s => s.view === config.view) : allSlides;
  const slides = scopedSlides.length ? scopedSlides : allSlides;
  const activeSlide = slides[Math.min(slide, slides.length - 1)] || allSlides[0];
  // Absolute Won ARR is intentionally restricted to the interactive dashboard.
  // Presentation mode keeps the supporting percentages and counts, but never
  // renders the sensitive Won ARR KPI value on a TV slide.
  const activeKpis = (viewKpis[activeSlide?.view] || viewKpis.pulse)
    .filter(kpi => kpi.label !== 'Won ARR');
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

  if (loading) return <AppLoader fullscreen label="Preparing presentation…" />;
  return <main className="presentation-shell">
    <header className="presentation-header"><div className="presentation-brand"><img src="/testmu-bi-logo-v2.png" alt="" /><div><b>TestMu BI</b><span>Dashboard presentation</span></div></div>
      <div className="presentation-view-label"><span>VIEW {activeViewNumber} OF {VIEW_ORDER.length}</span><b>{VIEW_LABELS[activeSlide?.view] || activeSlide?.title}</b></div>
      <div className="presentation-clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b><span>{now.toLocaleDateString()}</span></div>
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
      <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      <button onClick={() => navigate(`/dashboard/${templateId}`)}>Exit</button>
    </footer>
  </main>;
}

import { useEffect, useRef, useState } from 'react';
import Login from './Login';
import LiveSignal from '../components/LiveSignal';
import './Landing.css';
import './LandingLaunch.css';

const QUESTIONS = ['ARR by region', 'Pipeline this quarter', 'Top reps', 'Win rate', 'Forecast'];
const VIEWS = {
  'ARR by region': { title: 'Won ARR', unit: '$', suffix: 'M', total: 4.2, change: '+18.6%', labels: ['AMER', 'EMEA', 'APAC'], values: [2.1, 1.35, .75], format: v => `$${v.toFixed(2)}M` },
  'Pipeline this quarter': { title: 'Open pipeline', unit: '$', suffix: 'M', total: 13.4, change: '+24.2%', labels: ['Qualify', 'Demo', 'Trial', 'Proposal', 'Negotiate'], values: [3.8, 3.2, 2.9, 2.1, 1.4], format: v => `$${v.toFixed(1)}M` },
  'Top reps': { title: 'Won ARR', unit: '$', suffix: 'M', total: 4.2, change: '+18.6%', labels: ['Riya', 'Dev', 'Sam', 'Alex', 'Jo'], values: [1.2, 1.05, .85, .65, .45], format: v => `$${v.toFixed(2)}M` },
  'Win rate': { title: 'Win rate', unit: '', suffix: '%', total: 38.4, change: '+6.2 pts', labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], values: [26, 28, 31, 29, 34, 38.4], format: v => `${v.toFixed(1)}%` },
  Forecast: { title: 'Forecast', unit: '$', suffix: 'M', total: 1.9, change: '+12.4%', labels: ['Commit', 'Best case', 'Pipeline'], values: [.95, .6, .35], format: v => `$${v.toFixed(2)}M` },
};
const TREND = [.18, .23, .21, .31, .29, .38, .34, .43, .4, .52, .49, .64];
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const STORY = [
  { title: 'From source to signal.', detail: 'Your Tableau data. A whole new perspective.' },
  { title: 'Ask your data.', detail: 'A question in. A clearer picture out.' },
  { title: 'Put it on the wall.', detail: 'Live boards for every screen.' },
];

function Arrow() { return <span aria-hidden="true">↗</span>; }
function Mark() { return <span className="rv-mark" aria-hidden="true"><i /><i /><i /></span>; }

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Counter({ value, reduced }) {
  const ref = useRef(null);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) { ref.current.textContent = value.toFixed(1); return; }
    let frame;
    const start = performance.now();
    const tick = now => {
      const progress = Math.min((now - start) / 650, 1);
      ref.current.textContent = (from + (value - from) * (1 - Math.pow(1 - progress, 3))).toFixed(1);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span ref={ref}>{value.toFixed(1)}</span>;
}

function RevenueBoard({ question, explored, region, setRegion, chartMode, setChartMode, wall = false, intro, reduced, tick, onPresent }) {
  const view = VIEWS[question];
  const factor = question === 'Win rate' ? 1 : region === 'AMER' ? .5 : region === 'EMEA' ? .32 : 1;
  const refresh = tick % 2 ? 1.012 : 1;
  const regional = explored && question === 'ARR by region' && region !== 'All regions';
  const rawValues = regional ? [view.values[view.labels.indexOf(region)]] : explored ? view.values : TREND;
  const values = rawValues.map(v => v * (regional ? 1 : factor) * refresh);
  const labels = regional ? [region] : explored ? view.labels : MONTHS;
  const max = Math.max(...(explored ? view.values : TREND)) * 1.13;
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 600},${170 - v / max * 165}`).join(' ');
  return (
    <div className={`rv-board ${wall ? 'is-wall' : ''} ${intro < 2 ? 'is-assembling' : ''}`} aria-label="Interactive revenue board with sample data">
      <div className="rv-board-chrome">
        <div className="rv-board-name"><Mark /><span>Workspace <span className="rv-slash">/</span> <strong>Revenue overview</strong></span></div>
        <span className="rv-board-demo">Sample data</span>
        <button type="button" className="rv-icon-button" onClick={onPresent} aria-label="Open presentation mode"><span aria-hidden="true">⛶</span></button>
      </div>
      <div className="rv-board-heading">
        <div><span className="rv-overline">THE BIG PICTURE <i className="rv-on-track">ON TRACK ↗</i></span><h3>{wall ? 'Revenue, in the room.' : 'A very good quarter.'}</h3></div>
        <div className="rv-filters">
          {!wall && <label className="rv-select"><span className="rv-sr-only">Filter by region</span><select value={region} onChange={e => setRegion(e.target.value)}><option>All regions</option><option>AMER</option><option>EMEA</option></select></label>}
          <span className="rv-quarter">Q3 2026</span>
        </div>
      </div>
      <div className="rv-board-main">
        <div className="rv-main-metric">
          <span className="rv-metric-label">{view.title}</span>
          <div className="rv-big-number" aria-label={`${view.title}: ${view.unit}${(view.total * factor * refresh).toFixed(1)}${view.suffix}`}><span aria-hidden="true">{view.unit}<Counter value={intro < 2 ? 0 : view.total * factor * refresh} reduced={reduced} /><em>{view.suffix}</em></span></div>
          <span className="rv-gain">↗ {view.change}<span> vs. last quarter</span></span>
          <div className="rv-quota"><div><span>Quota attainment</span><strong>{region === 'All regions' ? 84 : region === 'AMER' ? 91 : 78}%</strong></div><div className="rv-quota-track"><i style={{ transform: `scaleX(${region === 'All regions' ? .84 : region === 'AMER' ? .91 : .78})` }} /></div><small>A little closer. Every day.</small></div>
        </div>
        <div className="rv-chart">
          <div className="rv-chart-heading"><span>{explored ? question : 'Revenue momentum'}</span>{!wall && !explored ? <div className="rv-chart-switch" aria-label="Chart style"><button type="button" aria-label="Show bar chart" aria-pressed={chartMode === 'bar'} onClick={() => setChartMode('bar')}>▥ <span>Bars</span></button><button type="button" aria-label="Show trend chart" aria-pressed={chartMode === 'line'} onClick={() => setChartMode('line')}>⌁ <span>Trend</span></button></div> : <span><i /> {explored ? 'Current quarter' : 'Won ARR'}</span>}</div>
          <div className={`rv-chart-plot ${chartMode === 'line' && !explored ? 'rv-chart-as-line' : ''}`} role="group" aria-label={explored ? question : 'Won ARR from April through September'}>
            <div className="rv-chart-grid" aria-hidden="true"><span>{view.format(max)}</span><span>{view.format(max / 2)}</span><span>0</span></div>
            {chartMode === 'line' && !explored && <svg className="rv-trend-line" viewBox="0 0 600 170" preserveAspectRatio="none" aria-hidden="true"><polygon points={`0,170 ${points} 600,170`} /><polyline points={points} pathLength="1" /></svg>}
            <div className="rv-bars" style={{ '--bars': values.length }}>
              {values.map((v, i) => <div className="rv-bar-column" key={`${question}-${i}`}><button type="button" className="rv-bar" style={{ '--bar-height': v / max, '--delay': `${i * 45}ms` }} aria-label={`${explored ? labels[i] : MONTHS[Math.floor(i / 2)]}: ${view.format(v)}`}><span className="rv-bar-fill" /><span className="rv-tooltip">{explored ? labels[i] : MONTHS[Math.floor(i / 2)]}<strong>{view.format(v)}</strong></span></button></div>)}
            </div>
          </div>
          <div className="rv-chart-labels" style={{ '--labels': labels.length }}>{labels.map(l => <span key={l}>{l}</span>)}</div>
        </div>
      </div>
      <div className="rv-board-bottom">
        <div><span className="rv-mini-label">Pipeline coverage</span><strong>{(3.2 * (region === 'All regions' ? 1 : 1.06)).toFixed(1)}<em>×</em></strong><span className="rv-tiny-bars" aria-hidden="true">{[25, 40, 33, 60, 52, 80, 72, 95].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span></div>
        <div><span className="rv-mini-label">Forecast</span><strong>${(1.9 * factor).toFixed(1)}<em>M</em></strong><span className="rv-forecast-note">Looking ahead ↗</span></div>
        <div><span className="rv-mini-label">Trials in flight</span><strong>{Math.round(41 * factor)}</strong><span className="rv-trials"><i /><i /><i /><i /><i /></span></div>
      </div>
      <div className="rv-board-footer"><span><i className="rv-live-dot" /> {wall ? 'LIVE DEMO' : 'TABLEAU · DEMO'}</span><span>Sample data <span aria-hidden="true">·</span> {tick ? 'Updated now' : 'Synced just now'}</span></div>
    </div>
  );
}

export default function Landing() {
  const prefersReduced = useReducedMotion();
  const [motionPaused, setMotionPaused] = useState(false);
  const reduced = prefersReduced || motionPaused;
  const journey = useRef(null);
  const authDialog = useRef(null);
  const wallDialog = useRef(null);
  const queryTimer = useRef(null);
  const typingTimer = useRef(null);
  const [step, setStep] = useState(0);
  const [intro, setIntro] = useState(reduced ? 3 : 0);
  const [question, setQuestion] = useState('ARR by region');
  const [input, setInput] = useState('ARR by region');
  const [explored, setExplored] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [queryError, setQueryError] = useState('');
  const [region, setRegion] = useState('All regions');
  const [tick, setTick] = useState(0);
  const [authMode, setAuthMode] = useState(null);
  const [wallOpen, setWallOpen] = useState(false);
  const [sourceStep, setSourceStep] = useState(0);
  const [source, setSource] = useState('Tableau view');
  const [chartMode, setChartMode] = useState('bar');

  useEffect(() => {
    if (reduced) { setIntro(3); return; }
    if (intro >= 3) return;
    let timers = [];
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      timers = [1, 2, 3].map(n => setTimeout(() => setIntro(n), n * 650));
      observer.disconnect();
    }, { threshold: .2 });
    observer.observe(journey.current.querySelector('.rv-screen-shell'));
    return () => { observer.disconnect(); timers.forEach(clearTimeout); };
  }, [reduced]);
  useEffect(() => {
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = journey.current;
        if (getComputedStyle(element.firstElementChild).position !== 'sticky') return;
        const travel = element.offsetHeight - window.innerHeight;
        const progress = Math.max(0, Math.min(1, -element.getBoundingClientRect().top / Math.max(travel, 1)));
        setStep(progress < .32 ? 0 : progress < .68 ? 1 : 2);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  useEffect(() => {
    if (reduced) return;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(journey.current);
    const timer = setInterval(() => { if (!document.hidden && (visible || wallDialog.current?.open) && !authDialog.current?.open) setTick(n => n + 1); }, 12000);
    return () => { clearInterval(timer); observer.disconnect(); };
  }, [reduced]);
  useEffect(() => () => { clearTimeout(queryTimer.current); clearInterval(typingTimer.current); }, []);
  useEffect(() => { if (authMode) authDialog.current.showModal(); }, [authMode]);
  useEffect(() => { if (wallOpen) wallDialog.current.showModal(); }, [wallOpen]);
  useEffect(() => {
    if (!authMode && !wallOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
  }, [authMode, wallOpen]);

  const goToStep = index => {
    const top = journey.current.getBoundingClientRect().top + window.scrollY;
    const compact = getComputedStyle(journey.current.firstElementChild).position !== 'sticky';
    if (compact) setStep(index);
    const travel = Math.max(1, journey.current.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + (compact ? 0 : travel * [0, .45, .84][index]), behavior: reduced ? 'instant' : 'smooth' });
  };
  const ask = (text, type = false) => {
    clearTimeout(queryTimer.current); clearInterval(typingTimer.current);
    const match = QUESTIONS.find(q => q.toLowerCase() === text.trim().toLowerCase());
    if (!match) { setQueryError('Try one of the example questions below.'); setProcessing(false); return; }
    setQueryError(''); setProcessing(true);
    if (type && !reduced) {
      let length = 0;
      setInput('');
      typingTimer.current = setInterval(() => { length += 2; setInput(match.slice(0, length)); if (length >= match.length) clearInterval(typingTimer.current); }, 24);
    } else setInput(match);
    queryTimer.current = setTimeout(() => { setQuestion(match); setExplored(true); setProcessing(false); }, reduced ? 0 : 650);
  };
  const boardProps = { question, explored, region, setRegion, chartMode, setChartMode, intro, reduced, tick, onPresent: () => setWallOpen(true) };

  return (
    <div className={`revenue-landing rv-launch ${reduced ? 'rv-static' : ''}`}>
      <a className="rv-skip" href="#signin" onClick={e => { e.preventDefault(); setAuthMode('login'); }}>Skip to sign in</a>
      <header className="rv-nav">
        <a className="rv-brand" href="#top" aria-label="TestMu BI home"><Mark /><span>TestMu <b>BI</b></span></a>
        <nav aria-label="Main navigation"><a href="#experience" onClick={e => { e.preventDefault(); goToStep(0); }}>The experience</a><a href="#connect">Connect your data</a><span className="rv-nav-live"><i /> Always in sync</span></nav>
        <button type="button" className="rv-nav-signin" onClick={() => setAuthMode('login')}>Sign in <Arrow /></button>
      </header>
      <main id="top">
        <section className="rv-hero" aria-labelledby="rv-title">
          <div className="rv-hero-copy">
          <div className="rv-eyebrow"><span className="rv-live-dot" /> THE REVENUE CONTROL ROOM <span>LIVE</span></div>
          <h1 id="rv-title">Your revenue.<br /><em>Always live.</em><span className="rv-title-spark" aria-hidden="true">↗</span></h1>
          <p>Turn Tableau data into live, shareable boards.</p>
          <div className="rv-hero-actions"><button type="button" className="rv-button" onClick={() => setAuthMode('signup')}>Get started <Arrow /></button><button type="button" className="rv-text-button" onClick={() => goToStep(0)}><span className="rv-play" aria-hidden="true">▶</span> See it live</button></div>
          <div className="rv-hero-proof"><span className="rv-proof-bars" aria-hidden="true"><i /><i /><i /><i /></span><span>Less reporting.<br /><strong>More perspective.</strong></span><i /><span>One source.<br /><strong>Every screen.</strong></span></div>
          </div>
          <LiveSignal region={region} onRegion={setRegion} onExplore={() => goToStep(0)} onPresent={() => setWallOpen(true)} reduced={reduced} />
          <div className="rv-hero-footnote"><span>01 / YOUR DATA, IN MOTION</span><span>EXPLORE THE LIVE WORKSPACE <span aria-hidden="true">↓</span></span></div>
        </section>
        <section className="rv-journey" ref={journey} id="experience" aria-label="Explore the product">
          <div className={`rv-sticky rv-step-${step}`}>
            <div className="rv-story-top"><div className="rv-chapter"><span>0{step + 1} / THE EXPERIENCE</span><h2>{STORY[step].title}</h2></div><p>{STORY[step].detail}</p></div>
            <div className="rv-product-stage">
              <div className="rv-stage-rail"><span className="rv-demo-label"><i /> LIVE WORKSPACE</span><div className="rv-story-tabs" aria-label="Explore the demo stages">{['The board', 'Ask your data', 'On every screen'].map((label, i) => <button key={label} type="button" aria-pressed={step === i} onClick={() => goToStep(i)}><span>0{i + 1}</span> {label}</button>)}</div><button type="button" className="rv-motion-control" onClick={() => setMotionPaused(p => !p)} aria-label={motionPaused ? 'Play animation' : 'Pause animation'} disabled={prefersReduced}>{reduced ? '▶' : 'Ⅱ'}<span>{reduced ? 'Motion off' : 'Pause'}</span></button></div>
              <div className="rv-workspace"><aside className="rv-workspace-sidebar" aria-label="Demo workspace views"><span className="rv-sidebar-brand"><Mark /><strong>Your workspace</strong></span><span className="rv-sidebar-label">OVERVIEW</span><button type="button" className={!explored ? 'is-selected' : ''} aria-label="View revenue overview" onClick={() => { setExplored(false); setQuestion('ARR by region'); goToStep(0); }}><span>▦</span> Revenue</button><button type="button" className={explored && question === 'Top reps' ? 'is-selected' : ''} aria-label="View rep performance" onClick={() => { ask('Top reps'); goToStep(1); }}><span>◎</span> Rep performance</button><button type="button" className={explored && question === 'Forecast' ? 'is-selected' : ''} aria-label="View revenue forecast" onClick={() => { ask('Forecast'); goToStep(1); }}><span>⌁</span> Forecast</button><div className="rv-sidebar-source"><span className="rv-sidebar-label">YOUR SOURCE</span><strong><span>✳</span> Tableau <i /></strong><small>Sample workspace</small></div></aside><div className="rv-screen-shell"><RevenueBoard {...boardProps} wall={step === 2} /></div></div>
              <div className="rv-stage-control">
                {step === 0 && <div className="rv-data-flow" aria-label="Data becomes insight, a board, and a live screen">{['Tableau', 'Insight', 'Your board', 'Live screen'].map((name, i) => <div className={intro >= i ? 'is-connected' : ''} key={name}><span className="rv-flow-node">{i === 0 ? '✳' : i === 3 ? '▣' : i === 2 ? '▥' : '↗'}</span><span>{name}</span>{i < 3 && <i className="rv-flow-line" />}</div>)}</div>}
                {step === 1 && <div className="rv-ask"><form onSubmit={e => { e.preventDefault(); ask(input); }}><span className="rv-query-symbol" aria-hidden="true">✳</span><label className="rv-sr-only" htmlFor="rv-question">Ask your data</label><input id="rv-question" value={input} onChange={e => { clearInterval(typingTimer.current); clearTimeout(queryTimer.current); setProcessing(false); setInput(e.target.value); setQueryError(''); }} aria-describedby="rv-query-status" /><button type="submit" aria-label="Run example question" disabled={processing}>{processing ? <span className="rv-loading-dots">•••</span> : '↵'}</button></form><div className="rv-prompts">{QUESTIONS.map(q => <button type="button" key={q} aria-pressed={explored && q === question} onClick={() => ask(q, true)}>{q}</button>)}</div><span id="rv-query-status" className={`rv-query-status ${queryError ? 'is-error' : ''}`} role="status">{queryError || (processing ? 'Finding the signal…' : explored ? `Showing ${question.toLowerCase()} · Sample data` : 'Guided demo · Try a question')}</span></div>}
                {step === 2 && <div className="rv-wall-control"><span><i className="rv-live-dot" /> A room with a view.</span><button type="button" className="rv-text-button" onClick={() => setWallOpen(true)}>Try fullscreen <span aria-hidden="true">⛶</span></button></div>}
              </div>
            </div>
            <div className="rv-stage-caption"><span><i /> REAL POSSIBILITIES. SAMPLE NUMBERS.</span><span>{step === 0 ? 'Make it yours. Try a filter or chart style. ↑' : step === 1 ? 'Small questions. Big perspective.' : 'Made for the Monday meeting. And every day after.'}</span></div>
          </div>
        </section>
        <section className="rv-connect" id="connect" aria-labelledby="rv-connect-title">
          <div className="rv-connect-heading"><span className="rv-overline">YOUR DATA HAS PLACES TO BE.</span><h2 id="rv-connect-title">Connect. Choose.<br /><em>Go live.</em></h2><p>One source. A shared perspective.</p></div>
          <div className="rv-connection-demo">
            <div className="rv-connect-steps" aria-label="Connection preview">{['Connect', 'Choose', 'Go live'].map((s, i) => <button type="button" className={sourceStep >= i ? 'is-active' : ''} key={s} aria-pressed={sourceStep === i} onClick={() => setSourceStep(i)}><span>0{i + 1}</span>{s}</button>)}</div>
            <div className={`rv-connection-map rv-connection-step-${sourceStep}`}><svg className="rv-connection-paths" viewBox="0 0 640 240" preserveAspectRatio="none" aria-hidden="true"><path d="M100 45H185Q205 45 205 65V100Q205 120 225 120H470M100 120H470M100 195H185Q205 195 205 175V140Q205 120 225 120H470" /></svg><div className="rv-source-options" aria-label="Supported data sources">{['Tableau view', 'Published source', 'File upload'].map((s, i) => <button type="button" key={s} aria-pressed={source === s} onClick={() => { setSource(s); setSourceStep(0); }}><span aria-hidden="true">{i === 0 ? '✳' : i === 1 ? '▤' : '↑'}</span>{s}</button>)}</div><div className="rv-connection-core" aria-hidden="true"><Mark /><span>TESTMU BI</span></div><div className="rv-source-surface"><span className="rv-source-icon" aria-hidden="true">{sourceStep === 2 ? '✓' : '▥'}</span><div><span className="rv-overline">{sourceStep === 0 ? 'START WITH WHAT YOU HAVE' : sourceStep === 1 ? 'CHOOSE YOUR PERSPECTIVE' : 'READY FOR THE ROOM'}</span><h3>{sourceStep === 0 ? source : sourceStep === 1 ? 'Revenue overview' : 'Your board is ready.'}</h3><span className="rv-source-detail">{sourceStep === 0 ? 'Your source. Your workspace.' : sourceStep === 1 ? 'Select a view. Make it yours.' : 'Connect your own data to get started.'}</span></div><div className="rv-connection-minichart" aria-hidden="true">{[27, 44, 38, 59, 49, 77, 68, 97].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div><button type="button" className="rv-source-next" aria-label={sourceStep === 2 ? 'Get started with your data' : 'Next connection step'} onClick={() => sourceStep === 2 ? setAuthMode('signup') : setSourceStep(s => s + 1)}>↗</button></div></div><span className="rv-connection-caption">CONNECTION PREVIEW · SIGN IN TO CONNECT</span>
          </div>
        </section>
        <section className="rv-final" aria-labelledby="rv-final-title"><div className="rv-final-orbit" aria-hidden="true"><i /><i /><i /><span>↗</span></div><div className="rv-final-display" aria-hidden="true"><span><i /> LIVE ON EVERY SCREEN</span><div className="rv-final-value">4.2<em>M</em></div><div className="rv-final-bars">{[23, 41, 32, 58, 47, 79, 69, 100].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div><small>EVERY DEAL. EVERY REP.</small></div><div className="rv-final-copy"><span className="rv-overline">THE NEXT BIG PICTURE IS YOURS.</span><h2 id="rv-final-title">Put your data<br /><em>on the wall.</em></h2><button type="button" className="rv-button" onClick={() => setAuthMode('signup')}>Get started <Arrow /></button></div></section>
      </main>
      <footer className="rv-footer"><a className="rv-brand" href="#top"><Mark /><span>TestMu <b>BI</b></span></a><span>A shared view of what’s next.</span><span>© {new Date().getFullYear()} TestMu BI</span></footer>
      <dialog className="rv-auth-dialog" ref={authDialog} aria-label="Access your workspace" onClose={() => setAuthMode(null)} onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close(); }}><div className="rv-auth-inner"><div className="rv-auth-top"><span className="rv-brand"><Mark /><span>TestMu <b>BI</b></span></span><button type="button" className="rv-close" aria-label="Close sign in" onClick={() => authDialog.current.close()}>×</button></div><span className="rv-overline">YOUR NEXT CLEAR PICTURE STARTS HERE.</span>{authMode && <Login embedded initialMode={authMode} />}</div></dialog>
      <dialog className="rv-wall-dialog" ref={wallDialog} aria-label="Presentation preview" onClose={() => setWallOpen(false)}><div className="rv-wall-top"><span><i className="rv-live-dot" /> LIVE BOARD · SAMPLE DATA</span><button type="button" className="rv-close" aria-label="Exit presentation mode" onClick={() => wallDialog.current.close()}>×</button></div>{wallOpen && <RevenueBoard {...boardProps} wall intro={3} />}<div className="rv-wall-bottom"><span>TestMu BI</span><span>Every deal. Every rep. In the room.</span><span>ESC TO EXIT</span></div></dialog>
    </div>
  );
}

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { getExecutiveSnapshot, getDashboardState, saveDashboardState } from '../lib/api';
import {
  MultiSelect, ChartCard, Donut, MiniBar, NeonColumns, Th, useTableSort,
  fmtNumber, fmtPercent, fmtCurrency, baseOptions, valueLabels, seriesColor,
} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import RefreshDataButton from '../components/RefreshDataButton';
import AdvancedDateRange, { isoDate, rangeFor } from '../components/AdvancedDateRange';
import AppLoader from '../components/AppLoader';
import { useAuth } from '../hooks/useAuth';

// Chart.js paints on canvas, where CSS custom properties cannot reach, so the
// palette tokens are read off the root element at build time (theme-aware).
const token = name => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim());

// A port of the Tableau "Dashboard 11: Executive Dashboard". Every number is
// computed server-side (services/executiveMetrics.js) over the opportunity ×
// product-line rows; this page renders the snapshot and owns the five global
// controls plus POD.
export const TEMPLATE = 'executive-dashboard';

const SELECTORS = [
  ['product', 'Product'], ['productGroup', 'Product Group'], ['orgType', 'Org Type'],
  ['continentGroup', 'Continent Group'], ['salesPod', 'Sales POD'], ['owner', 'Rep'],
];
const SELECTOR_LABEL = Object.fromEntries(SELECTORS);

// Default scope is the WHOLE current quarter by close date — deals due to
// close later this quarter are the open pipeline.
const quarterFilters = () => {
  const [from, to] = rangeFor('wholeQuarter');
  return { closeFrom: isoDate(from), closeTo: isoDate(to), datePreset: 'wholeQuarter', dateCount: 4, dateUnit: 'quarter' };
};
export const emptyFilters = () => ({ ...quarterFilters(), segmentBy: 'product', segment: [], type: [], misRequired: [], pod: [] });

// Opportunity Type defaults to the new-business trio, matched by normalised
// name because the source spells "Up-Sell" inconsistently.
const normalizeType = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const DEFAULT_TYPE_SET = new Set(['newbusiness', 'newbusinessam', 'existingbusinessupsell']);
export const defaultTypes = options => (options || []).filter(value => DEFAULT_TYPE_SET.has(normalizeType(value)));

// POD defaults to the set the sales-ops owner ticked on 2026-09-05: every
// quota-carrying AE/AM POD, with BDR, Partnerships, Retention, SDR, Self
// Serve and the blank POD left out until someone ticks them. Matched against
// the source's own POD list so a name absent from the data never lingers as
// an invisible selection; a NEW POD name must be added here to show by default.
const DEFAULT_PODS = ['AE AMER I', 'AE AMER II', 'AE AMER III', 'AE APAC', 'AE EMEA', 'AM AMER', 'AM APAC', 'AM EMEA', 'AM Saahil',
  'AMER CORP', 'AMER I', 'AMER II', 'AMER III', 'APAC AE', 'EMEA AE', 'GCC', 'MD'];
const normalizePod = value => String(value).trim().toLowerCase();
export const defaultPods = options => {
  const wanted = new Set(DEFAULT_PODS.map(normalizePod));
  return (options || []).filter(value => wanted.has(normalizePod(value)));
};
// What each forecast group means, beside its name in the mix table.
const MIX_NOTES = { Commit: 'rep-committed', 'Best Case': 'includes High', 'No Projection': 'includes Low', 'No Forecast': 'no call recorded' };
const sameSet = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// A saved NAMED preset re-derives its dates on load; a custom range is kept
// as saved. Unknown saved keys are dropped so a stale shape cannot leak in.
function hydrateFilters(saved) {
  const base = emptyFilters();
  const next = { ...base };
  for (const key of Object.keys(base)) if (saved && saved[key] !== undefined) next[key] = saved[key];
  if (!SELECTOR_LABEL[next.segmentBy]) next.segmentBy = 'product';
  for (const key of ['segment', 'type', 'misRequired', 'pod']) if (!Array.isArray(next[key])) next[key] = [];
  if (next.datePreset && next.datePreset !== 'custom' && next.datePreset !== 'all') {
    const [from, to] = rangeFor(next.datePreset, next.dateCount, next.dateUnit);
    if (from || to) { next.closeFrom = isoDate(from); next.closeTo = isoDate(to); }
  }
  return next;
}
const toQuery = filters => ({
  closeFrom: filters.closeFrom, closeTo: filters.closeTo, segmentBy: filters.segmentBy,
  segment: filters.segment, type: filters.type, pod: filters.pod,
  misRequired: filters.misRequired.map(value => (value === 'Yes' ? 'true' : 'false')),
});

const shortDate = value => {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month) - 1]} ${year}`;
};
const fmtRatio = value => (value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1));
const fmtMultiple = value => (value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} X`);
const fmtShare = value => (value === null || value === undefined ? '—' : fmtPercent(value * 100));

// ===== Chart.js plumbing =====
function useChart(build, deps) {
  const ref = useRef(null);
  // Canvas colours are chosen at build time, so a theme flip must rebuild —
  // ThemeToggle broadcasts it; without this the light theme kept dark-theme
  // labels that were almost invisible on white.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const redraw = () => setThemeTick(tick => tick + 1);
    window.addEventListener('themechange', redraw);
    return () => window.removeEventListener('themechange', redraw);
  }, []);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = new Chart(ref.current, build());
    return () => chart.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, themeTick]);
  return ref;
}

// The board's own categorical palette — twelve saturated hues that stay
// vivid on both the dark and the light card (business ruling 2026-09-05:
// the muted shared palette read as dull here). Defined as CSS tokens in
// index.css so the canvas and the HTML charts draw from the same list.
const execColor = i => token(`--exec-${(i % 12) + 1}`) || seriesColor(i);

// Vertical columns for the full-width trials chart: the value on top of each
// column and the trial count beneath it (the shared plugin's second line).
function ColumnChart({ items, valueOf, format, secondary, height = 320, tooltip }) {
  const key = JSON.stringify(items);
  const ref = useChart(() => {
    const base = baseOptions();
    return {
      type: 'bar',
      data: {
        labels: items.map(item => item.label),
        datasets: [{
          data: items.map(valueOf), valueFormat: format, secondaryLabels: secondary ? items.map(secondary) : undefined,
          backgroundColor: items.map((_, i) => execColor(i)), borderRadius: 8, maxBarThickness: 64,
        }],
      },
      options: {
        ...base, responsive: true, maintainAspectRatio: false,
        plugins: { ...base.plugins, legend: { display: false },
          tooltip: { ...base.plugins.tooltip, callbacks: { label: context => (tooltip ? tooltip(items[context.dataIndex]) : format(context.raw)) } } },
        scales: { ...base.scales, x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, autoSkip: false, maxRotation: 30, minRotation: 0, color: token('--txt-2') } } },
      },
      plugins: [valueLabels],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!items.length) return <div className="empty">No active trials in this selection.</div>;
  return <div className="exec-chart" style={{ height }}>
    <canvas ref={ref} role="img" aria-label={`${items.length} columns`} />
    <ul className="exec-sr">{items.map(item => <li key={item.label}>{item.label}: {format(valueOf(item))}{secondary ? ` · ${secondary(item)}` : ''}</li>)}</ul>
  </div>;
}

// ===== Tooltips =====
// One styled bubble for every HTML chart on the board, in place of the
// browser's plain title tooltip: a heading, colour-keyed rows and a note,
// following the pointer and kept inside the viewport. Keyboard focus shows
// the same bubble under the element.
const TooltipContext = createContext(null);
function TooltipBubble({ x, y, content }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 16 });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 12));
    const top = y + 18 + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height - 12) : y + 18;
    setPos({ left, top });
  }, [x, y, content]);
  return <div ref={ref} className="exec-tip" role="tooltip" style={pos}>
    {content.title && <div className="exec-tip-title">{content.title}</div>}
    {content.rows?.map(row => <div className="exec-tip-row" key={row.label}>
      <i style={{ background: row.color || 'transparent', opacity: row.color ? 1 : 0 }} /><span>{row.label}</span><b>{row.value}</b>
    </div>)}
    {content.note && <div className="exec-tip-note">{content.note}</div>}
  </div>;
}
function TooltipLayer({ children }) {
  const [tip, setTip] = useState(null);
  const api = useMemo(() => ({
    show: (event, content) => setTip({ x: event.clientX, y: event.clientY, content }),
    move: event => setTip(current => (current ? { ...current, x: event.clientX, y: event.clientY } : current)),
    hide: () => setTip(null),
  }), []);
  return <TooltipContext.Provider value={api}>
    {children}
    {tip && createPortal(<TooltipBubble x={tip.x} y={tip.y} content={tip.content} />, document.body)}
  </TooltipContext.Provider>;
}
const tipProps = (tips, content) => (tips ? {
  onMouseEnter: event => tips.show(event, content), onMouseMove: tips.move, onMouseLeave: tips.hide,
  onFocus: event => { const box = event.currentTarget.getBoundingClientRect(); tips.show({ clientX: box.left + box.width / 2, clientY: box.bottom }, content); },
  onBlur: tips.hide, tabIndex: 0,
} : {});

// ===== Per-POD HTML charts =====
// Attainment as a ladder of progress tracks toward the 100% goal: the fill
// colour is the band (on track / behind / at risk), the amounts sit beside
// the percentage, and a POD with no quota stays visible but empty.
const attainmentBand = pct => (pct === null ? 'none' : pct >= 50 ? 'good' : pct >= 25 ? 'mid' : 'low');
const BAND_LABEL = { good: '≥ 50% of quota', mid: '25–50%', low: '< 25%' };
function AttainmentLadder({ items }) {
  const tips = useContext(TooltipContext);
  const pcts = items.map(entry => (entry.attainment === null ? null : entry.attainment * 100));
  const scaleMax = Math.max(100, ...pcts.filter(value => value !== null));
  if (!items.length) return <div className="empty">Nothing to show for this selection.</div>;
  return <div className="exec-ladder"><div className="exec-scroll">
    {items.map((entry, i) => {
      const pct = pcts[i];
      const band = attainmentBand(pct);
      const tip = pct === null
        ? { title: entry.label, note: 'No quota mapped for this POD' }
        : { title: entry.label, rows: [
          { label: 'Won ARR this quarter', value: fmtCurrency(entry.wonArr), color: token('--exec-2') },
          { label: 'Target ARR', value: fmtCurrency(entry.targetArr) },
          { label: 'Attainment', value: fmtPercent(pct) },
          { label: entry.targetArr - entry.wonArr >= 0 ? 'Still to close' : 'Ahead of quota', value: fmtCurrency(Math.abs(entry.targetArr - entry.wonArr)) },
        ] };
      return <div className={`exec-ladder-row${pct === null ? ' is-empty' : ''}`} key={entry.label} {...tipProps(tips, tip)}>
        <span className="exec-ladder-label">{entry.label}</span>
        <div className="exec-ladder-track" aria-hidden="true">
          <i className={`band-${band}`} style={{ width: `${clampPct((pct ?? 0) / scaleMax * 100)}%` }} />
          <em className="exec-ladder-goal" style={{ left: `${100 / scaleMax * 100}%` }} />
        </div>
        <b className="exec-ladder-pct">{pct === null ? '—' : fmtPercent(pct)}</b>
        <small>{pct === null ? 'no quota mapped' : `${fmtCurrency(entry.wonArr)} of ${fmtCurrency(entry.targetArr)}`}</small>
      </div>;
    })}</div>
    <div className="exec-legend">
      {['good', 'mid', 'low'].map(band => <span key={band}><i className={`band-${band}`} />{BAND_LABEL[band]}</span>)}
      <span><i className="goal" />100% of quota</span>
    </div>
  </div>;
}

// Open pipeline per POD as a composition bar: Commit, then Best Case, then
// the unforecast remainder, so a POD's size and its quality read together.
function PipelineComposition({ items, forecast, total }) {
  const tips = useContext(TooltipContext);
  if (!items.length) return <div className="empty">Nothing to show for this selection.</div>;
  const byPod = new Map(forecast.map(entry => [entry.label, entry]));
  const max = Math.max(...items.map(entry => entry.arr), 1);
  return <div className="exec-pipe"><div className="exec-scroll">
    {items.map(entry => {
      const split = byPod.get(entry.label) || { commit: 0, bestCase: 0 };
      const rest = Math.max(0, entry.arr - split.commit - split.bestCase);
      const seg = value => `${entry.arr ? value / entry.arr * 100 : 0}%`;
      const tip = { title: entry.label, rows: [
        { label: 'Commit', value: fmtCurrency(split.commit), color: token('--exec-3') },
        { label: 'Best Case (incl. High)', value: fmtCurrency(split.bestCase), color: token('--exec-1') },
        { label: 'No projection / no forecast', value: fmtCurrency(rest), color: token('--txt-3') },
        { label: 'Open pipeline', value: fmtCurrency(entry.arr) },
        { label: 'Open opportunities', value: fmtNumber(entry.opps) },
        { label: 'Share of the tile', value: total ? fmtPercent(entry.arr / total * 100) : '—' },
      ] };
      return <div className="exec-pipe-row" key={entry.label} {...tipProps(tips, tip)}>
        <span className="exec-ladder-label">{entry.label}</span>
        <div className="exec-pipe-track" aria-hidden="true">
          <div className="exec-pipe-bar" style={{ width: `${clampPct(entry.arr / max * 100)}%` }}>
            <i className="seg-commit" style={{ width: seg(split.commit) }} />
            <i className="seg-best" style={{ width: seg(split.bestCase) }} />
            <i className="seg-rest" style={{ width: seg(rest) }} />
          </div>
        </div>
        <b>{fmtCurrency(entry.arr)}</b>
        <small>{fmtNumber(entry.opps)} opps · {total ? fmtPercent(entry.arr / total * 100, 0) : '—'}</small>
      </div>;
    })}</div>
    <div className="exec-legend">
      <span><i className="seg-commit" />Commit</span><span><i className="seg-best" />Best Case (incl. High)</span><span><i className="seg-rest" />No projection / no forecast</span>
      <span>share = of the Open Pipeline tile</span>
    </div>
  </div>;
}

// Open pipe per product as a scrolling list: a bar against the largest
// product, the value, the open count and share, and the product's dominant
// group beneath its name. The list grows with the catalogue; the card does not.
const GROUP_SHORT = { 'Agentic cloud: Hyperexecute': 'Hyperexecute', 'Browser And App': 'Browser & App' };
function ProductPipeList({ items, total }) {
  const tips = useContext(TooltipContext);
  if (!items.length) return <div className="empty">Nothing to show for this selection.</div>;
  const max = Math.max(...items.map(entry => entry.arr), 1);
  return <div className="exec-pipe"><div className="exec-scroll">
    {items.map((entry, i) => {
      const tip = { title: entry.label, note: entry.group ? `Product group: ${entry.group}` : '', rows: [
        { label: 'Open product ARR', value: fmtCurrency(entry.arr), color: execColor(i) },
        { label: 'Open opportunities', value: fmtNumber(entry.opps) },
        { label: 'Average per opportunity', value: entry.opps ? fmtCurrency(entry.arr / entry.opps) : '—' },
        { label: 'Share of product-grain open pipe', value: total ? fmtPercent(entry.arr / total * 100) : '—' },
      ] };
      return <div className="exec-pipe-row exec-product-row" key={entry.label} {...tipProps(tips, tip)}>
        <span className="exec-product-name"><b>{entry.label}</b>{entry.group && <small>{GROUP_SHORT[entry.group] || entry.group}</small>}</span>
        <div className="exec-pipe-track" aria-hidden="true"><div className="exec-pipe-bar" style={{ width: `${clampPct(entry.arr / max * 100)}%`, background: execColor(i) }} /></div>
        <b>{fmtCurrency(entry.arr)}</b>
        <small>{fmtNumber(entry.opps)} opps · {total ? fmtPercent(entry.arr / total * 100, 0) : '—'}</small>
      </div>;
    })}
  </div>
  <div className="exec-legend"><span>{fmtNumber(items.length)} products · {fmtCurrency(total)} open product ARR</span><span>bar = size against the largest product · share = of the product-grain total</span></div>
  </div>;
}

// Forecast by POD as stacked Commit + Best Case bars in a scrolling list;
// the bar is scaled to the largest POD's forecast total.
function ForecastPodList({ items }) {
  const tips = useContext(TooltipContext);
  if (!items.length) return <div className="empty">Nothing to show for this selection.</div>;
  const max = Math.max(...items.map(entry => entry.total), 1);
  const commitSum = items.reduce((sum, entry) => sum + entry.commit, 0);
  const bestSum = items.reduce((sum, entry) => sum + entry.bestCase, 0);
  return <div className="exec-pipe"><div className="exec-scroll">
    {items.map(entry => {
      const tip = { title: entry.label, rows: [
        { label: 'Commit', value: fmtCurrency(entry.commit), color: token('--exec-3') },
        { label: 'Best Case (incl. High)', value: fmtCurrency(entry.bestCase), color: token('--exec-1') },
        { label: 'Forecast total', value: fmtCurrency(entry.total) },
        { label: 'Commit share of this POD', value: entry.total ? fmtPercent(entry.commit / entry.total * 100) : '—' },
        { label: 'Share of all Commit', value: commitSum ? fmtPercent(entry.commit / commitSum * 100) : '—' },
      ] };
      return <div className="exec-pipe-row exec-forecast-row" key={entry.label} {...tipProps(tips, tip)}>
        <span className="exec-ladder-label">{entry.label}</span>
        <div className="exec-pipe-track" aria-hidden="true"><div className="exec-pipe-bar" style={{ width: `${clampPct(entry.total / max * 100)}%` }}>
          <i className="seg-commit" style={{ width: `${entry.total ? entry.commit / entry.total * 100 : 0}%` }} />
          <i className="seg-best" style={{ width: `${entry.total ? entry.bestCase / entry.total * 100 : 0}%` }} />
        </div></div>
        <b>{fmtCurrency(entry.total)}</b>
        <small><i className="seg-commit" />{fmtCurrency(entry.commit)} <i className="seg-best" />{fmtCurrency(entry.bestCase)}</small>
      </div>;
    })}
  </div>
  <div className="exec-legend"><span><i className="seg-commit" />Commit {fmtCurrency(commitSum)}</span><span><i className="seg-best" />Best Case (incl. High) {fmtCurrency(bestSum)}</span><span>bar = size against the largest POD</span></div>
  </div>;
}

// Card headings: an uppercase eyebrow with a coloured mark, then the title.
const heading = (eyebrow, title, tone) => <><span className="exec-eyebrow" style={{ '--eyebrow': token(tone) }}>{eyebrow}</span>{title}</>;

// ===== Tiles =====
// Every tile carries one small visual that says how its number sits — a
// ring against the quota, a meter against the 1× line, the forecast mix, a
// share of the open book — so the strip reads as a picture, not a ledger.
const clampPct = value => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

function Ring({ pct, color, size = 60 }) {
  const stroke = 7, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const filled = clampPct(pct) / 100 * circ;
  return <div className="exec-ring" style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${filled} ${circ - filled}`} />
    </svg>
    <b>{fmtPercent(pct, 0)}</b>
  </div>;
}

// A meter with named marks: coverage reads against "1× quota" rather than
// against nothing.
function Meter({ value, max, marks = [], color }) {
  const top = Math.max(max, value || 0, 0.01);
  return <div className="exec-meter" style={{ '--meter-color': color }} aria-hidden="true">
    <i style={{ width: `${clampPct((value || 0) / top * 100)}%` }} />
    {marks.map(mark => <span key={mark.label} className="exec-meter-mark" style={{ left: `${clampPct(mark.at / top * 100)}%` }}><span>{mark.label}</span></span>)}
  </div>;
}

function ShareBar({ pct, color, caption }) {
  return <div className="exec-share">
    <div className="exec-share-track" style={{ '--share-color': color }} aria-hidden="true"><i style={{ width: `${clampPct(pct)}%` }} /></div>
    <div className="exec-share-caption">{caption}</div>
  </div>;
}

function MixStrip({ parts, legend = 3 }) {
  const tips = useContext(TooltipContext);
  const total = parts.reduce((sum, part) => sum + (part.value || 0), 0);
  if (!total) return null;
  return <div className="exec-mix-strip">
    <div className="pv-kpi-mix" aria-hidden="true">{parts.map(part => <i key={part.label} style={{ width: `${(part.value || 0) / total * 100}%`, background: part.color }} {...tipProps(tips, { title: part.label, rows: [{ label: 'ARR', value: fmtCurrency(part.value), color: part.color }, { label: 'Share', value: fmtPercent((part.value || 0) / total * 100) }] })} />)}</div>
    <div className="exec-mix-legend">{parts.slice(0, legend).map(part => <span key={part.label}><i style={{ background: part.color }} />{part.label} <b>{fmtPercent((part.value || 0) / total * 100, 0)}</b></span>)}</div>
  </div>;
}

function Tile({ tone, label, value, sub, note, pair, aside, visual }) {
  return (
    <div className={`kpi exec-tile acc-${tone}`}>
      <div className="exec-tile-head"><div className="lb">{label}</div>{note && <span className="exec-tile-note">{note}</span>}</div>
      <div className="exec-tile-body">
        {aside}
        <div className="exec-tile-main">
          <div className="vl">{value}</div>
          {pair && <div className="exec-pair">{pair}</div>}
          {sub && <div className="ft">{sub}</div>}
        </div>
      </div>
      {visual}
    </div>
  );
}

function TopN({ value, onChange, options = [25, 50, 100, 0], label }) {
  return <select className="exec-topn" value={value} onChange={event => onChange(Number(event.target.value))} aria-label={label}>
    {options.map(n => <option key={n} value={n}>{n === 0 ? 'All rows' : `Top ${n}`}</option>)}
  </select>;
}

// ===== Data =====
const STALE_MESSAGE = 'The API server is running an older build without the Executive Dashboard route. Restart the server (npm run dev) and reload this page.';
function useSnapshot(filters, ready, reloadTick) {
  const [state, setState] = useState({ loading: true, loaded: false, error: '', data: null });
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setState(current => ({ ...current, loading: true, error: '' }));
    getExecutiveSnapshot(toQuery(filters))
      .then(data => { if (!cancelled) setState({ loading: false, loaded: true, error: '', data }); })
      .catch(error => {
        if (cancelled) return;
        const message = error.response?.status === 404 ? STALE_MESSAGE : (error.response?.data?.error || error.message || 'Could not load the dashboard');
        setState(current => ({ ...current, loading: false, loaded: true, error: message }));
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, reloadTick]);
  return state;
}

function ExecutiveBoard({ user }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const tips = useContext(TooltipContext);
  const [filters, setFilters] = useState(emptyFilters);
  const [ready, setReady] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const savedRef = useRef(false);          // whether a saved state supplied the filters
  const defaultsApplied = useRef(false);
  const [dealsTop, setDealsTop] = useState(25);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [dealQuery, setDealQuery] = useState('');
  const dealsSort = useTableSort('wonDealArr', 'desc', 0);

  useEffect(() => {
    let cancelled = false;
    getDashboardState(TEMPLATE).then(remote => {
      if (cancelled) return;
      if (remote?.filters) { setFilters(hydrateFilters(remote.filters)); savedRef.current = true; }
    }).catch(() => {}).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const snapshot = useSnapshot(filters, ready, reloadTick);
  const data = snapshot.data;
  const options = data?.options || { type: [], pod: [], misRequired: [], segments: {} };

  // First-ever load: the Opportunity Type default needs the source's own
  // type list, which only the first answer can supply.
  useEffect(() => {
    if (!data || defaultsApplied.current) return;
    defaultsApplied.current = true;
    if (!savedRef.current) {
      const types = filters.type.length ? filters.type : defaultTypes(options.type);
      const pods = filters.pod.length ? filters.pod : defaultPods(options.pod);
      if (types.length || pods.length) setFilters(current => ({ ...current, type: types, pod: pods }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Persist after the first answer, debounced: the board must never be a
  // fresh-start every morning.
  useEffect(() => {
    if (!ready || !snapshot.loaded) return undefined;
    const handle = setTimeout(() => { saveDashboardState(TEMPLATE, { filters }).catch(() => {}); }, 500);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), ready, snapshot.loaded]);

  const setSegmentBy = value => setFilters(current => ({ ...current, segmentBy: value, segment: [] }));
  const reset = () => setFilters({ ...emptyFilters(), type: defaultTypes(options.type), pod: defaultPods(options.pod) });

  // The same six controls serve the header shelf and the floating panel, so
  // the two can never drift apart; `where` keeps the select ids unique.
  const filterControls = where => <>
    <AdvancedDateRange filters={filters} setFilters={setFilters} fromKey="closeFrom" toKey="closeTo" label="Opp close date" title="Opp Close Date" emptyLabel="All close dates" />
    <div className="fg"><label htmlFor={`exec-segment-by-${where}`}>Segment selector</label>
      <select id={`exec-segment-by-${where}`} value={filters.segmentBy} onChange={event => setSegmentBy(event.target.value)}>
        {SELECTORS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></div>
    <MultiSelect label="Segment" options={options.segments[filters.segmentBy] || []} value={filters.segment} onChange={value => setFilters(current => ({ ...current, segment: value }))} />
    <MultiSelect label="Opp type" options={options.type} value={filters.type} onChange={value => setFilters(current => ({ ...current, type: value }))} />
    <MultiSelect label="MIS required" options={options.misRequired} value={filters.misRequired} onChange={value => setFilters(current => ({ ...current, misRequired: value }))} />
    <MultiSelect label="POD" options={options.pod} value={filters.pod} onChange={value => setFilters(current => ({ ...current, pod: value }))} />
  </>;
  // Badge: how many controls narrow the data. A multi-select ticked to every
  // option is deliberate but narrows nothing, so it earns a dot, not a number;
  // the type filter's default trio counts as "not touched".
  const multiFilters = [['segment', options.segments[filters.segmentBy] || []], ['type', options.type], ['misRequired', options.misRequired], ['pod', options.pod]];
  const typeIsDefault = sameSet(filters.type, defaultTypes(options.type));
  const podIsDefault = sameSet(filters.pod, defaultPods(options.pod));
  const activeFilterCount = multiFilters.reduce((total, [key, list]) => {
    const selected = filters[key] || [];
    if ((key === 'type' && typeIsDefault) || (key === 'pod' && podIsDefault)) return total;
    return total + (selected.length > 0 && selected.length !== list.length ? 1 : 0);
  }, 0) + (filters.datePreset !== 'wholeQuarter' ? 1 : 0) + (filters.segmentBy !== 'product' ? 1 : 0);
  const hasAnyTouchedFilter = activeFilterCount > 0 || multiFilters.some(([key]) => key !== 'type' && !(key === 'pod' && podIsDefault) && (filters[key] || []).length > 0);

  const metrics = data?.metrics;
  const deals = useMemo(() => {
    if (!metrics) return [];
    const needle = dealQuery.trim().toLowerCase();
    const matching = needle
      ? metrics.closedWonDeals.filter(deal => [deal.account, deal.name, deal.owner].some(text => String(text || '').toLowerCase().includes(needle)))
      : metrics.closedWonDeals;
    return dealsSort.apply(matching);
  }, [metrics, dealsSort.sort, dealQuery]);
  const visibleDeals = dealsTop ? deals.slice(0, dealsTop) : deals;

  if (!snapshot.loaded) return <AppLoader fullscreen label="Loading Executive Dashboard…" />;

  const quarter = metrics?.quarter || { label: '' };
  const k = metrics?.kpis || {};
  const hasSource = (data?.sourceRowCount || 0) > 0;
  const isEmpty = !snapshot.error && (data?.rowCount || 0) === 0;
  const typeLine = filters.type.length ? filters.type.join(', ') : 'All opportunity types';
  const maxMix = Math.max(...(metrics?.forecastMix || []).map(entry => entry.arr), 1);
  const wonMax = Math.max(...deals.map(deal => deal.wonDealArr || 0), 1);
  const dealsTotal = deals.reduce((sum, deal) => sum + (deal.wonDealArr || 0), 0);
  const maxMixOpps = Math.max(...(metrics?.forecastMix || []).map(entry => entry.opps), 1);
  const visibleTotal = visibleDeals.reduce((sum, deal) => sum + (deal.wonDealArr || 0), 0);
  // One colour per POD, shared by the deals table and the per-POD charts.
  const podIndex = new Map((metrics?.attainmentByPod || []).map((entry, i) => [entry.label, i]));
  const podColorOf = label => execColor(podIndex.get(label) ?? 11);
  const commitShare = k.openPipelineArr ? (k.commitArr || 0) / k.openPipelineArr * 100 : 0;
  const trialShare = metrics?.counts.openOpportunities ? (k.trialOpps || 0) / metrics.counts.openOpportunities * 100 : 0;
  const trialArrShare = k.openPipelineArr ? (k.trialArr || 0) / k.openPipelineArr * 100 : 0;
  // Quota by POD, largest first, the tail folded into one segment.
  const quotaByPod = (() => {
    const holders = (metrics?.attainmentByPod || []).filter(entry => entry.targetArr > 0).sort((a, b) => b.targetArr - a.targetArr);
    const head = holders.slice(0, 5).map((entry, i) => ({ label: entry.label, value: entry.targetArr, color: execColor(i) }));
    const rest = holders.slice(5).reduce((sum, entry) => sum + entry.targetArr, 0);
    return rest > 0 ? [...head, { label: 'Other PODs', value: rest, color: token('--txt-3') }] : head;
  })();
  const activeNote = metrics && (!metrics.trialFilters.oppActive || !metrics.trialFilters.ownerActive)
    ? `Source has no ${!metrics.trialFilters.oppActive ? 'opportunity Active' : 'User Active'} flag mapped — that filter is not applied.` : null;

  return <div className="wrap win-board-wrap exec-wrap"><div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
    <div className="brand" onClick={() => navigate('/gallery')} style={{ cursor: 'pointer' }}><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" /><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle /><DashboardSwitcher /><RefreshDataButton templateId={TEMPLATE} onRefreshed={() => setReloadTick(tick => tick + 1)} /><span>{user?.name || 'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>

    <header className="top pv-top"><div className="top-row"><div className="pv-title-block"><h1>Executive Dashboard</h1>
      <div className="sub">Quota attainment, pipeline coverage, forecast and trials — one row per opportunity × product line, opportunity values read once per deal.</div>
      <div className="exec-note" role="note">Opp Type: {typeLine} · KPI tiles are fixed to {quarter.label || 'the current quarter'}, whatever the close-date range says</div>
      <div className="pv-scope">
        <span className="pv-scope-key">Opp Close Date</span>
        <strong>{filters.closeFrom || filters.closeTo ? `${shortDate(filters.closeFrom) || 'Start'} – ${shortDate(filters.closeTo) || 'Today'}` : 'All dates'}</strong>
        <span>segment by <strong>{SELECTOR_LABEL[filters.segmentBy]}</strong></span>
        {metrics && <span><strong>{fmtNumber(metrics.counts.opportunities)}</strong> opportunities · <strong>{fmtNumber(metrics.counts.users)}</strong> quota holders in scope</span>}
      </div></div></div>
      <div className="filters win-board-filter-shelf">
        {filterControls('shelf')}
        <button className="btn-secondary filter-reset-button" onClick={reset}>Reset</button>
      </div>
      {snapshot.loading && <div className="pv-progress" role="progressbar" aria-label="Updating Executive Dashboard" />}
    </header>

    {snapshot.error && <div className="error">{snapshot.error}</div>}
    {!snapshot.error && !hasSource
      ? <div className="card win-board-empty"><div className="win-board-empty-icon">▦</div>
        <div><h3>No Executive Dashboard data is loaded</h3><p>Connect the Opp + Product source (one row per opportunity × product line, with Amount, both subscription durations, Total Price, Product Name, POD, User ID and the current-quarter quota) and map it to this dashboard.</p></div>
        <button type="button" className="btn-primary" onClick={() => navigate('/data-sources')}>Open data sources</button></div>
      : metrics && <div className={`pv-board${snapshot.loading ? ' is-updating' : ''}`} aria-busy={snapshot.loading}>
      {isEmpty && <div className="empty">Nothing matches these filters and this close-date range — the source is loaded, the current selection is just empty.</div>}

      <div className="kpis exec-kpis-5">
        <Tile tone="teal" label="Quota vs Achievement" note={`These values are only for ${quarter.label}`} value={fmtShare(k.quotaAttainment)}
          pair={`${fmtCurrency(k.currentQuarterWonArr)} / ${fmtCurrency(k.targetArr)}`} sub="Current-quarter Won ARR ÷ Target ARR"
          aside={<Ring pct={(k.quotaAttainment || 0) * 100} color={execColor(1)} />} />
        <Tile tone="amber" label="Forecast (Commit)" value={fmtCurrency(k.commitArr)} sub={`open Commit deals closing in ${quarter.label}`}
          visual={<ShareBar pct={commitShare} color={execColor(2)} caption={`${fmtPercent(commitShare, 0)} of the open pipeline is Commit`} />} />
        <Tile tone="blue" label="Open Pipeline" value={fmtCurrency(k.openPipelineArr)} sub={`${fmtNumber(metrics.counts.openOpportunities)} open opportunities · ARR`}
          visual={<MixStrip parts={metrics.forecastMix.map((entry, i) => ({ label: entry.label, value: entry.arr, color: execColor(i) }))} legend={4} />} />
        <Tile tone="blue" label="Coverage" note="Pipe / Quota" value={fmtRatio(k.pipelineCoverage)} sub="Open Pipeline ÷ Target ARR"
          visual={<Meter value={k.pipelineCoverage || 0} max={3} marks={[{ at: 1, label: '1× quota' }, { at: 3, label: '3×' }]} color={execColor(0)} />} />
        <Tile tone="violet" label="Active Trials #" note="Stages · Trial" value={fmtNumber(k.trialOpps)} sub="distinct opportunities in Trial"
          visual={<ShareBar pct={trialShare} color={execColor(4)} caption={`${fmtPercent(trialShare, 0)} of open opportunities`} />} />
      </div>
      <div className="kpis exec-kpis-4">
        <Tile tone="violet" label="ARR in Trials $" note="Stages · Trial" value={fmtCurrency(k.trialArr)} sub="ARR of opportunities in Trial"
          visual={<ShareBar pct={trialArrShare} color={execColor(4)} caption={`${fmtPercent(trialArrShare, 0)} of the open pipeline`} />} />
        <Tile tone="violet" label="Trial Coverage" note="Stages · Trial" value={fmtMultiple(k.trialCoverage)} sub="ARR in Trials ÷ Target ARR"
          visual={<Meter value={k.trialCoverage || 0} max={1} marks={[{ at: 1, label: '1× quota' }]} color={execColor(10)} />} />
        <Tile tone="green" label={`${quarter.label} Quota`} value={fmtCurrency(k.targetArr)} sub={`${fmtNumber(metrics.counts.users)} quota holders with deals in scope`}
          visual={<MixStrip parts={quotaByPod} legend={3} />} />
        <Tile tone={k.gapToQuota > 0 ? 'red' : 'green'} label="Gap to Quota" value={`${k.gapToQuota < 0 ? '−' : ''}${fmtCurrency(Math.abs(k.gapToQuota || 0))}`}
          sub={k.gapToQuota < 0 ? 'ahead of quota · Target ARR − current-quarter Won ARR' : 'still to close · Target ARR − current-quarter Won ARR'}
          visual={<ShareBar pct={(k.quotaAttainment || 0) * 100} color={execColor(1)} caption={k.gapToQuota < 0 ? 'quota reached' : `${fmtPercent((k.quotaAttainment || 0) * 100, 0)} of quota closed so far`} />} />
      </div>

      {/* Cards are paired by height, and each pair uses a different chart
          form so the board reads as nine objects rather than nine bar lists. */}
      <div className="pv-section"><span>Product groups</span></div>
      <div className="pv-grid">
        <ChartCard title={heading('Won this quarter', 'Won ARR by product group', '--exec-2')} hint="Product-line ARR of deals won in scope. Under this quarter’s dates it adds up to the current-quarter Won ARR tile.">
          <div className="exec-donut"><Donut data={metrics.wonByProductGroup.map((entry, i) => ({ label: entry.label, value: entry.wonProductArr, color: execColor(i) }))} centerLabel="Won product ARR" format={fmtCurrency} size={210} /></div>
          <div className="exec-legend-note">{metrics.wonByProductGroup.map(entry => <span key={entry.label}>{entry.label}: <b>{fmtNumber(entry.opps)} opps</b></span>)}</div>
        </ChartCard>
        <ChartCard title={heading('Open pipeline', 'Open pipe by product group', '--exec-1')} hint={`Product-line ARR of open deals. Runs ${fmtCurrency(Math.abs(metrics.openPipeGap))} ${metrics.openPipeGap >= 0 ? 'above' : 'below'} the Open Pipeline tile — the source’s own line-versus-amount gap, shown rather than hidden.`}>
          <NeonColumns data={metrics.openPipeByProductGroup.map((entry, i) => ({ label: entry.label, value: entry.arr, meta: `${fmtNumber(entry.opps)} opps`, color: execColor(i) }))} format={fmtCurrency} sortable={false} />
        </ChartCard>
      </div>

      <div className="pv-section"><span>By POD</span></div>
      <div className="pv-grid">
        <ChartCard title={heading('By POD', 'Quota attainment', '--exec-5')} hint="Current-quarter Won ARR against Target ARR. Green from 50%, amber from 25%, red below; the dashed line is 100%.">
          <AttainmentLadder items={metrics.attainmentByPod} />
        </ChartCard>
        <ChartCard title={heading('By POD', 'Open pipeline and forecast quality', '--exec-5')} hint="Open ARR per POD, read once per deal, split into Commit, Best Case and unforecast. Adds up to the Open Pipeline tile.">
          <PipelineComposition items={metrics.openPipelineByPod} forecast={metrics.forecastByPod} total={k.openPipelineArr} />
        </ChartCard>
      </div>

      <div className="pv-section"><span>Forecast &amp; products</span></div>
      <div className="pv-grid">
        <ChartCard title={heading('By POD', 'Commit and Best Case', '--exec-3')} hint="Open deal ARR called Commit or Best Case (Best Case includes High). Under this quarter’s dates, Commit adds up to the Forecast (Commit) tile.">
          <ForecastPodList items={metrics.forecastByPod} />
        </ChartCard>
        <ChartCard title={heading('Products', 'Open pipe by product', '--exec-6')} hint="Product-line ARR of open deals, largest first. Unlisted SKUs count as Others; the list scrolls.">
          <ProductPipeList items={metrics.openPipeByProduct} total={metrics.openPipeProductGrain} />
        </ChartCard>
      </div>

      <div className="pv-grid">
        <ChartCard className="pv-card-full" title={heading('By POD', 'Active trials', '--exec-11')} hint={`Deals in the Trial stage: ARR per POD with the deal count beneath. Active deals of active reps only.${activeNote ? ` ${activeNote}` : ''}`}>
          <ColumnChart items={metrics.trialsByPod} valueOf={entry => entry.trialArr} format={fmtCurrency}
            secondary={entry => `${fmtNumber(entry.trialOpps)} ${entry.trialOpps === 1 ? 'trial' : 'trials'}`}
            tooltip={entry => `${fmtNumber(entry.trialOpps)} in Trial · ${fmtCurrency(entry.trialArr)} ARR`} />
        </ChartCard>
      </div>

      <div className="pv-section"><span>Forecast mix &amp; deals</span></div>
      <div className="pv-stack">
        <ChartCard title={heading('Open pipeline', 'Forecast mix', '--exec-3')} hint="Open deals and ARR by forecast group. Blank forecasts show as No Forecast; the groups add up to the Open Pipeline tile.">
          <div className="exec-mix">
            <table className="exec-table exec-mix-table">
              <colgroup><col style={{ width: '30%' }} /><col style={{ width: '13%' }} /><col style={{ width: '16%' }} /><col style={{ width: '17%' }} /><col style={{ width: '24%' }} /></colgroup>
              <thead><tr><th>Forecast group</th><th className="n">Opps</th><th className="n">Avg deal ARR</th><th className="n">Pipeline ARR</th><th>Share of open pipeline</th></tr></thead>
              <tbody>{metrics.forecastMix.map((entry, i) => {
                const share = k.openPipelineArr ? entry.arr / k.openPipelineArr * 100 : 0;
                return <tr key={entry.label} className={entry.label === 'Commit' ? 'exec-mix-commit' : ''} {...tipProps(tips, { title: entry.label, note: MIX_NOTES[entry.label] || '', rows: [{ label: 'Open opportunities', value: fmtNumber(entry.opps), color: execColor(i) }, { label: 'Average deal ARR', value: entry.opps ? fmtCurrency(entry.arr / entry.opps) : '—' }, { label: 'Pipeline ARR', value: fmtCurrency(entry.arr) }, { label: 'Share of open pipeline', value: fmtPercent(share) }] })}>
                  <td><span className="exec-mix-group"><i style={{ background: execColor(i) }} /><b>{entry.label}</b><small>{MIX_NOTES[entry.label] || ''}</small></span></td>
                  <td className="n"><div className="exec-mix-count"><span>{fmtNumber(entry.opps)}</span><i style={{ width: `${clampPct(entry.opps / maxMixOpps * 100)}%`, background: execColor(i) }} /></div></td>
                  <td className="n">{entry.opps ? fmtCurrency(entry.arr / entry.opps) : '—'}</td>
                  <td className="n"><b>{fmtCurrency(entry.arr)}</b></td>
                  <td><div className="exec-mix-share"><span className="exec-deal-track" aria-hidden="true"><i style={{ width: `${clampPct(share)}%`, background: execColor(i) }} /></span><b>{fmtPercent(share)}</b></div></td>
                </tr>;
              })}</tbody>
              <tfoot><tr>
                <td>Open pipeline</td>
                <td className="n">{fmtNumber(metrics.counts.openOpportunities)}</td>
                <td className="n">{metrics.counts.openOpportunities ? fmtCurrency(k.openPipelineArr / metrics.counts.openOpportunities) : '—'}</td>
                <td className="n"><b>{fmtCurrency(k.openPipelineArr)}</b></td>
                <td>100% · ties to the Open Pipeline tile</td>
              </tr></tfoot>
            </table>
            <div className="exec-donut"><Donut data={metrics.forecastMix.map((entry, i) => ({ label: entry.label, value: entry.arr, color: execColor(i) }))} centerLabel="Open pipeline" format={fmtCurrency} size={210} /></div>
          </div>
        </ChartCard>
        <ChartCard title={heading('Won this quarter', 'Closed-won deals', '--exec-2')} hint="One row per won deal, ranked by the sorted column. Won Deal ARR is read once per deal, never summed across product lines."
          controls={<div className="exec-table-tools">
            <input className="exec-search" type="search" placeholder="Search account, opp or rep" value={dealQuery} onChange={event => setDealQuery(event.target.value)} aria-label="Search closed-won deals" />
            <TopN value={dealsTop} onChange={setDealsTop} label="Rows to show" />
          </div>}>
          <div className="exec-table-scroll"><table className="exec-table exec-deals">
            <colgroup><col className="exec-col-rank" /><col className="exec-col-deal" /><col className="exec-col-rep" /><col className="exec-col-arr" /><col className="exec-col-pod" /><col className="exec-col-date" /></colgroup>
            <thead><tr>
              <th className="n">#</th>
              <Th label="Account · opportunity" sortKey="account" sort={dealsSort.sort} onSort={dealsSort.onSort} />
              <Th label="Rep" sortKey="owner" sort={dealsSort.sort} onSort={dealsSort.onSort} />
              <Th label="Won Deal ARR" sortKey="wonDealArr" numeric sort={dealsSort.sort} onSort={dealsSort.onSort} />
              <Th label="POD" sortKey="pod" sort={dealsSort.sort} onSort={dealsSort.onSort} />
              <Th label="Close date" sortKey="closeDate" sort={dealsSort.sort} onSort={dealsSort.onSort} />
            </tr></thead>
            <tbody>{visibleDeals.map((deal, i) => <tr key={deal.id} className={i < 3 && dealsSort.sort.key === 'wonDealArr' && dealsSort.sort.dir === 'desc' ? 'exec-podium' : ''} {...tipProps(tips, { title: deal.account || deal.name || deal.id, rows: [{ label: 'Opportunity', value: deal.name || deal.id }, { label: 'Rep', value: deal.owner }, { label: 'Won Deal ARR', value: fmtCurrency(deal.wonDealArr), color: podColorOf(deal.pod) }, { label: 'Share of won ARR in scope', value: dealsTotal ? fmtPercent((deal.wonDealArr || 0) / dealsTotal * 100) : '—' }, { label: 'POD', value: deal.pod }, { label: 'Closed', value: shortDate(deal.closeDate) || '—' }] })}>
              <td className="n exec-rank">{i + 1}</td>
              <td><div className="exec-deal-account">{deal.account || '—'}</div><div className="exec-deal-name" title={deal.name || deal.id}>{deal.name || deal.id}</div></td>
              <td>{deal.owner}</td>
              <td className="n"><div className="exec-deal-arr">
                <span className="exec-deal-track" aria-hidden="true"><i style={{ width: `${clampPct((deal.wonDealArr || 0) / wonMax * 100)}%`, background: podColorOf(deal.pod) }} /></span>
                <b>{fmtCurrency(deal.wonDealArr)}</b>
                <small>{dealsTotal ? fmtPercent((deal.wonDealArr || 0) / dealsTotal * 100) : '—'}</small>
              </div></td>
              <td><span className="exec-pod-pill" style={{ '--pill': podColorOf(deal.pod) }}>{deal.pod}</span></td>
              <td>{shortDate(deal.closeDate) || '—'}</td></tr>)}
            {!visibleDeals.length && <tr><td colSpan={6} className="empty">{dealQuery ? 'No closed-won opportunity matches that search.' : 'No closed-won opportunities in this selection.'}</td></tr>}</tbody>
            <tfoot><tr>
              <td /><td>Shown rows</td><td />
              <td className="n"><b>{fmtCurrency(visibleTotal)}</b></td>
              <td colSpan={2}>{fmtNumber(visibleDeals.length)} of {fmtNumber(deals.length)} deals · {fmtCurrency(dealsTotal)} won in scope</td>
            </tr></tfoot>
          </table></div>
        </ChartCard>
      </div>
      <div className="page-foot">Formulas follow the Tableau workbook: opportunity values are read once per Opportunity ID (MIN over surviving lines), quota once per User ID over the users present in the filtered rows, product values summed per line. Details in calculated.md.</div>
    </div>}

    {/* The same filters, reachable from anywhere on a long board — the Win
        Board's floating control, wired to this board's state. */}
    <button type="button" className="floating-filter-button" aria-label="Open Executive Dashboard filters" title="Executive Dashboard filters" aria-expanded={filterPanelOpen} onClick={() => setFilterPanelOpen(open => !open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></svg>
      {activeFilterCount > 0
        ? <span className="floating-filter-badge">{activeFilterCount}</span>
        : hasAnyTouchedFilter && <span className="floating-filter-badge floating-filter-badge-dot" aria-label="Filters set to All" />}
    </button>
    {filterPanelOpen && <aside className="floating-filter-panel" aria-label="Executive Dashboard filters">
      <div className="floating-filter-head"><div><b>Executive Dashboard filters</b><span>{metrics ? `${fmtNumber(metrics.counts.opportunities)} opportunities in scope` : 'Loading…'}</span></div>
        <button type="button" aria-label="Close filters" onClick={() => setFilterPanelOpen(false)}>×</button></div>
      <div className="floating-filter-controls">{filterControls('panel')}</div>
      <button className="floating-filter-reset" type="button" onClick={reset}>Reset all filters</button>
    </aside>}
  </div>;
}

export default function ExecutiveDashboard(props) {
  return <TooltipLayer><ExecutiveBoard {...props} /></TooltipLayer>;
}

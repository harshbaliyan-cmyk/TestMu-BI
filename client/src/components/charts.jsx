// client/src/components/charts.jsx
// Shared visual language for the dashboard.
//
// The stage funnel reads well because it is HTML, not Chart.js: no axes to
// crowd, labels sit inside the bars, nothing clips. BarList generalises that
// pattern. Chart.js is kept only where a real plot is needed — two measures on
// different scales, or a time axis.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared persisted display-size values. Dashboard and presentation state both
// validate against the same allow-list so an older/invalid saved value cannot
// leak into chart rendering.
export const SIZE_MODES = ['automatic', 'fixed', 'range'];

/* ============================================================
   Formatting
   ============================================================ */

export const fmtCurrency = (n) => {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

// A genuinely-partial value can round away to a misleading "100%" or "0%"
// at low decimal precision — e.g. 99.995% (one real loss, just ARR-trivial)
// displaying as "100.0%" reads as "nothing was lost" when something was.
// Clamp to the nearest value that still displays as short of the boundary,
// rather than let rounding claim a boundary that wasn't actually reached.
export const fmtPercent = (n, d = 1) => {
  if (n == null || isNaN(n)) return '—';
  const step = 1 / 10 ** d;
  if (n > 0 && n < 100) {
    if (parseFloat(n.toFixed(d)) >= 100) return `${(100 - step).toFixed(d)}%`;
    if (parseFloat(n.toFixed(d)) <= 0) return `${step.toFixed(d)}%`;
  }
  return `${n.toFixed(d)}%`;
};

export const fmtNumber = (n) =>
  n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString();

export const fmtDays = (n) =>
  n == null || isNaN(n) ? '—' : `${Math.round(n)} d`;

// Categorical series colours.
//
// Seven slots, not eight: an eighth hue could not clear colour-vision
// separation against its neighbours, and seven everyone can read beats eight
// some people cannot. Further series fold into "Other".
//
// Both rows are machine-checked (OKLab dE, CVD simulation, contrast), not
// picked by eye. The previous palette failed that check: under deuteranopia
// its pink and blue collapsed to dE 0.3 - literally the same colour. The
// worst adjacent pair is now dE 14.6 (light) and 9.1 (dark), target 8.
//
// Dark is SELECTED, not flipped: the same hues re-stepped into the dark
// surface's lightness band, so a series keeps its identity across themes.
const CHART_PALETTE_LIGHT = ['#0066CC', '#B8860B', '#6D28D9', '#C2410C', '#0E8CA8', '#9D174D', '#5B8C0A'];
const CHART_PALETTE_DARK  = ['#1183FD', '#B37A00', '#944DFF', '#E44A03', '#0096B7', '#DF4379', '#609A00'];

const isLightTheme = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';

// A live getter, not a constant: the theme can change without a remount.
export const chartPalette = () => (isLightTheme() ? CHART_PALETTE_LIGHT : CHART_PALETTE_DARK);
export const seriesColor = i => { const p = chartPalette(); return p[i % p.length]; };
export const CHART_PALETTE = CHART_PALETTE_LIGHT; // kept for existing imports

// Reserved for real state only - never reused as "series 4".
export const STATUS_COLORS = { good: '#00875A', warn: '#B45309', bad: '#CC0033', info: '#0066CC' };


const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** '2026-03' → 'Mar-26' */
export function monthLabel(period) {
  const [y, m] = period.split('-');
  return `${MONTHS[+m - 1]}-${y.slice(2)}`;
}

/** '2026-03' → 'Q1-26' */
export function quarterLabel(period) {
  const [y, m] = period.split('-');
  return `Q${Math.floor((+m - 1) / 3) + 1}-${y.slice(2)}`;
}

/** Continuous list of YYYY-MM between two keys, inclusive. */
function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const quarterKey = (mk) => {
  const [y, m] = mk.split('-');
  return `${y}-${String(Math.floor((+m - 1) / 3) * 3 + 1).padStart(2, '0')}`;
};

/**
 * Build a continuous time axis from month keys.
 *
 * Granularity is chosen automatically — months while they stay readable,
 * quarters beyond that — unless `force` overrides it. The range is filled in
 * so quiet periods appear as gaps rather than disappearing, which would make
 * the spacing misrepresent time.
 */
export function timeAxis(monthKeys, { force = null, maxMonths = 12 } = {}) {
  const months = [...new Set(monthKeys.filter(Boolean))].sort();
  if (!months.length) {
    return { periods: [], label: monthLabel, granularity: 'month',
             matches: () => false, available: ['month', 'quarter'] };
  }

  const span = monthRange(months[0], months[months.length - 1]);
  const granularity = force || (span.length <= maxMonths ? 'month' : 'quarter');

  if (granularity === 'month') {
    return { periods: span, label: monthLabel, granularity: 'month',
             matches: (k, p) => k === p, available: ['month', 'quarter'] };
  }

  return {
    periods: [...new Set(span.map(quarterKey))],
    label: quarterLabel,
    granularity: 'quarter',
    matches: (k, p) => Boolean(k) && quarterKey(k) === p,
    available: ['month', 'quarter'],
  };
}

/** Drop leading and trailing periods with no data on either side. */
export function trimEmpty(periods, hasData) {
  let a = 0, b = periods.length - 1;
  while (a <= b && !hasData(periods[a])) a++;
  while (b >= a && !hasData(periods[b])) b--;
  return periods.slice(a, b + 1);
}

/* ============================================================
   Chart.js: draw values on the marks instead of reading an axis
   ============================================================ */

export const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const light = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
    // Scaled off the canvas's own rendered height instead of a flat 12px —
    // a presentation card's chart might be ~150px or ~500px+ tall depending
    // on screen size, and Canvas 2D text is invisible to CSS entirely (no
    // clamp()/vh/cqh reaches it), so a hardcoded px size here is exactly
    // what kept reading as "tiny" on a big screen no matter how much the
    // surrounding HTML scaled. The floor is set just above the original
    // 12px, not below it — a presentation chart is routinely *shorter*
    // than the 260-310px this was tuned against (it shares the screen with
    // four other charts), so a pure ratio without a protective floor would
    // compute *smaller* than the original there and make the regression
    // worse, not fix it. This only grows once a chart actually has more
    // room than that reference height gave it. Every pixel offset below is
    // the original 12px-tuned value scaled by the same ratio (k), so the
    // label's padding and its gap from the point stay proportional at any
    // size, not just the font.
    const baseSize = Math.round(Math.max(13, Math.min(24, chart.height * .05)));
    const k = baseSize / 12;
    const secondarySize = Math.max(11, Math.round(baseSize * .875));
    chart.data.datasets.forEach((ds, di) => {
      if (ds.hideValues) return;
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      const fmt = ds.valueFormat || ((v) => fmtNumber(v));

      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (v == null || (v === 0 && !ds.showZeroValues)) return;
        const text = fmt(v);
        const secondary = ds.secondaryData?.[i];
        const secondaryText = ds.secondaryLabels?.[i]
          ?? (secondary == null ? '' : (ds.secondaryFormat ? ds.secondaryFormat(secondary) : String(secondary)));
        ctx.save();
        ctx.font = `700 ${baseSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Labels are centred on their point, so half the text sits to the left
        // of it. On the FIRST point — which Chart.js places hard against the
        // left edge of the canvas — that half is drawn off-canvas and silently
        // clipped, turning "54.5%" into "4.5%": a plausible-looking number that
        // is wrong by an order of magnitude, with nothing to show it was cut.
        // The last point loses its tail the same way. Clamping the draw
        // position keeps the whole string on canvas; the label shifts by a few
        // pixels at the extremes rather than losing a digit.
        const halfWidth = ctx.measureText(text).width / 2;
        const labelX = Math.min(Math.max(el.x, halfWidth + 2), chart.width - halfWidth - 2);

        if (meta.type === 'line' || ds.type === 'line') {
          const below = ds.valueLabelPosition === 'below';
          const w = ctx.measureText(text).width + 6;
          const boxHeight = 13 * k;
          const boxTop = below ? el.y + 4 * k : el.y - 17 * k;
          const textY = below ? el.y + 6 * k : el.y - 5 * k;
          ctx.textBaseline = below ? 'top' : 'bottom';
          if (ds.valueLabelBackground !== false) {
            ctx.fillStyle = light ? 'rgba(255,255,255,.94)' : 'rgba(11,20,36,.92)';
            ctx.fillRect(labelX - w / 2, boxTop, w, boxHeight);
          }
          ctx.fillStyle = ds.borderColor || (light ? '#3867D6' : '#4F7DF3');
          ctx.fillText(text, labelX, textY);
        } else {
          ctx.fillStyle = light ? '#334155' : '#D9E2EF';
          ctx.fillText(text, labelX, el.y - (secondaryText ? 13 * k : 3 * k));
          if (secondaryText) {
            ctx.font = `700 ${secondarySize}px ui-sans-serif, system-ui, sans-serif`;
            const secondaryNumber = Number(ds.secondaryToneData?.[i] ?? secondary);
            ctx.fillStyle = Number.isFinite(secondaryNumber)
              ? secondaryNumber > .005 ? (light ? '#087F5B' : '#21D69B')
                : secondaryNumber < -.005 ? (light ? '#C92A4A' : '#FF5D7D')
                  : (light ? '#64748B' : '#94A3B8')
              : (light ? '#168F9B' : '#70CED6');
            // Re-measured: the secondary line is a different string at a
            // smaller size, so it needs its own clamp, not the primary's.
            const secondaryHalf = ctx.measureText(secondaryText).width / 2;
            ctx.fillText(secondaryText, Math.min(Math.max(el.x, secondaryHalf + 2), chart.width - secondaryHalf - 2), el.y - 2 * k);
          }
        }
        ctx.restore();
      });
    });
  },
};

// Chart.js re-evaluates a function value for style options like this on
// every layout pass (including a resize), so text tracks the canvas's own
// rendered size instead of a flat px guess frozen at chart-creation time —
// same fix as valueLabels above, for Chart.js's own tick/legend text.
function scaledFont(ratio, min, max, weight = '600') {
  return (ctx) => ({ size: Math.round(Math.max(min, Math.min(max, ctx.chart.height * ratio))), weight });
}

/**
 * Baseline options. Grids and tick labels are dialled right back — the values
 * are drawn on the marks, so the axis is scaffolding rather than content.
 */
export function baseOptions({ percentRight = false, stacked = false } = {}) {
  const light = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
  return {
    layout: { padding: { top: 22, right: 8, left: 4, bottom: 0 } },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true,
                  pointStyle: 'circle', font: scaledFont(.045, 12, 18), padding: 16,
                  color: light ? '#56657A' : '#B7C2D3' },
      },
      tooltip: {
        backgroundColor: light ? 'rgba(255,255,255,.97)' : 'rgba(15,23,42,.94)',
        titleColor: light ? '#0F172A' : '#fff', bodyColor: light ? '#334155' : '#fff',
        borderColor: light ? '#D7DFE9' : '#2A3A55', borderWidth: 1,
        padding: 12, cornerRadius: 9,
        titleFont: { size: 13, weight: '700' }, bodyFont: { size: 12.5, weight: '600' }, displayColors: true,
      },
    },
    scales: {
      x: {
        stacked,
        grid: { display: false },
        border: { color: light ? '#D7DFE9' : '#2A3A55' },
        ticks: { font: scaledFont(.05, 13, 20), color: light ? '#657489' : '#B5C0D0', maxRotation: 0, autoSkip: true },
      },
      y: {
        stacked,
        display: false,          // values are on the bars
        beginAtZero: true,
        grace: '12%',            // headroom so labels never clip
      },
      ...(percentRight ? {
        y1: {
          position: 'right', display: false,
          beginAtZero: true, grace: '25%',   // never hardcode a max — that is what pushed lines outside the plot
        },
      } : {}),
    },
  };
}

/* ============================================================
   Card wrapper with optional controls
   ============================================================ */

const ComparisonContext = createContext(null);

export function ComparisonProvider({ value, children }) {
  return <ComparisonContext.Provider value={value}>{children}</ComparisonContext.Provider>;
}

export function ComparisonBadge({ comparison: suppliedComparison, metric = 'both' }) {
  const inheritedComparison = useContext(ComparisonContext);
  const comparison = suppliedComparison ?? inheritedComparison;
  if (!comparison?.available) return null;

  const change = comparison.arrChangePct == null ? null : Number(comparison.arrChangePct);
  const points = comparison.arrWinRatePointChange == null ? null : Number(comparison.arrWinRatePointChange);

  if (metric === 'closedArr') {
    const growth = comparison.closedArrGrowthPct == null ? null : Number(comparison.closedArrGrowthPct);
    if (!Number.isFinite(growth)) return null;
    const direction = growth > 0.005 ? 'up' : growth < -0.005 ? 'down' : 'flat';
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
    const word = direction === 'up' ? 'increase' : direction === 'down' ? 'dip' : 'no change';
    const { period, current, previous } = comparison;
    const title = [
      `Current Closed ARR: ${fmtCurrency(current?.closedArr)}`,
      `Previous Closed ARR: ${fmtCurrency(previous?.closedArr)} (${period?.previousFrom} to ${period?.previousTo})`,
      `Difference: ${growth > 0 ? '+' : ''}${growth.toFixed(1)} percent`,
    ].join('\n');
    return <span className={`comparison-badge comparison-${direction}`} title={title}
      aria-label={`Closed ARR ${word} of ${Math.abs(growth).toFixed(1)} percent versus the previous period`}>
      <b>{arrow} {Math.abs(growth).toFixed(1)}%</b>
      <small>Closed ARR {word}</small>
    </span>;
  }

  if (metric === 'dealWinRate') {
    const dealPoints = comparison.dealWinRatePointChange == null ? null : Number(comparison.dealWinRatePointChange);
    if (!Number.isFinite(dealPoints)) return null;
    const direction = dealPoints > 0.005 ? 'up' : dealPoints < -0.005 ? 'down' : 'flat';
    const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
    const word = direction === 'up' ? 'increase' : direction === 'down' ? 'dip' : 'no change';
    const { period, current, previous } = comparison;
    const title = [
      `Current deal win rate: ${fmtPercent(current?.dealWinRate)}`,
      `Previous deal win rate: ${fmtPercent(previous?.dealWinRate)} (${period?.previousFrom} to ${period?.previousTo})`,
      `Difference: ${dealPoints > 0 ? '+' : ''}${dealPoints.toFixed(1)} percentage points`,
    ].join('\n');
    return <span className={`comparison-badge comparison-rate-only comparison-${direction}`} title={title}
      aria-label={`Deal win rate ${word} of ${Math.abs(dealPoints).toFixed(1)} percentage points versus the previous period`}>
      <b>{arrow} {Math.abs(dealPoints).toFixed(1)} pp</b>
      <small>Deal win-rate {word}</small>
    </span>;
  }

  if (!Number.isFinite(change) && !Number.isFinite(points)) return null;

  if (metric === 'arrWinRate') {
    if (!Number.isFinite(points)) return null;
    const rateDirection = points > 0.005 ? 'up' : points < -0.005 ? 'down' : 'flat';
    const rateArrow = rateDirection === 'up' ? '↑' : rateDirection === 'down' ? '↓' : '→';
    const rateWord = rateDirection === 'up' ? 'increase' : rateDirection === 'down' ? 'dip' : 'no change';
    const { period, current, previous } = comparison;
    const rateTitle = [
      `Current ARR win rate: ${fmtPercent(current?.arrWinRate)}`,
      `Previous ARR win rate: ${fmtPercent(previous?.arrWinRate)} (${period?.previousFrom} to ${period?.previousTo})`,
      `Difference: ${points > 0 ? '+' : ''}${points.toFixed(1)} percentage points`,
    ].join('\n');
    return <span className={`comparison-badge comparison-rate-only comparison-${rateDirection}`} title={rateTitle}
      aria-label={`ARR win rate ${rateWord} of ${Math.abs(points).toFixed(1)} percentage points versus the previous period`}>
      <b>{rateArrow} {Math.abs(points).toFixed(1)} pp</b>
      <small>ARR win-rate {rateWord}</small>
    </span>;
  }

  const directionValue = Number.isFinite(change) ? change : points;
  const direction = directionValue > 0.005 ? 'up' : directionValue < -0.005 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  const pointSign = Number.isFinite(points) && points > 0 ? '+' : '';
  const { period, current, previous } = comparison;
  const title = [
    `ARR: ${fmtCurrency(current?.arr)} vs ${fmtCurrency(previous?.arr)} (${period?.previousFrom} to ${period?.previousTo})`,
    `ARR win rate: ${fmtPercent(current?.arrWinRate)} vs ${fmtPercent(previous?.arrWinRate)}`,
    `ARR win-rate change: ${Number.isFinite(points) ? `${pointSign}${points.toFixed(1)} percentage points` : 'not available'}`,
  ].join('\n');

  return <span className={`comparison-badge comparison-${direction}`} title={title}
    aria-label={`ARR change ${Number.isFinite(change) ? `${change.toFixed(1)} percent` : 'not available'}; ARR win-rate change ${Number.isFinite(points) ? `${pointSign}${points.toFixed(1)} percentage points` : 'not available'}`}>
    <b>{arrow} ARR {Number.isFinite(change) ? `${Math.abs(change).toFixed(1)}%` : 'N/A'}</b>
    <small>Win rate {Number.isFinite(points) ? `${pointSign}${points.toFixed(1)} pp` : 'N/A'}</small>
  </span>;
}

export function ChartCard({ title, hint, controls, children, style, className, showComparison = true, comparisonMetric = 'both' }) {
  return (
    <div className={className ? `card ${className}` : 'card'} style={style}>
      <div className="card-head">
        <div>
          <div className="chart-title-row"><h3>{title}</h3>{showComparison && <ComparisonBadge metric={comparisonMetric}/>}</div>
          {hint && <div className="hint">{hint}</div>}
        </div>
        {controls && <div className="card-controls">{controls}</div>}
      </div>
      {children}
    </div>
  );
}
  /**
 * Horizontal scroll for charts with many categories.
 *
 * Chart.js compresses to fit its container, so 35 quarters in a 700px card
 * produces overlapping labels. Giving the canvas a minimum width proportional
 * to the category count and letting the parent scroll keeps each bar legible.
 */
// fill=true hands sizing over to CSS entirely (a presentation-scoped rule
// gives .chart-scroll-fill a definite height) instead of the usual fixed
// pixel height prop, so the chart can size to whatever a fluid grid cell
// resolves to rather than a number picked once in JS. The per-point
// minWidth is dropped in this mode too — it was still being applied
// regardless of fill, which defeated the point: a presentation card that's
// narrower than count*perItem (a real windowed browser is routinely
// narrower than a Playwright-set viewport of the "same" resolution) hit
// this minimum and silently started horizontally scrolling instead of
// letting Chart.js compress to fit, cutting the trend off mid-year with a
// scrollbar nobody driving a TV can use.
export function ChartScroll({ count, perItem = 52, height = 300, fill = false, children }) {
  return (
    <div className={fill ? 'chart-scroll chart-scroll-fill' : 'chart-scroll'}>
      <div className="chart-scroll-inner"
        style={fill ? {} : { minWidth: count > 0 ? Math.max(count * perItem, 100) : '100%', height }}>
        {children}
      </div>
    </div>
  );
}
/* ============================================================
   MultiSelect — searchable, multi-value filter control
   ============================================================ */

export function MultiSelect({ label, options, value = [], onChange, allLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const allRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const edge = 12;
      const menuWidth = Math.min(320, window.innerWidth - edge * 2);
      const below = window.innerHeight - r.bottom - edge;
      const above = r.top - edge;
      const opensAbove = below < 250 && above > below;
      setRect({
        width: menuWidth,
        left: Math.max(edge, Math.min(r.left, window.innerWidth - menuWidth - edge)),
        ...(opensAbove
          ? { bottom: Math.max(edge, window.innerHeight - r.top + 6) }
          : { top: Math.max(edge, r.bottom + 6) }),
        maxHeight: Math.max(150, Math.min(360, (opensAbove ? above : below) - 6)),
      });
    };
    measure();
    requestAnimationFrame(() => inputRef.current?.focus());
    const onDown = e => {
      if (!wrapRef.current?.contains(e.target) && !menuRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = value.length > 0 && value.length < options.length;
    }
  }, [options.length, value.length]);

  const toggle = (o) => onChange(
    value.includes(o) ? value.filter(v => v !== o) : [...value, o]
  );

  // Every option explicitly selected reads the same as none selected — both
  // mean "no filter is narrowing this down" — so both show the same label
  // instead of a raw count that's often the full, unhelpfully large option list.
  const isEverythingSelected = options.length > 0 && value.length === options.length;
  const summary = value.length === 0 || isEverythingSelected ? (allLabel || '(All)')
    : value.length === 1 ? value[0]
    : `${value.length} selected`;

  return (
    <div className="fg ms-field" ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" onClick={() => { setOpen(o => !o); setQuery(''); }}
        className={`ms-trigger${value.length ? ' on' : ''}`} aria-haspopup="listbox" aria-expanded={open}>
        <span className="ms-field-label">{label}</span>
        <span className="ms-summary">{summary}</span>
        <span className="ms-caret">▼</span>
      </button>

      {open && rect && createPortal(
        <div ref={menuRef} className="ms-menu" role="listbox" aria-multiselectable="true" style={rect}>
          <input ref={inputRef} className="ms-search" value={query}
            placeholder={`Search ${options.length} ${label.toLowerCase()}…`}
            onChange={e => setQuery(e.target.value)} />

          <div className="ms-list">
            {!query && options.length > 0 && (
              <label className="ms-option ms-all-option">
                <input ref={allRef} type="checkbox"
                  checked={options.length > 0 && value.length === options.length}
                  onChange={() => onChange(value.length === options.length ? [] : [...options])} />
                <span>(All)</span>
              </label>
            )}
            {filtered.map(o => (
              <label key={o} className="ms-option" role="option" aria-selected={value.includes(o)}>
                <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} />
                <span>{o}</span>
              </label>
            ))}
            {!filtered.length && <div className="ms-empty">{options.length
              ? `Nothing matches “${query}”.`
              : `No ${label.toLowerCase()} values are mapped in this data source.`}</div>}
          </div>
        </div>, document.body
      )}
    </div>
  );
}


/* ============================================================
   BarList — the funnel pattern, generalised
   ============================================================ */

export function BarList({
  data,
  format = fmtCurrency,
  metaFormat,
  defaultTop = null,
  sortable = true,
  ascendingFirst = false,
  color = 'var(--teal)',
  emptyText = 'Nothing to show for this selection.',
}) {
  const [dir, setDir] = useState(ascendingFirst ? 'asc' : 'desc');
  const [top, setTop] = useState(defaultTop);

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      dir === 'desc' ? b.value - a.value : a.value - b.value);
    return top ? sorted.slice(0, top) : sorted;
  }, [data, dir, top]);

  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1);

  if (!data.length) return <div className="empty">{emptyText}</div>;

  return (
    <>
      {(sortable || defaultTop !== null) && (
        <div className="barlist-controls">
          {defaultTop !== null && (
            <select value={top ?? 'all'}
              onChange={e => setTop(e.target.value === 'all' ? null : +e.target.value)}>
              <option value="3">Top 3</option>
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="all">All {data.length}</option>
            </select>
          )}
          {sortable && (
            <button type="button" onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')}
              title={dir === 'desc' ? 'Sorted high to low' : 'Sorted low to high'}>
              {dir === 'desc' ? '↓ High first' : '↑ Low first'}
            </button>
          )}
        </div>
      )}

      <div className="barlist">
        {rows.map((r) => {
          const pct = (Math.abs(r.value) / max) * 100;
          const inside = pct > 26;
          return (
            <div className="barlist-row interactive-mark" key={r.label} tabIndex={0}
              title={`${r.label}: ${format(r.value)}${r.meta !== undefined ? ` · ${metaFormat ? metaFormat(r.meta) : r.meta}` : ''}`}>
              <div className="barlist-label" title={r.label}>{r.label}</div>
              <div className="barlist-track">
                <div className="barlist-fill"
                  style={{ width: `${Math.max(pct, 1.5)}%`, background: r.color || color }}>
                  {inside && <span className="barlist-val in">{format(r.value)}</span>}
                </div>
                {!inside && <span className="barlist-val out">{format(r.value)}</span>}
              </div>
              {r.meta !== undefined && (
                <div className="barlist-meta">
                  {metaFormat ? metaFormat(r.meta) : r.meta}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Heatmap — CSS grid, colour bands, count under each value
   ============================================================ */

const WIN_BANDS = [
  { max: 25,       bg: '#C81E1E', label: '<25%' },
  { max: 35,       bg: '#EA580C', label: '25–35%' },
  { max: 45,       bg: '#D9A407', label: '35–45%' },
  { max: 55,       bg: '#65A30D', label: '45–55%' },
  { max: Infinity, bg: '#15803D', label: '>55%' },
];

export function Heatmap({ rows, cols, cell, bands = WIN_BANDS, format = (v) => `${Math.round(v)}%` }) {
  if (!rows.length || !cols.length) {
    return <div className="empty">Nothing to show for this selection.</div>;
  }

  return (
    <div className="heatmap">
      <div className="heatmap-grid"
        style={{ gridTemplateColumns: `minmax(90px, 0.8fr) repeat(${cols.length}, 1fr)` }}>
        <div />
        {cols.map(c => <div className="heatmap-colhead" key={c}>{c}</div>)}

        {rows.map(r => (
          <Row key={r} r={r} cols={cols} cell={cell} bands={bands} format={format} />
        ))}
      </div>

      <div className="heatmap-legend">
        {bands.map(b => (
          <span key={b.label}>
            <i style={{ background: b.bg }} />{b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ r, cols, cell, bands, format }) {
  return (
    <>
      <div className="heatmap-rowhead">{r}</div>
      {cols.map(c => {
        const d = cell(r, c) || {};
        const empty = !d.count;
        const band = bands.find(b => (d.value ?? 0) < b.max) || bands[bands.length - 1];
        return (
          <div className="heatmap-cell interactive-mark" key={c} tabIndex={0}
            title={empty ? `${r} · ${c}: no deals` : `${r} · ${c}: ${format(d.value)} · ${d.count} deals`}
            style={{ background: empty ? 'var(--line-2)' : band.bg }}>
            {empty ? (
              <span className="heatmap-empty">no deals</span>
            ) : (
              <>
                <span className="heatmap-val">{format(d.value)}</span>
                <span className="heatmap-count">{d.count} deals</span>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ============================================================
   Donut — SVG, so the centre can carry the total
   ============================================================ */

export function Donut({ data, centerLabel = 'Total', format = fmtNumber, size = 190 }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  if (!total) return <div className="empty">Nothing to show for this selection.</div>;

  const r = size / 2 - 16;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <div className="donut-svg" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="var(--chart-track, #1B2A4A)" strokeWidth={26} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {data.map(d => {
              const frac = (d.value || 0) / total;
              const dash = frac * circ;
              const el = (
                <circle key={d.label}
                  cx={size / 2} cy={size / 2} r={r}
                  fill="none" stroke={d.color} strokeWidth={26}
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                ><title>{`${d.label}: ${format(d.value)} (${((d.value / total) * 100).toFixed(1)}%)`}</title></circle>
              );
              offset += dash;
              return el;
            })}
          </g>
        </svg>
        <div className="donut-center">
          <div className="donut-total">{format(total)}</div>
          <div className="donut-total-label">{centerLabel}</div>
        </div>
      </div>

      <div className="donut-legend">
        {data.filter(d => d.value > 0).map(d => (
          <div className="donut-legend-row" key={d.label}>
            <i style={{ background: d.color }} />
            <span className="donut-legend-label">{d.label}</span>
            <span className="donut-legend-val">{format(d.value)}</span>
            <span className="donut-legend-pct">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Table helpers
   ============================================================ */

/** Proportional bar rendered inside a table cell. */
export function MiniBar({ value, max, color = 'var(--teal)', label }) {
  const pct = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="minibar">
      <div className="minibar-track">
        <div className="minibar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      {label !== undefined && <span className="minibar-label">{label}</span>}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** Win-rate tone thresholds, used by pills and table cells alike. */
export const rateTone = (v) => v >= 50 ? 'good' : v >= 35 ? 'warn' : 'bad';

/** Sortable table header. `sort` is {key, dir}; `onSort` receives a key. */
export function Th({ label, sortKey, sort, onSort, numeric }) {
  const active = sort?.key === sortKey;
  return (
    <th className={numeric ? 'n' : ''}
      onClick={sortKey ? () => onSort(sortKey) : undefined}
      style={sortKey ? { cursor: 'pointer', userSelect: 'none' } : undefined}>
      {label}
      {sortKey && <span className={`sort-arrow${active ? ' on' : ''}`}>
        {active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
      </span>}
    </th>
  );
}

/** Shared sort state for tables. */
export function useTableSort(defaultKey, defaultDir = 'desc', defaultTop = 10) {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  const [top, setTop] = useState(defaultTop);
  const onSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' });
  const apply = (rows) => {
    const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (typeof av === 'string') {
      return sort.dir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    }
    return sort.dir === 'desc' ? (bv ?? 0) - (av ?? 0) : (av ?? 0) - (bv ?? 0);
    });
    return top ? sorted.slice(0, top) : sorted;
  };
  return { sort, setSort, onSort, apply, top, setTop };
}

/* ============================================================
   Modern dark-dashboard visualisations
   ============================================================ */

export function MetricGauges({ data, format = fmtPercent }) {
  return (
    <div className="metric-gauges">
      {data.map((d, i) => {
        const value = Math.max(0, Math.min(100, d.value || 0));
        const color = d.color || seriesColor(i);
        return (
          <div className="metric-gauge interactive-mark" key={d.label} tabIndex={0}
            title={`${d.label}: ${format(d.value)}${d.meta ? ` · ${d.meta}` : ''}`}>
            <div className="metric-gauge-ring" style={{
              '--gauge-value': `${value * 3.6}deg`, '--gauge-color': color,
            }}><div><b>{format(d.value)}</b><span>{d.label}</span></div></div>
            {d.meta && <small>{d.meta}</small>}
          </div>
        );
      })}
    </div>
  );
}

export function ConcentricRings({ data, format = fmtCurrency }) {
  const max = Math.max(...data.map(d => d.value || 0), 1);
  return (
    <div className="concentric-wrap">
      <div className="concentric-rings">
        {data.map((d, i) => {
          // Ring diameter scales with the item's own value against the
          // group's max, not its array position — a fixed per-index step
          // (176, 142, 108...) rendered two rings identically sized whenever
          // their values happened to land at the same index, and produced
          // negative (invalid) sizes past a 5-item list.
          const size = 74 + 102 * Math.max(0, Math.min(1, (d.value || 0) / max));
          const pct = Math.max(2, ((d.value || 0) / max) * 100);
          return <div key={d.label} className="concentric-ring interactive-mark" tabIndex={0}
            title={`${d.label}: ${format(d.value)}${d.meta ? ` · ${d.meta}` : ''}`} style={{
            width: size, height: size, '--ring-value': `${pct * 3.6}deg`, '--ring-color': d.color,
          }} />;
        })}
        <div className="concentric-center"><b>{fmtNumber(data.reduce((s, d) => s + (d.count || 0), 0))}</b><span>open deals</span></div>
      </div>
      <div className="concentric-legend">
        {data.map(d => <div key={d.label} className="interactive-mark" tabIndex={0}
          title={`${d.label}: ${format(d.value)}${d.meta ? ` · ${d.meta}` : ''}`}><i style={{ background: d.color }} /><span>{d.label}</span><b>{format(d.value)}</b><small>{d.meta}</small></div>)}
      </div>
    </div>
  );
}

export function NeonColumns({ data, format = fmtCurrency, sortable = true }) {
  const [dir, setDir] = useState('desc');
  const rows = useMemo(() => sortable ? [...data].sort((a, b) => dir === 'desc' ? b.value - a.value : a.value - b.value) : data, [data, dir, sortable]);
  const max = Math.max(...rows.map(d => d.value || 0), 1);
  return (
    <><div className="barlist-controls chart-sort-controls">{sortable && <button type="button" onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')}>{dir === 'desc' ? '↓ High first' : '↑ Low first'}</button>}</div>
    <div className="neon-columns">
      {rows.map((d, i) => {
        const color = d.color || seriesColor(i);
        return <div className="neon-column-item interactive-mark" key={d.label} tabIndex={0}
          title={`${d.label}: ${format(d.value)}${d.meta ? ` · ${d.meta}` : ''}`}>
          <b>{format(d.value)}</b>
          <div className="neon-column-track"><div style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, '--column-color': color }} /></div>
          <span>{d.label}</span>{d.meta && <small>{d.meta}</small>}
        </div>;
      })}
    </div></>
  );
}

export function LollipopList({ data, format = fmtDays, sortable = true }) {
  const [dir, setDir] = useState('desc');
  const rows = useMemo(() => sortable ? [...data].sort((a, b) => dir === 'desc' ? b.value - a.value : a.value - b.value) : data, [data, dir, sortable]);
  const max = Math.max(...rows.map(d => d.value || 0), 1);
  return <><div className="barlist-controls chart-sort-controls">{sortable && <button type="button" onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')}>{dir === 'desc' ? '↓ High first' : '↑ Low first'}</button>}</div><div className="lollipop-list">{rows.map((d, i) => {
    const pct = Math.max(2, (d.value / max) * 100);
    const color = d.color || seriesColor(i);
    return <div className="lollipop-row interactive-mark" key={d.label} tabIndex={0}
      title={`${d.label}: ${format(d.value)}${d.meta ? ` · ${d.meta}` : ''}`}>
      <span>{d.label}</span><div className="lollipop-track"><i style={{ width: `${pct}%`, '--dot-color': color }} /></div>
      <b>{format(d.value)}</b>{d.meta && <small>{d.meta}</small>}
    </div>;
  })}</div></>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import Chart from 'chart.js/auto';
import {
  getOpportunitySnapshot, getOptions, getDashboardState, saveDashboardState,
  listSavedViews, createSavedView, createSavedReport,
} from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import RefreshDataButton from '../components/RefreshDataButton';
import AppLoader from '../components/AppLoader';
import {
  MultiSelect, ChartCard, Th, Pill, BarList, Heatmap, Donut, MiniBar, MetricGauges,
  ConcentricRings, NeonColumns, LollipopList, useTableSort,
  fmtCurrency, fmtPercent, fmtNumber, fmtDays, valueLabels, baseOptions, rateTone, seriesColor,
} from '../components/charts';

// Opportunity Analytics: five views over ONE server-computed snapshot
// (services/opportunityMetrics.js). The browser never sees rows any more —
// it renders metrics, so every figure here is testable on the server and
// the payload is a few hundred KB instead of the 55k-row feed it used to be.
//
// Money rule: every $ on this board is ARR. Amount is never read.

const TABS = [
  { key: 'pulse', label: 'Pulse' },
  { key: 'diagnostics', label: 'Diagnostics' },
  { key: 'velocity', label: 'Velocity & Aging' },
  { key: 'wherewewin', label: 'Where We Win' },
  { key: 'repperformance', label: 'Rep Performance' },
];
// A saved view may name a tab that no longer exists (Accounts & Whitespace
// was removed 2026-09-04); fall back rather than render nothing.
const knownTab = view => (TABS.some(t => t.key === view) ? view : 'pulse');

const wrapAxisLabel = (value, maxLength = 18) => {
  const words = String(value || '').replace(/\//g, '/ ').split(/\s+/).filter(Boolean);
  const lines = [];
  words.forEach(word => {
    const current = lines[lines.length - 1];
    if (!current || `${current} ${word}`.length > maxLength) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  });
  return lines;
};

function TableTopControl({ table, count }) {
  return <select className="table-top-select" value={table.top ?? 'all'} onChange={e => table.setTop(e.target.value === 'all' ? null : +e.target.value)} aria-label="Rows to show">
    <option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="all">All {count}</option>
  </select>;
}

const FILTER_DEFS = [
  { key: 'continentGroup', label: 'Continent' }, { key: 'orgType', label: 'Org type' }, { key: 'stage', label: 'Stage' },
  { key: 'owner', label: 'Owner' }, { key: 'pod', label: 'POD' },
  { key: 'source', label: 'Source' }, { key: 'type', label: 'Opportunity type' }, { key: 'industry', label: 'Industry' },
];
const EMPTY_FILTERS = {
  continentGroup: [], orgType: [], stage: [], owner: [], pod: [], source: [], type: [], industry: [],
  createdFrom: '', createdTo: '', closeFrom: '', closeTo: '', createdPreset: '', closePreset: '',
};
// The board opens on THIS YEAR by Opp Created Date (business ruling,
// 2026-09-04): the source spans 2019 onward, and an all-time default turned
// every rate into a seven-year average.
const defaultFilters = () => {
  const [from, to] = presetRange('ytd');
  return { ...EMPTY_FILTERS, createdFrom: from, createdTo: to, createdPreset: 'ytd' };
};
// A saved NAMED preset re-derives its boundaries on load — "Year to date"
// saved in August must mean today's year-to-date, not a range frozen at the
// moment it was saved. Explicit dates are the user's exact choice and stay.
const refreshPresets = filters => {
  const next = { ...filters };
  for (const [presetKey, fromKey, toKey] of [['createdPreset', 'createdFrom', 'createdTo'], ['closePreset', 'closeFrom', 'closeTo']]) {
    if (!next[presetKey]) continue;
    const [from, to] = presetRange(next[presetKey]);
    if (from && to) { next[fromKey] = from; next[toKey] = to; }
  }
  return next;
};
// Only keys the board still knows survive a saved state: a `region`
// selection saved before the switch to Continent Group would otherwise ride
// along in every request as a filter nothing applies.
const hydrateFilters = saved => refreshPresets({ ...defaultFilters(),
  ...Object.fromEntries(Object.entries(saved || {}).filter(([key]) => key in EMPTY_FILTERS)) });

const savedDashboardState = templateId => {
  try {
    const dashboardSaved = localStorage.getItem(`testmu-dashboard-state-${templateId}`);
    const saved = JSON.parse(dashboardSaved || localStorage.getItem('testmu-presentation-config') || '{}');
    if (saved.templateId && String(saved.templateId) !== String(templateId)) return {};
    return saved;
  } catch {
    return {};
  }
};

const STAGE_COLORS = {
  'No Contact':'#94A3B8','Qualification':'#64748B','Demo':'#3B82F6',
  'Pre-Trial':'#60A5FA','Trial':'#818CF8','Work In Progress':'#A78BFA',
  'Post Trial Discussion':'#8B5CF6','Proposal':'#F59E0B',
  'Negotiation':'#10B981','Procurement':'#059669',
  'Confirmed':'#047857','Risk':'#DC2626','Closed Won':'#10B981','Closed Lost':'#EF4444',
};
const stageColor = stage => STAGE_COLORS[stage] || '#64748B';
const HEALTH_COLORS = { Green: '#15803D', Amber: '#D9A407', Red: '#C81E1E', 'Not rated': '#898781' };
// Axis-length family names; the tooltip title keeps the full family.
const FAMILY_SHORT = { 'Disengaged / no decision': 'Disengaged', 'Priority or budget': 'Priority / budget', 'Product fit': 'Product fit',
  'Competition or price': 'Competition / price', 'Not a real deal': 'Not a real deal', 'Other / not recorded': 'Other' };
const healthTone = v => ({ red: 'bad', amber: 'warn', green: 'good' })[String(v).toLowerCase()] || 'neutral';
const fmtCompact = n => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
const fmtDaysOrDash = value => (value === null || value === undefined ? '—' : fmtDays(value));
const growth = (current, previous) => (Number(previous) ? (current - previous) / previous * 100 : null);

// Highlight text carries **bold** markers from the server; render them as
// emphasis without ever treating the string as HTML.
const emphasise = text => String(text || '').split('**').map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part));
function Highlights({ items }) {
  if (!items?.length) return null;
  return <div className="pv-highlights" aria-label="Highlights">
    {items.map(item => <div key={item.tag} className={`pv-highlight${item.tone ? ` ${item.tone}` : ''}`}>
      <span className="pv-highlight-tag">{item.tag}</span><div>{emphasise(item.text)}</div>
    </div>)}
  </div>;
}

const EMPTY_SNAPSHOT = { rowCount: 0, metrics: null, comparison: { available: false }, highlights: {}, publicHighlights: {} };

export default function Dashboard({ user }) {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [snapshot, setSnapshot] = useState({ loading: true, loaded: false, error: '', ...EMPTY_SNAPSHOT });
  const [tab, setTab] = useState(() => knownTab(savedDashboardState(templateId).view));
  const [filters, setFilters] = useState(() => hydrateFilters(savedDashboardState(templateId).filters));
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [presentMenuOpen, setPresentMenuOpen] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);
  const [grain, setGrain] = useState(null);   // null = automatic
  const [savedViews, setSavedViews] = useState([]);
  const [stateHydrated, setStateHydrated] = useState(false);
  const persistedStateRef = useRef({});
  const tableStateRestored = useRef(false);

  const bookingsRef = useRef(null);
  const pipelineRef = useRef(null);
  const lossParetoRef = useRef(null);
  const cycleWonLostRef = useRef(null);
  const cycleWinRateRef = useRef(null);
  const repQuadrantRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    tableStateRestored.current = false;
    const local = savedDashboardState(templateId);
    getDashboardState(templateId).then(async remote => {
      if (cancelled) return;
      const initial = remote || local;
      if (initial?.filters) setFilters(hydrateFilters(initial.filters));
      if (initial?.view) setTab(knownTab(initial.view));
      persistedStateRef.current = initial || {};
      setStateHydrated(true);
      if (!remote && Object.keys(local).length) {
        await saveDashboardState(templateId, {
          view: local.view || 'pulse', filters: local.filters || {},
          tableTops: local.tableTops || {}, tableSorting: local.tableSorting || {},
          presentationSettings: local.presentationSettings || {},
        }).catch(() => {});
      }
    }).catch(() => {
      if (!cancelled) { persistedStateRef.current = local; setStateHydrated(true); }
    });
    return () => { cancelled = true; };
  }, [templateId]);

  useEffect(()=>{ listSavedViews(templateId).then(setSavedViews).catch(()=>{}); },[templateId]);

  // Bumped by the header's Refresh-data button after a source re-pull, so
  // the snapshot refetches without pretending the filters changed. Keyed on
  // the filter CONTENT so a hydration round trip never refetches twice.
  const [reloadTick, setReloadTick] = useState(0);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(current => ({ ...current, loading: true, error: '' }));
    getOpportunitySnapshot(templateId, filters)
      .then(data => { if (!cancelled) setSnapshot({ loading: false, loaded: true, error: '', ...EMPTY_SNAPSHOT, ...data }); })
      .catch(err => {
        console.error(err);
        // A 404 here is not "no data": it is an API process started before
        // the snapshot route existed. Say so, or the bare status code sends
        // people hunting through their filters.
        const stale = err.response?.status === 404;
        if (!cancelled) setSnapshot({ loading: false, loaded: true, ...EMPTY_SNAPSHOT,
          error: stale ? 'The API server is running an older build without the dashboard snapshot route. Restart the server (npm run dev) and reload this page.'
            : err.response?.data?.error || err.message || 'Could not load the dashboard' });
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, filterKey, reloadTick]);

  const [options, setOptions] = useState(Object.fromEntries(FILTER_DEFS.map(f => [f.key, []])));
  useEffect(() => {
    getOptions(templateId).then(value => setOptions(current => ({ ...current, ...value }))).catch(err => console.error('options', err));
  }, [templateId, reloadTick]);

  const M = snapshot.metrics;
  const comparison = snapshot.comparison || { available: false };
  const highlights = snapshot.highlights?.[tab] || [];
  const loading = snapshot.loading;

  // Auto grain: a year of months fits; beyond ~14 buckets the bars are
  // unreadable, so the axis steps up to quarters.
  const trendGrain = grain || ((M?.trend?.monthly?.length || 0) > 14 ? 'quarter' : 'month');
  const trend = M ? (trendGrain === 'quarter' ? M.trend.quarterly : M.trend.monthly) : [];

  useEffect(() => {
    const redraw = () => setThemeVersion(v => v + 1);
    window.addEventListener('themechange', redraw);
    return () => window.removeEventListener('themechange', redraw);
  }, []);

  useEffect(() => {
    if (!M) return undefined;
    const charts = [];
    const lightTheme = document.documentElement.dataset.theme === 'light';
    const chartGrid = lightTheme ? '#E2E7EE' : '#26354C';
    const chartTick = lightTheme ? '#657286' : '#9CAABF';
    const chartSurface = lightTheme ? '#FFFFFF' : '#131C2E';
    const mk = (ref, type, cfg) => {
      if (!ref.current) return;
      charts.push(new Chart(ref.current, {
        type, data: cfg.data,
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false },
          hover: { mode: 'nearest', intersect: false },
          ...cfg.options,
        },
        plugins: cfg.plugins || [],
      }));
    };

    if (tab === 'pulse') {
      const closeBuckets = trend.filter(item => item.closedCount > 0);
      mk(bookingsRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: closeBuckets.map(item => item.label),
          datasets: [
            { label: 'Won ARR', order: 2, backgroundColor: '#10B981', borderRadius: 4, valueFormat: fmtCurrency,
              data: closeBuckets.map(item => item.bookingsArr) },
            { label: 'Win rate', type: 'line', order: 1, yAxisID: 'y1',
              borderColor: '#2F8C88', backgroundColor: '#2F8C88', tension: .3, pointRadius: 3,
              valueFormat: v => `${Number(v).toFixed(0)}%`, data: closeBuckets.map(item => item.winRate || 0) },
          ],
        },
        options: baseOptions({ percentRight: true }),
      });
      const flowBuckets = trend.filter(item => item.createdCount > 0 || item.closedCount > 0);
      mk(pipelineRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: flowBuckets.map(item => item.label),
          datasets: [
            { label: 'Created ARR', backgroundColor: '#3B82F6', borderRadius: 4, valueFormat: fmtCurrency, data: flowBuckets.map(item => item.createdArr) },
            { label: 'Closed-out ARR', backgroundColor: '#94A3B8', borderRadius: 4, valueFormat: fmtCurrency, data: flowBuckets.map(item => item.closedArr) },
          ],
        },
        options: baseOptions(),
      });
    }

    if (tab === 'diagnostics') {
      const families = M.lossFamilies;
      const lossParetoOptions = baseOptions({ percentRight: true });
      lossParetoOptions.scales.x.ticks = { ...lossParetoOptions.scales.x.ticks, autoSkip: false, minRotation: 0, maxRotation: 0, padding: 8 };
      lossParetoOptions.plugins.tooltip.callbacks = {
        title: contexts => families[contexts[0]?.dataIndex]?.family || '',
        afterLabel: context => context.dataset.label === 'Lost ARR'
          ? [`Distinct opportunities: ${fmtNumber(families[context.dataIndex]?.count || 0)}`,
            ...(families[context.dataIndex]?.reasons || []).slice(0, 4).map(reason => `${reason.reason}: ${fmtNumber(reason.count)}`)]
          : '',
      };
      mk(lossParetoRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: families.map(item => wrapAxisLabel(FAMILY_SHORT[item.family] || item.family, 14)),
          datasets: [
            { label: 'Lost ARR', order: 2, backgroundColor: '#CF5D70', borderColor: '#D97A8A', borderWidth: 1, borderRadius: 5,
              valueFormat: fmtCurrency, secondaryData: families.map(item => item.count),
              secondaryFormat: count => `${fmtNumber(count)} opps`, data: families.map(item => item.arr) },
            { label: 'Cumulative share of losses', type: 'line', order: 1, yAxisID: 'y1',
              borderColor: '#4F76B5', backgroundColor: '#4F76B5', tension: .3,
              pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: chartSurface,
              pointBorderColor: '#4F76B5', pointBorderWidth: 2,
              valueFormat: v => `${Number(v).toFixed(0)}%`, data: families.map(item => item.cumulativeShare) },
          ],
        },
        options: lossParetoOptions,
      });
    }

    if (tab === 'velocity') {
      mk(cycleWonLostRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: M.cycleBands.map(b => b.label),
          datasets: [
            { label: 'Won', backgroundColor: '#10B981', borderRadius: 4, data: M.cycleBands.map(b => b.won) },
            { label: 'Lost', backgroundColor: '#DC2626', borderRadius: 4, data: M.cycleBands.map(b => b.lost) },
          ],
        },
        options: baseOptions(),
      });
      mk(cycleWinRateRef, 'line', {
        plugins: [valueLabels],
        data: {
          labels: M.cycleBands.map(b => b.label),
          datasets: [{ label: 'Win rate', borderColor: '#4F76B5', backgroundColor: 'rgba(79,118,181,.12)', fill: true, tension: .3, pointRadius: 4,
            valueFormat: v => `${Number(v).toFixed(0)}%`, data: M.cycleBands.map(b => b.winRate || 0) }],
        },
        options: baseOptions(),
      });
    }

    if (tab === 'repperformance') {
      const median = M.repSummary.medianWinRate || 0;
      const base = baseOptions();
      const plottedReps = M.repStats
        .filter(r => r.closed > 0 && r.wins > 0 && r.booked > 0)
        .map(r => { const avgWonDeal = Math.max(1, r.booked / r.wins); return { ...r, avgWonDeal, dealSizeLog: Math.log10(avgWonDeal) }; });
      const dealSizes = plottedReps.map(r => r.avgWonDeal).sort((a, b) => a - b);
      const medianDealSize = dealSizes.length ? dealSizes[Math.floor(dealSizes.length / 2)] : 1;
      const dealLogs = plottedReps.map(r => r.dealSizeLog);
      const minDealLog = dealLogs.length ? Math.floor(Math.min(...dealLogs)) : 0;
      const maxDealLog = dealLogs.length ? Math.ceil(Math.max(...dealLogs)) : 1;
      const quadrantLines = {
        id: 'quadrantLines',
        beforeDatasetsDraw(chart) {
          const { ctx, chartArea, scales } = chart;
          if (!chartArea) return;
          const x = scales.x.getPixelForValue(Math.log10(medianDealSize));
          const y = scales.y.getPixelForValue(median);
          ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
          ctx.restore();
        },
      };
      mk(repQuadrantRef, 'bubble', {
        plugins: [quadrantLines],
        data: {
          datasets: plottedReps.map(r => ({
            label: r.rep,
            data: [{ x: r.dealSizeLog, y: r.winRate || 0, r: Math.max(5, Math.min(18, 4 + Math.sqrt(r.closed) * 1.8)) }],
            backgroundColor: (r.winRate || 0) >= median && r.avgWonDeal >= medianDealSize ? 'rgba(14,147,132,.76)'
              : (r.winRate || 0) >= median ? 'rgba(79,118,181,.74)'
              : r.avgWonDeal >= medianDealSize ? 'rgba(109,130,166,.74)' : 'rgba(204,145,55,.74)',
            borderColor: '#fff', borderWidth: 1.5,
          })),
        },
        options: {
          layout: base.layout,
          plugins: {
            legend: { display: false },
            tooltip: { ...base.plugins.tooltip, callbacks: {
              title: items => plottedReps[items[0]?.datasetIndex]?.rep || 'Owner',
              label: c => { const rep = plottedReps[c.datasetIndex];
                return [`Win rate: ${fmtPercent(rep.winRate)}`, `Average won ARR: ${fmtCurrency(rep.avgWonDeal)}`, `Closed deals: ${rep.closed}`, `Booked ARR: ${fmtCurrency(rep.booked)}`]; },
            } },
          },
          scales: {
            x: { type: 'linear', min: minDealLog, max: maxDealLog, title: { display: true, text: 'Average won ARR (log scale)', font: { size: 11 } },
              grid: { color: chartGrid }, ticks: { stepSize: 1, color: chartTick, callback: v => fmtCurrency(10 ** v), font: { size: 10 } } },
            y: { min: 0, max: 100, title: { display: true, text: 'Win rate %', font: { size: 11 } }, grid: { color: chartGrid }, ticks: { color: chartTick, callback: v => `${v}%`, font: { size: 10.5 } } },
          },
        },
      });
    }


    return () => charts.forEach(c => c.destroy());
  }, [M, tab, trend, themeVersion]);

  const updateFilter = (k, v) => setFilters(s => ({ ...s, [k]: v }));
  const startPresentation = scope => {
    const tableTops = {
      largestOpen: largestSort.top, atRisk: riskSort.top, cycleOrg: cycleOrgSort.top, cycleType: cycleTypeSort.top,
      stalled: stalledSort.top, industry: indSort.top, pod: podSort.top, reps: repSort.top,
    };
    const presentationSettings = { scope, view: tab };
    localStorage.setItem('testmu-presentation-config', JSON.stringify({ templateId, filters, scope, view: tab, tableTops }));
    saveDashboardState(templateId, { view: tab, filters, tableTops, presentationSettings }).catch(() => {});
    setPresentMenuOpen(false);
    window.open(`/present/${templateId}`, '_blank', 'noopener');
  };
  const activeFilterCount = FILTER_DEFS.reduce((count, f) => count + (filters[f.key]?.length ? 1 : 0), 0)
    + ((filters.createdFrom || filters.createdTo) ? 1 : 0) + ((filters.closeFrom || filters.closeTo) ? 1 : 0);
  const repSort = useTableSort('booked');
  const indSort = useTableSort('wonArr');
  const largestSort = useTableSort('arr');
  const riskSort = useTableSort('arr');
  const cycleOrgSort = useTableSort('won');
  const cycleTypeSort = useTableSort('won');
  const stalledSort = useTableSort('daysStuck');
  const podSort = useTableSort('wonArr');
  const tables = { largestOpen: largestSort, atRisk: riskSort, cycleOrg: cycleOrgSort, cycleType: cycleTypeSort,
    stalled: stalledSort, industry: indSort, pod: podSort, reps: repSort };
  const currentConfiguration = () => ({ view: tab, filters,
    tableTops: Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table.top])) });
  const saveCustomView = async () => {
    const name=window.prompt('Name this custom view'); if(!name?.trim()) return;
    const saved=await createSavedView(templateId,{name:name.trim(),configuration:currentConfiguration()});
    setSavedViews(current=>[saved,...current]);
  };
  const saveReport = async () => {
    const name=window.prompt('Name this saved report'); if(!name?.trim()) return;
    await createSavedReport(templateId,{name:name.trim(),reportType:'dashboard_snapshot',configuration:currentConfiguration()});
  };
  const applySavedView = id => {
    const saved=savedViews.find(view=>view.id===id); if(!saved) return;
    const config=saved.configuration||{};
    if(config.view)setTab(config.view); if(config.filters)setFilters(hydrateFilters(config.filters));
    Object.entries(config.tableTops||{}).forEach(([key,value])=>tables[key]?.setTop(value));
  };

  useEffect(() => {
    if (!stateHydrated || tableStateRestored.current) return;
    const saved = persistedStateRef.current;
    // Sort keys saved before the ARR-only rewrite named Amount-based columns.
    const LEGACY_SORT_KEYS = { amount: 'arr', lostValue: 'lostArr', openValue: 'openArr', wonValue: 'wonArr', avgCycle: 'medianCycle', dealHealth: 'health' };
    Object.entries(tables).forEach(([key, table]) => {
      if (Object.prototype.hasOwnProperty.call(saved.tableTops || {}, key)) table.setTop(saved.tableTops[key]);
      const sort = saved.tableSorting?.[key];
      if (sort) table.setSort({ ...sort, key: LEGACY_SORT_KEYS[sort.key] || sort.key });
    });
    tableStateRestored.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateHydrated]);

  const tableTopsKey = JSON.stringify(Object.values(tables).map(table => [table.top, table.sort]));
  useEffect(() => {
    if (!stateHydrated || !tableStateRestored.current) return;
    const timer = setTimeout(() => {
      const tableTops = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table.top]));
      const tableSorting = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table.sort]));
      const state = { templateId, view: tab, filters, tableTops, tableSorting };
      localStorage.setItem(`testmu-dashboard-state-${templateId}`, JSON.stringify(state));
      saveDashboardState(templateId, state).catch(error => console.error('dashboard state save', error));
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateHydrated, templateId, tab, filterKey, tableTopsKey]);

  const scopeText = useMemo(() => {
    const parts = [];
    if (filters.createdFrom || filters.createdTo) parts.push(`Created ${shortDate(filters.createdFrom) || '…'} – ${shortDate(filters.createdTo) || '…'}`);
    if (filters.closeFrom || filters.closeTo) parts.push(`Closed ${shortDate(filters.closeFrom) || '…'} – ${shortDate(filters.closeTo) || '…'}`);
    return parts.length ? parts.join(' · ') : 'All dates';
  }, [filters]);

  if (!snapshot.loaded) return <AppLoader fullscreen label="Loading Opportunity Analytics…" />;
  const hasSource = FILTER_DEFS.some(f => (options[f.key] || []).length > 0);
  const isEmpty = M && M.pulse.total === 0;

  return (
    <div className="wrap">
      <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
        <div className="brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/gallery')}>
          <img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" />
          <span>TestMu BI</span>
        </div>
        <div className="user-pill">
          <ThemeToggle />
          <DashboardSwitcher />
          <RefreshDataButton templateId={templateId} onRefreshed={() => setReloadTick(tick => tick + 1)} />
          <span>{user?.name || 'User'}</span>
          {user?.picture && <img src={user.picture} alt="" />}
          <button className="btn-secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <header className="top pv-top">
        <div className="top-row">
          <div className="pv-title-block">
            <h1>Opportunity Analytics</h1>
            <div className="sub">
              {fmtNumber(M?.pulse.total || 0)} opportunities · {fmtNumber(M?.pulse.accounts || 0)} accounts · every $ figure is ARR
            </div>
            <div className="pv-scope">
              <span className="pv-scope-key">Scope</span>
              <strong>{scopeText}</strong>
              {comparison.available && comparison.period && <span>compared with {shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)} by {comparison.dateField === 'closeDate' ? 'close' : 'created'} date</span>}
            </div>
          </div>
          <div className="dashboard-actions">
            <select className="table-top-select" defaultValue="" onChange={event=>{applySavedView(event.target.value);event.target.value='';}}>
              <option value="">Saved views</option>{savedViews.map(view=><option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
            <button type="button" className="btn-secondary" onClick={saveCustomView}>Save view</button>
            <button type="button" className="btn-secondary" onClick={saveReport}>Save report</button>
            <div className="present-launcher">
              <button type="button" className="present-button" onClick={() => setPresentMenuOpen(open => !open)}>▶ Present</button>
              {presentMenuOpen && <div className="present-menu">
                <button type="button" onClick={() => startPresentation('all')}><b>All views</b><span>Cycle through the complete dashboard</span></button>
                <button type="button" onClick={() => startPresentation('current')}><b>This view only</b><span>Present {TABS.find(t => t.key === tab)?.label}</span></button>
              </div>}
            </div>
            <div className="asof">Data as of <b>{new Date().toLocaleDateString()}</b></div>
          </div>
        </div>
        <div className="filters">
          {FILTER_DEFS.map(f => (
            <MultiSelect key={f.key} label={f.label} options={options[f.key] || []} value={filters[f.key]} onChange={value => updateFilter(f.key, value)} />
          ))}
          <DateRangeFilter filters={filters} setFilters={setFilters} />
          <button className="btn-reset" onClick={() => setFilters(defaultFilters())}>Reset all</button>
          <div className="scope">Showing <b>{fmtNumber(M?.pulse.total || 0)}</b> opportunities</div>
        </div>
        {loading && <div className="pv-progress" role="progressbar" aria-label="Updating dashboard" />}
      </header>

      <nav className="tabs">
        {TABS.map((t, i) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="num">{i + 1}</span>{t.label}
          </button>
        ))}
      </nav>

      {snapshot.error && <div className="error">{snapshot.error}</div>}
      {isEmpty && !hasSource && <div className="card win-board-empty"><div className="win-board-empty-icon">▦</div>
        <div><h3>No opportunity data is loaded</h3><p>Connect the opportunity source and map it to this dashboard.</p></div>
        <button type="button" className="btn-primary" onClick={() => navigate('/data-sources')}>Open data sources</button></div>}
      {isEmpty && hasSource && <div className="empty">Nothing matches these filters and dates — the source is loaded, the current selection is just empty.</div>}

      {M && <div className={`pv-board${loading ? ' is-updating' : ''}`} aria-busy={loading}>
      {/* ---------- PULSE ---------- */}
      {tab === 'pulse' && (
        <>
          <div className="kpis">
            <Kpi tone="blue" label="Total Opportunities" value={fmtCompact(M.pulse.total)} foot="open and closed, in scope"
              delta={comparison.available ? { value: growth(comparison.current?.opportunities, comparison.previous?.opportunities) } : null} />
            <Kpi tone="teal" label="Open Opportunities" value={fmtCompact(M.pulse.openCount)} foot={`${fmtPercent(M.pulse.openCount / (M.pulse.total || 1) * 100, 0)} of scope`} />
            <Kpi tone="green" label="Win Rate" value={fmtPercent(M.pulse.winRate)} foot={`${fmtNumber(M.pulse.wonCount)} of ${fmtNumber(M.pulse.closedCount)} closed`}
              delta={comparison.available ? { value: comparison.dealWinRatePointChange, kind: 'points' } : null} />
            <Kpi tone="blue" label="Open ARR" value={fmtCurrency(M.pulse.openArr)} foot="annualised, still in play" />
            <Kpi tone="teal" label="Won ARR" value={fmtCurrency(M.pulse.wonArr)} foot={`${fmtNumber(M.pulse.wonCount)} won · ${fmtPercent(M.pulse.arrWinRate)} ARR win rate`}
              delta={comparison.available ? { value: comparison.wonArrGrowthPct } : null} />
            <Kpi tone="red" label="Lost ARR" value={fmtCurrency(M.pulse.lostArr)} foot={`${fmtNumber(M.pulse.lostCount)} lost · ${fmtPercent(M.diagnostics.arrLossRate)} ARR loss rate`} />
            <Kpi tone="amber" label="Avg Sales Cycle" value={fmtDaysOrDash(M.pulse.avgCycle)} foot={`median ${fmtDaysOrDash(M.pulse.medianCycle)} · creation to close`} />
          </div>
          <Highlights items={highlights} />

          <div className="pv-section"><span>Funnel &amp; outcomes</span></div>
          <div className="g21">
            <ChartCard title="Stage funnel — open pipeline" hint="Open ARR and deal count per stage, in Salesforce probability order.">
              <div className="funnel">
                {M.funnel.map(f => (
                  <div className="fstep" key={f.stage}>
                    <div className="fname">{f.stage}</div>
                    <div className="ftrack">
                      <div className="ffill" style={{ width: `${Math.max(5, (f.arr / (Math.max(...M.funnel.map(x => x.arr)) || 1)) * 100)}%`, background: stageColor(f.stage) }}>{fmtCurrency(f.arr)}</div>
                    </div>
                    <div className="fmeta">{fmtNumber(f.count)} deals · {fmtPercent(f.share, 0)}</div>
                  </div>
                ))}
                {!M.funnel.length && <div className="empty">No open opportunities in scope.</div>}
              </div>
              <div className="card-foot">Total open {fmtCurrency(M.pulse.openArr)} across {fmtNumber(M.pulse.openCount)} opportunities</div>
            </ChartCard>
            <ChartCard title="Outcome mix" hint="Every opportunity by current or final state.">
              <Donut data={M.outcomeMix.map((d, i) => ({ ...d, color: ['#10B981', '#EF4444', '#3B82F6'][i] }))} centerLabel="opportunities" format={fmtNumber} />
            </ChartCard>
          </div>

          <div className="pv-section"><span>Trend</span></div>
          <div className="g2">
            <ChartCard title="Won ARR & win rate" hint={`Closed-won ARR against win rate, by ${trendGrain}.`}
              controls={<GrainToggle grain={grain} setGrain={setGrain} auto={trendGrain} />}>
              <div className="cw" style={{ height: 300 }}><canvas ref={bookingsRef} /></div>
            </ChartCard>
            <ChartCard title="Pipeline created vs. closed out" hint={`ARR created against ARR closed out (won or lost), by ${trendGrain}.`}>
              <div className="cw" style={{ height: 300 }}><canvas ref={pipelineRef} /></div>
            </ChartCard>
          </div>

          <div className="pv-section"><span>Continents &amp; biggest deals</span></div>
          <div className="g2 pulse-open-row">
            <ChartCard title="Continent performance" hint="Won ARR by the customer's continent group; the note carries win rate and volume.">
              <NeonColumns data={M.byContinent.map((d, i) => ({ label: d.label, value: d.wonArr, meta: `${fmtPercent(d.winRate, 0)} win · ${fmtNumber(d.opps)} opps`, color: seriesColor(i) }))} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Largest open opportunities" hint={`Top ${fmtNumber(M.largestOpen.length)} by ARR; click any column heading to sort.`} controls={<TableTopControl table={largestSort} count={M.largestOpen.length} />}>
              <div className="scroll open-opportunities-scroll">
                <table className="open-opportunities-table">
                  <thead><tr><Th label="Opportunity" sortKey="name" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Stage" sortKey="stage" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Owner" sortKey="owner" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="ARR" sortKey="arr" numeric sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Idle" sortKey="daysStuck" numeric sort={largestSort.sort} onSort={largestSort.onSort} /></tr></thead>
                  <tbody>
                    {largestSort.apply(M.largestOpen).map((r, i) => (
                      <tr key={r.id}>
                        <td title={r.name}><span className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</span><span className="cell-ellipsis">{r.name}</span></td>
                        <td><Pill tone="info">{r.stage}</Pill></td>
                        <td title={r.owner}><span className="cell-ellipsis">{r.owner}</span></td>
                        <td className="n mono">{fmtCurrency(r.arr)}</td>
                        <td className="n mono" style={{ color: r.isStalled ? 'var(--red)' : 'inherit' }}>{r.daysStuck === null ? '—' : `${r.daysStuck}d`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        </>
      )}

      {/* ---------- DIAGNOSTICS ---------- */}
      {tab === 'diagnostics' && (
        <>
          <div className="kpis">
            <Kpi tone="red" label="Lost ARR" value={fmtCurrency(M.diagnostics.lostArr)} foot={`${fmtNumber(M.diagnostics.lostCount)} lost opportunities`} />
            <Kpi tone="red" label="Loss Rate" value={fmtPercent(M.diagnostics.lossRate)} foot={`${fmtPercent(M.diagnostics.arrLossRate)} of closed ARR`} />
            <Kpi tone="red" label="At Risk — Red" value={fmtNumber(M.diagnostics.redCount)} foot={`${fmtCurrency(M.diagnostics.redArr)} ARR · of ${fmtNumber(M.diagnostics.ratedCount)} rated`} />
            <Kpi tone="amber" label="Declining — Amber" value={fmtNumber(M.diagnostics.amberCount)} foot={`${fmtCurrency(M.diagnostics.amberArr)} ARR · of ${fmtNumber(M.diagnostics.ratedCount)} rated`} />
            <Kpi tone="violet" label="Disengagement Losses" value={fmtPercent(M.diagnostics.disengagementRate, 0)} foot={`${fmtNumber(M.diagnostics.disengagedCount)} of closed · ${fmtPercent(M.diagnostics.disengagedShareOfLost, 0)} of losses`} />
            <Kpi tone="red" label="Renewal ARR Lost" value={fmtCurrency(M.diagnostics.renewal?.lostArr || 0)}
              foot={M.diagnostics.renewal ? `${fmtPercent(M.diagnostics.renewal.churnRate, 0)} of closed renewals churned` : 'no renewal deals in scope'} />
            <Kpi tone="blue" label="Avg Days to Lose" value={fmtDaysOrDash(M.diagnostics.avgDaysToLose)} foot={`median ${fmtDaysOrDash(M.diagnostics.medianDaysToLose)}`} />
          </div>
          <Highlights items={highlights} />

          <div className="pv-section"><span>Health &amp; segments</span></div>
          <div className="g2">
            <ChartCard title="Open ARR by deal health" hint={`${fmtPercent(M.diagnostics.ratedShare, 0)} of open opportunities carry a rating; the rest are shown as Not rated, never assumed healthy.`}>
              <ConcentricRings data={M.healthMix.map(d => ({ label: d.label, value: d.arr, count: d.count, meta: `${fmtNumber(d.count)} deals · ${fmtPercent(d.share, 0)}`, color: HEALTH_COLORS[d.label] }))} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Win rate by org type" hint="Conversion by segment; the note carries the average won ARR.">
              <MetricGauges data={M.winRateByOrg.map((d, i) => ({ label: d.label, value: d.winRate || 0, meta: `${fmtNumber(d.closed)} closed · avg won ${fmtCurrency(d.avgWonArr || 0)}`, color: seriesColor(i) }))} format={v => fmtPercent(v, 1)} />
            </ChartCard>
          </div>

          <div className="pv-section"><span>Why deals are lost</span></div>
          <div className="g2">
            <ChartCard title="Loss families by lost ARR" hint="Bars are lost ARR per family; the line is the cumulative share of lost deals. Hover a bar for its raw reasons.">
              <div className="cw" style={{ height: 330 }}><canvas ref={lossParetoRef} /></div>
            </ChartCard>
            <ChartCard title="Loss family concentration" hint="Share of each org type's lost deals. Read down a column — the percentages sum to 100.">
              <div className="loss-heatmap-scroll">
                <Heatmap rows={M.lossGrid.rows.map(r => r.family)} cols={M.lossGrid.orgs} format={v => `${v.toFixed(0)}%`}
                  bands={[
                    { max: 10, bg: '#20365F', label: '<10%' }, { max: 20, bg: '#17658A', label: '10–20%' }, { max: 30, bg: '#009EB2', label: '20–30%' },
                    { max: 45, bg: '#F59E0B', label: '30–45%' }, { max: Infinity, bg: '#F43F5E', label: '>45%' },
                  ]}
                  cell={(family, org) => { const row = M.lossGrid.rows.find(r => r.family === family); const total = M.lossGrid.totals[org] || 0; const v = row?.cols[org] || 0; return { count: v, value: total ? (v / total) * 100 : 0 }; }} />
              </div>
            </ChartCard>
          </div>
          <ChartCard title="Loss reasons in full" hint="Every raw reason with its family, distinct opportunity count and lost ARR.">
            <div className="scroll" style={{ maxHeight: 380 }}>
              <table>
                <thead><tr><th>Reason</th><th>Family</th><th className="n">Lost</th><th className="n">Share of losses</th><th className="n">Lost ARR</th></tr></thead>
                <tbody>{M.lossReasons.map(r => <tr key={r.reason}><td><b>{r.reason}</b></td><td style={{ color: 'var(--txt-2)' }}>{r.family}</td><td className="n mono">{fmtNumber(r.count)}</td><td className="n mono">{fmtPercent(r.share)}</td><td className="n mono">{fmtCurrency(r.arr)}</td></tr>)}</tbody>
              </table>
            </div>
          </ChartCard>

          <div className="pv-section"><span>Intervention list</span></div>
          <ChartCard title="At-risk open pipeline" hint="Red and Amber open deals, largest ARR first — click Health to group by severity." controls={<TableTopControl table={riskSort} count={M.atRisk.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Opportunity" sortKey="name" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Health" sortKey="health" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Stage" sortKey="stage" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Owner" sortKey="owner" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="ARR" sortKey="arr" numeric sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Idle" sortKey="daysStuck" numeric sort={riskSort.sort} onSort={riskSort.onSort} /></tr></thead>
                <tbody>
                  {riskSort.apply(M.atRisk).map(r => (
                    <tr key={r.id} className={r.health === 'Red' ? 'sev-high' : 'sev-med'}>
                      <td>{r.name}</td>
                      <td><Pill tone={healthTone(r.health)}>{r.health}</Pill></td>
                      <td>{r.stage}</td>
                      <td>{r.owner}</td>
                      <td className="n mono">{fmtCurrency(r.arr)}</td>
                      <td className="n mono" style={{ color: 'var(--red)' }}>{r.daysStuck === null ? '—' : `${r.daysStuck}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!M.atRisk.length && <div className="empty">No Red or Amber open deals in scope.</div>}
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- VELOCITY ---------- */}
      {tab === 'velocity' && (
        <>
          <div className="kpis">
            <Kpi tone="blue" label="Avg Days in Stage" value={fmtDaysOrDash(M.velocity.avgDays)} foot="across open pipeline" />
            <Kpi tone="blue" label="Median Days in Stage" value={fmtDaysOrDash(M.velocity.medianDays)} foot="half the pipeline is older" />
            <Kpi tone="red" label="Stalled" value={fmtNumber(M.velocity.stalledCount)} foot={`${fmtPercent(M.velocity.stalledShare, 0)} of open · past their threshold`} />
            <Kpi tone="red" label="Stalled ARR" value={fmtCurrency(M.velocity.stalledArr)} foot="recurring revenue at a standstill" />
            <Kpi tone="red" label="Twice Over Threshold" value={fmtNumber(M.velocity.wayOverCount)} foot={`effectively dormant · ${fmtCurrency(M.velocity.wayOverArr)}`} />
            <Kpi tone="teal" label="Median Cycle — Won" value={fmtDaysOrDash(M.velocity.medianCycleWon)} foot={`lost deals take ${fmtDaysOrDash(M.velocity.medianCycleLost)} · avg won ${fmtDaysOrDash(M.velocity.avgCycleWon)}`} />
          </div>
          <Highlights items={highlights} />

          <div className="pv-section"><span>Aging</span></div>
          <div className="g2">
            <ChartCard title="Aging profile of open pipeline" hint="Open ARR by how long each deal has sat in its current stage.">
              <NeonColumns data={M.agingBuckets.map((b, i) => ({ label: b.label, value: b.arr, meta: `${fmtNumber(b.count)} deals · ${fmtPercent(b.share, 0)}`, color: ['#10B981', '#65A30D', '#F59E0B', '#EA580C', '#DC2626', '#7F1D1D'][i] }))} format={fmtCurrency} sortable={false} />
            </ChartCard>
            <ChartCard title="Average days in stage, by stage" hint="The bottleneck is wherever this bar is longest; the note counts stalled deals in the stage.">
              <LollipopList data={M.daysByStage.map(s => ({ label: s.stage, value: s.avgDays || 0, meta: `${fmtNumber(s.count)} open · ${fmtNumber(s.stalled)} stalled`, color: stageColor(s.stage) }))} format={fmtDays} />
            </ChartCard>
          </div>

          <div className="pv-section"><span>Sales cycle</span></div>
          <div className="g2">
            <ChartCard title="Sales cycle: won vs. lost" hint="Deal counts by cycle-length band.">
              <div className="cw"><canvas ref={cycleWonLostRef} /></div>
            </ChartCard>
            <ChartCard title="Cycle length vs. win rate" hint="Win rate for deals closing in each band.">
              <div className="cw"><canvas ref={cycleWinRateRef} /></div>
            </ChartCard>
          </div>
          <div className="g2">
            <ChartCard title="Median sales cycle by org type" hint="Medians, not means — one long Enterprise deal would distort an average." controls={<TableTopControl table={cycleOrgSort} count={M.cycleByOrg.length} />}>
              <div className="scroll">
                <table>
                  <thead><tr><Th label="Org type" sortKey="org" sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Won" sortKey="won" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Lost" sortKey="lost" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Difference" sortKey="difference" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /></tr></thead>
                  <tbody>
                    {cycleOrgSort.apply(M.cycleByOrg.map(c => ({ ...c, won: c.won ?? 0, lost: c.lost ?? 0, difference: (c.lost ?? 0) - (c.won ?? 0) }))).map(c => {
                      const max = Math.max(...M.cycleByOrg.map(x => Math.max(x.won || 0, x.lost || 0)), 1);
                      return <tr key={c.org}><td><b>{c.org}</b></td>
                        <td className="n"><MiniBar value={c.won} max={max} color="#10B981" label={fmtDays(c.won)} /></td>
                        <td className="n"><MiniBar value={c.lost} max={max} color="#DC2626" label={fmtDays(c.lost)} /></td>
                        <td className="n mono">{c.difference > 0 ? '+' : ''}{c.difference} d</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </ChartCard>
            <ChartCard title="Median sales cycle by type" hint="Renewals close in a fraction of the time new business takes, so a blended average tells you little." controls={<TableTopControl table={cycleTypeSort} count={M.typeHealth.length} />}>
              <div className="scroll">
                <table>
                  <thead><tr><Th label="Type" sortKey="type" sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Won" sortKey="won" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Lost" sortKey="lost" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Closed" sortKey="closed" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /></tr></thead>
                  <tbody>
                    {cycleTypeSort.apply(M.typeHealth.filter(t => t.closed > 0).map(t => ({ type: t.type, won: t.medianCycleWon ?? 0, lost: t.medianCycleLost ?? 0, closed: t.closed }))).map(c => {
                      const max = Math.max(...M.typeHealth.map(x => Math.max(x.medianCycleWon || 0, x.medianCycleLost || 0)), 1);
                      return <tr key={c.type}><td><b>{c.type}</b></td>
                        <td className="n"><MiniBar value={c.won} max={max} color="#10B981" label={fmtDays(c.won)} /></td>
                        <td className="n"><MiniBar value={c.lost} max={max} color="#DC2626" label={fmtDays(c.lost)} /></td>
                        <td className="n mono">{fmtNumber(c.closed)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>

          <div className="pv-section"><span>Stalled deals</span></div>
          <ChartCard title="Stalled open deals" hint="Past their org-type threshold, longest idle first." controls={<TableTopControl table={stalledSort} count={M.stalledDeals.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Opportunity" sortKey="name" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Account" sortKey="account" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Org type" sortKey="orgType" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Stage" sortKey="stage" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Owner" sortKey="owner" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="ARR" sortKey="arr" numeric sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Idle vs limit" sortKey="daysStuck" numeric sort={stalledSort.sort} onSort={stalledSort.onSort} /></tr></thead>
                <tbody>
                  {stalledSort.apply(M.stalledDeals).map(r => {
                    const ratio = r.staleThreshold ? (r.daysStuck / r.staleThreshold) : 1;
                    return <tr key={r.id} className={ratio >= 2 ? 'sev-high' : 'sev-med'}>
                      <td>{r.name}</td><td style={{ color: 'var(--txt-2)' }}>{r.account}</td><td><Pill tone="neutral">{r.orgType}</Pill></td><td>{r.stage}</td><td>{r.owner}</td>
                      <td className="n mono">{fmtCurrency(r.arr)}</td>
                      <td className="n"><Pill tone={ratio >= 2 ? 'bad' : 'warn'}>{r.daysStuck}d / {r.staleThreshold}d</Pill></td></tr>;
                  })}
                </tbody>
              </table>
              {!M.stalledDeals.length && <div className="empty">No stalled deals in scope.</div>}
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- WHERE WE WIN ---------- */}
      {tab === 'wherewewin' && (
        <>
          <div className="kpis">
            <Kpi tone="teal" label="Best Org Type" value={M.whereWeWin.bestOrg?.label || '—'} foot={M.whereWeWin.bestOrg ? `${fmtCurrency(M.whereWeWin.bestOrg.wonArr)} Won ARR · ${fmtPercent(M.whereWeWin.bestOrg.winRate, 0)} win rate` : 'no closed deals'} />
            <Kpi tone="teal" label="Best Industry" value={M.whereWeWin.bestIndustry?.label || '—'} foot={M.whereWeWin.bestIndustry ? `${fmtCurrency(M.whereWeWin.bestIndustry.wonArr)} Won ARR · ${fmtPercent(M.whereWeWin.bestIndustry.winRate, 0)} win rate` : '3+ closed deals required'} />
            <Kpi tone="red" label="Weakest Industry" value={M.whereWeWin.weakestIndustry?.label || '—'} foot={M.whereWeWin.weakestIndustry ? `${fmtPercent(M.whereWeWin.weakestIndustry.winRate, 0)} win rate on ${fmtNumber(M.whereWeWin.weakestIndustry.closed)} closed` : '3+ closed deals required'} />
            <Kpi tone="violet" label="Industries Tracked" value={fmtNumber(M.whereWeWin.industriesTracked)} foot={`${fmtNumber(M.whereWeWin.rankable)} with 3+ closed deals`} />
          </div>
          <Highlights items={highlights} />

          <div className="pv-section"><span>Fit</span></div>
          <ChartCard title="Win rate: continent × org type" hint="Colour is win rate; the number beneath is closed deal count.">
            <Heatmap rows={M.heat.continents} cols={M.heat.orgs} cell={(continent, org) => { const c = M.heat.cells[continent]?.[org]; return { count: c?.closed || 0, value: c?.winRate || 0 }; }} />
          </ChartCard>
          <div className="g2" style={{ marginTop: 16 }}>
            <ChartCard title="Lead source effectiveness" hint="Won ARR and win rate by how the deal originated.">
              <BarList data={M.leadSource.map((d, i) => ({ label: d.label, value: d.wonArr, meta: `${fmtPercent(d.winRate, 0)} win · ${fmtNumber(d.closed)} closed`, color: seriesColor(i) }))} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Business mix" hint="Won ARR by opportunity type. Renewals convert far higher than new business by nature — compare within a type, not across.">
              <BarList data={M.typeHealth.filter(t => t.closed > 0).map(t => ({ label: t.type, value: t.wonArr, meta: `${fmtPercent(t.winRate, 0)} win · ${fmtNumber(t.closed)} closed`, color: t.isRenewal ? '#8B5CF6' : /new/i.test(t.type) ? '#0E9384' : '#3B82F6' }))} format={fmtCurrency} />
            </ChartCard>
          </div>
          <ChartCard title="Industry scorecard" style={{ marginTop: 16 }} hint="Industries with three or more closed deals. Won ARR is the primary ranking metric; click a column to sort." controls={<TableTopControl table={indSort} count={M.industryScorecard.length} />}>
            <div className="scroll">
              <table>
                <thead><tr>
                  <Th label="Industry" sortKey="industry" sort={indSort.sort} onSort={indSort.onSort} />
                  <Th label="Closed" sortKey="closed" numeric sort={indSort.sort} onSort={indSort.onSort} />
                  <Th label="Win Rate" sortKey="winRate" numeric sort={indSort.sort} onSort={indSort.onSort} />
                  <Th label="Won ARR" sortKey="wonArr" numeric sort={indSort.sort} onSort={indSort.onSort} />
                  <Th label="Lost ARR" sortKey="lostArr" numeric sort={indSort.sort} onSort={indSort.onSort} />
                </tr></thead>
                <tbody>
                  {indSort.apply(M.industryScorecard).map(r => (
                    <tr key={r.industry}><td><b>{r.industry}</b></td><td className="n mono">{r.closed}</td>
                      <td className="n"><Pill tone={rateTone(r.winRate || 0)}>{fmtPercent(r.winRate, 0)}</Pill></td>
                      <td className="n mono">{fmtCurrency(r.wonArr)}</td><td className="n mono">{fmtCurrency(r.lostArr)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- REP PERFORMANCE ---------- */}
      {tab === 'repperformance' && (
        <>
          <div className="kpis">
            <Kpi tone="blue" label="Owners" value={fmtNumber(M.repSummary.activeReps)} foot={`${fmtNumber(M.podPerformance.length)} PODs · ${fmtNumber(M.repSummary.qualifiedReps)} with 3+ closed`} />
            <Kpi tone="teal" label="Median Win Rate" value={fmtPercent(M.repSummary.medianWinRate)} foot="owners with 3+ closed deals" />
            <Kpi tone="amber" label="Win Rate Spread" value={M.repSummary.spread ? `${fmtPercent(M.repSummary.spread.min, 0)}–${fmtPercent(M.repSummary.spread.max, 0)}` : '—'} foot="worst to best" />
            <Kpi tone="teal" label="Top by Win Rate" value={M.repSummary.topByWinRate?.rep || '—'} foot={M.repSummary.topByWinRate ? `${fmtPercent(M.repSummary.topByWinRate.winRate, 0)} on ${fmtNumber(M.repSummary.topByWinRate.closed)} closed` : '3+ closed required'} />
            <Kpi tone="teal" label="Top by Won ARR" value={M.repSummary.topByBookings?.rep || '—'} foot={fmtCurrency(M.repSummary.topByBookings?.booked || 0)} />
          </div>
          <Highlights items={highlights} />

          <div className="pv-section"><span>Conversion vs deal size</span></div>
          <div className="g2">
            <ChartCard title="Rep performance map" hint="Win rate vs average won ARR. Bubble size is closed-deal volume; dashed lines mark the medians.">
              <div className="cw" style={{ height: 360 }}><canvas ref={repQuadrantRef} /></div>
            </ChartCard>
            <ChartCard title="Win rate by POD" hint="Closed includes both won and lost deals. Counts below each gauge show all three outcomes.">
              <MetricGauges data={M.podPerformance.map(p => ({ label: p.pod, value: p.winRate || 0, meta: `${fmtNumber(p.closed)} closed · ${fmtNumber(p.wins)} won · ${fmtNumber(p.losses)} lost`, color: (p.winRate || 0) >= 50 ? '#15803D' : (p.winRate || 0) >= 35 ? '#D9A407' : '#C81E1E' }))} format={v => fmtPercent(v, 1)} />
            </ChartCard>
          </div>

          <div className="pv-section"><span>Scorecards</span></div>
          <ChartCard title="Opportunities and ARR by POD" hint="Won against lost ARR per POD." controls={<TableTopControl table={podSort} count={M.podPerformance.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="POD" sortKey="pod" sort={podSort.sort} onSort={podSort.onSort} /><Th label="Owners" sortKey="reps" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Opps" sortKey="opps" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Closed" sortKey="closed" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Win Rate" sortKey="winRate" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Won ARR" sortKey="wonArr" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Lost ARR" sortKey="lostArr" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Open ARR" sortKey="openArr" numeric sort={podSort.sort} onSort={podSort.onSort} /></tr></thead>
                <tbody>
                  {podSort.apply(M.podPerformance).map(p => {
                    const maxArr = Math.max(...M.podPerformance.map(x => x.wonArr), 1);
                    return <tr key={p.pod}><td><b>{p.pod}</b></td><td className="n mono">{fmtNumber(p.reps)}</td><td className="n mono">{fmtNumber(p.opps)}</td><td className="n mono">{fmtNumber(p.closed)}</td>
                      <td className="n"><Pill tone={rateTone(p.winRate || 0)}>{fmtPercent(p.winRate, 0)}</Pill></td>
                      <td className="n"><MiniBar value={p.wonArr} max={maxArr} color="#10B981" label={fmtCurrency(p.wonArr)} /></td>
                      <td className="n mono" style={{ color: 'var(--red)' }}>{fmtCurrency(p.lostArr)}</td><td className="n mono">{fmtCurrency(p.openArr)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
          <ChartCard title="Owner scorecard" style={{ marginTop: 16 }} hint="Every owner in scope, including Self Serve and system owners — narrow with the POD or Owner filter. Click any column to sort." controls={<TableTopControl table={repSort} count={M.repStats.length} />}>
            <div className="scroll" style={{ maxHeight: 460 }}>
              <table>
                <thead><tr>
                  <Th label="Owner" sortKey="rep" sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="POD" sortKey="pod" sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Closed" sortKey="closed" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Wins" sortKey="wins" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Win Rate" sortKey="winRate" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Won ARR" sortKey="booked" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Open ARR" sortKey="openArr" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Stalled" sortKey="stalled" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  <Th label="Median cycle" sortKey="medianCycle" numeric sort={repSort.sort} onSort={repSort.onSort} />
                </tr></thead>
                <tbody>
                  {repSort.apply(M.repStats).map((r, i) => {
                    const maxBooked = Math.max(...M.repStats.map(x => x.booked), 1);
                    return <tr key={r.rep}>
                      <td><span className={`rank${i < 3 && repSort.sort.dir === 'desc' ? ' top' : ''}`}>{i + 1}</span><b>{r.rep}</b></td>
                      <td><Pill tone="neutral">{r.pod}</Pill></td><td className="n mono">{r.closed}</td><td className="n mono">{r.wins}</td>
                      <td className="n"><Pill tone={rateTone(r.winRate || 0)}>{fmtPercent(r.winRate, 0)}</Pill></td>
                      <td className="n"><MiniBar value={r.booked} max={maxBooked} label={fmtCurrency(r.booked)} /></td>
                      <td className="n mono">{fmtCurrency(r.openArr)}</td>
                      <td className="n mono" style={{ color: r.stalled > 3 ? 'var(--red)' : 'inherit' }}>{r.stalled}</td>
                      <td className="n mono">{fmtDaysOrDash(r.medianCycle)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      </div>}

      <div className="page-foot">
        All figures recompute against the active filters, and every $ figure is ARR.
        <br />
        Days in stage, cycle days, stale thresholds and Deal Health come from the source as columns. A deal is stalled once its days in stage reach its org-type threshold — 90 days Enterprise, 30 Mid-Market, 15 SMB.
      </div>

      <button type="button" className="floating-filter-button" aria-label="Open dashboard filters" title="Dashboard filters" onClick={() => setFilterPanelOpen(open => !open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5" />
          <circle cx="16" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="13" cy="18" r="2" />
        </svg>
        {activeFilterCount > 0 && <span className="floating-filter-badge">{activeFilterCount}</span>}
      </button>

      {filterPanelOpen && (
        <aside className="floating-filter-panel" aria-label="Dashboard filters">
          <div className="floating-filter-head">
            <div><b>Dashboard filters</b><span>{fmtNumber(M?.pulse.total || 0)} opportunities</span></div>
            <button type="button" aria-label="Close filters" onClick={() => setFilterPanelOpen(false)}>×</button>
          </div>
          <div className="floating-filter-controls">
            {FILTER_DEFS.map(f => (
              <MultiSelect key={f.key} label={f.label} options={options[f.key] || []} value={filters[f.key]} onChange={value => updateFilter(f.key, value)} />
            ))}
            <DateRangeFilter filters={filters} setFilters={setFilters} />
          </div>
          <button className="floating-filter-reset" type="button" onClick={() => setFilters(defaultFilters())}>Reset all filters</button>
        </aside>
      )}
    </div>
  );
}

/* ---------- KPI tile ---------- */
function KpiDelta({ value, kind = 'growth', invert = false }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  const magnitude = Math.abs(value);
  const text = kind === 'points' ? `${magnitude.toFixed(1)} pts` : magnitude >= 1000 ? '>999%' : `${magnitude.toFixed(1)}%`;
  return <small className={`pv-kpi-delta ${good ? 'good' : 'bad'}`} title="Against the previous equal period">{up ? '▲' : '▼'} {text}</small>;
}
function Kpi({ tone, label, value, foot, delta = null }) {
  return (
    <div className={`kpi acc-${tone}`}>
      <div className="kpi-label-row"><div className="lb">{label}</div>{delta && <KpiDelta {...delta} />}</div>
      <div className="vl">{value}</div>
      <div className="ft">{foot}</div>
    </div>
  );
}

/* ---------- Month / quarter toggle ---------- */
function GrainToggle({ grain, setGrain, auto }) {
  const opts = [{ key: null, label: 'Auto' }, { key: 'month', label: 'Month' }, { key: 'quarter', label: 'Quarter' }];
  return (
    <div className="pv-toggle">
      {opts.map(o => <button key={o.label} type="button" className={grain === o.key ? 'on' : ''} onClick={() => setGrain(o.key)}
        title={o.key === null ? `Currently showing ${auto}s` : undefined}>{o.label}</button>)}
    </div>
  );
}

/* ---------- Date range filter ---------- */
const PRESETS = [
  { key: 'ytd', label: 'This year' },
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'lastQuarter', label: 'Last quarter' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'next90', label: 'Next 90 days' },
];

function isoLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function presetRange(key) {
  const today = new Date();
  const q = Math.floor(today.getMonth() / 3);
  const y = today.getFullYear();
  switch (key) {
    case 'thisQuarter': return [isoLocal(new Date(y, q * 3, 1)), isoLocal(new Date(y, q * 3 + 3, 0))];
    case 'lastQuarter': return [isoLocal(new Date(y, q * 3 - 3, 1)), isoLocal(new Date(y, q * 3, 0))];
    case 'ytd': return [isoLocal(new Date(y, 0, 1)), isoLocal(today)];
    case 'last30': return [isoLocal(new Date(today.getTime() - 30 * 86400000)), isoLocal(today)];
    case 'next90': return [isoLocal(today), isoLocal(new Date(today.getTime() + 90 * 86400000))];
    default: return ['', ''];
  }
}

function shortDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y.slice(2)}`;
}

function DateRangeFilter({ filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  // Quick ranges default to CREATED date: it is the board's scoping field.
  const [target, setTarget] = useState('created');
  const wrapRef = useRef(null);
  // The popover is portalled into <body>, so it is NOT inside wrapRef: the
  // outside-click test must consult it too, or every click on a preset or a
  // date input closes the popover on mousedown before the click lands —
  // which is exactly how the picker used to fail.
  const popRef = useRef(null);

  const { closeFrom, closeTo, createdFrom, createdTo } = filters;
  const active = Boolean(closeFrom || closeTo || createdFrom || createdTo);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 6 });
    };
    measure();
    const onDown = e => { if (!wrapRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', measure);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', measure); };
  }, [open]);

  const set = patch => setFilters(s => ({ ...s, ...patch }));

  function applyPresetTo(key) {
    const [f, t] = presetRange(key);
    set(target === 'close' ? { closeFrom: f, closeTo: t, closePreset: key } : { createdFrom: f, createdTo: t, createdPreset: key });
  }

  function summary() {
    if (!active) return 'All dates';
    const parts = [];
    if (createdFrom || createdTo) parts.push(`Created ${shortDate(createdFrom) || '…'} – ${shortDate(createdTo) || '…'}`);
    if (closeFrom || closeTo) parts.push(`Close ${shortDate(closeFrom) || '…'} – ${shortDate(closeTo) || '…'}`);
    return parts.join('  ·  ');
  }

  const [tFrom, tTo] = target === 'close' ? [closeFrom, closeTo] : [createdFrom, createdTo];
  const activePreset = PRESETS.find(p => { const [f, t] = presetRange(p.key); return f === tFrom && t === tTo; })?.key;

  return (
    <div className="fg" ref={wrapRef} style={{ position: 'relative' }}>
      <label>Date range</label>
      <button type="button" className={`date-range-trigger${active ? ' on' : ''}`} onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '8px 12px', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', minWidth: 150, whiteSpace: 'nowrap',
      }}>
        <span style={{ opacity: .75, fontSize: 12 }}>▤</span>
        {summary()}
        <span style={{ opacity: .5, fontSize: 9, marginLeft: 'auto' }}>▼</span>
      </button>

      {open && rect && createPortal(
        <div ref={popRef} role="dialog" aria-label="Date range" style={{ position: 'fixed', left: rect.left, top: rect.top, zIndex: 1000, width: 340, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.18)', padding: 14, color: 'var(--txt)' }}>
          <div style={popLabel}>Apply quick ranges to</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, marginBottom: 12 }}>
            {[['created', 'Created date'], ['close', 'Close date']].map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setTarget(k)} style={{
                flex: 1, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6,
                border: `1px solid ${target === k ? 'var(--txt)' : 'var(--line)'}`, background: target === k ? 'var(--txt)' : 'transparent',
                color: target === k ? 'var(--card)' : 'var(--txt-2)', fontWeight: target === k ? 650 : 400,
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(p => {
              const on = activePreset === p.key;
              return <button key={p.key} type="button" onClick={() => applyPresetTo(p.key)} style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? 'var(--teal)' : 'var(--line)'}`, background: on ? 'var(--teal)' : 'transparent', color: on ? '#fff' : 'var(--txt-2)',
              }}>{p.label}</button>;
            })}
          </div>
          <div style={{ ...popLabel, marginTop: 16 }}>Created date</div>
          <RangeInputs from={createdFrom} to={createdTo} onFrom={v => set({ createdFrom: v, createdPreset: '' })} onTo={v => set({ createdTo: v, createdPreset: '' })} />
          <div style={{ ...popLabel, marginTop: 12 }}>Close date</div>
          <RangeInputs from={closeFrom} to={closeTo} onFrom={v => set({ closeFrom: v, closePreset: '' })} onTo={v => set({ closeTo: v, closePreset: '' })} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={() => set({ closeFrom: '', closeTo: '', createdFrom: '', createdTo: '', createdPreset: '', closePreset: '' })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, color: 'var(--txt-3)', fontFamily: 'inherit' }}>
              Clear dates
            </button>
            <button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>, document.body)}
    </div>
  );
}

function RangeInputs({ from, to, onFrom, onTo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <input type="date" value={from} max={to || undefined} onChange={e => onFrom(e.target.value)} style={dateInput} />
      <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>→</span>
      <input type="date" value={to} min={from || undefined} onChange={e => onTo(e.target.value)} style={dateInput} />
    </div>
  );
}

const popLabel = { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--txt-3)', fontWeight: 650 };
const dateInput = { flex: 1, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit', background: 'var(--card)', color: 'var(--txt)', colorScheme: 'light' };

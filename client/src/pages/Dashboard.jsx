import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { getData, getOptions, getDashboardState, saveDashboardState, listSavedViews, createSavedView, createSavedReport } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import RefreshDataButton from '../components/RefreshDataButton';
import AppLoader from '../components/AppLoader';
import {
  ChartCard, ChartScroll, MultiSelect, BarList, Heatmap, Donut, MetricGauges,
  ConcentricRings, NeonColumns, LollipopList, MiniBar, Pill, Th, useTableSort,
  fmtCurrency, fmtPercent, fmtNumber, fmtDays,
  timeAxis, trimEmpty, valueLabels, baseOptions, rateTone,
  seriesColor,
} from '../components/charts';

const TABS = [
  { key: 'pulse', label: 'Pulse' },
  { key: 'diagnostics', label: 'Diagnostics' },
  { key: 'velocity', label: 'Velocity & Aging' },
  { key: 'wherewewin', label: 'Where We Win' },
  { key: 'repperformance', label: 'Rep Performance' },
  { key: 'accounts', label: 'Accounts & Whitespace' },
];

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

const EMPTY_FILTERS = {
  region: [], orgType: [], stage: [], owner: [], source: [], type: [],
  createdFrom: '', createdTo: '', closeFrom: '', closeTo: '',
};

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

const STAGE_ORDER = [
  'No Contact','Qualification','Demo','Pre-Trial','Trial',
  'Work In Progress','Post Trial Discussion','Proposal',
  'Negotiation','Procurement','Confirmed','Risk','Closed Won','Closed Lost'
];

const STAGE_COLORS = {
  'No Contact':'#94A3B8','Qualification':'#64748B','Demo':'#3B82F6',
  'Pre-Trial':'#60A5FA','Trial':'#818CF8','Work In Progress':'#A78BFA',
  'Post Trial Discussion':'#8B5CF6','Proposal':'#F59E0B',
  'Negotiation':'#10B981','Procurement':'#059669',
  'Confirmed':'#047857','Risk':'#DC2626','Closed Won':'#10B981','Closed Lost':'#EF4444'
};

const ORG_ORDER = ['SMB', 'Mid-Market', 'Enterprise'];

// Products arrive semicolon-joined: "Realtime;Web;Real Devices".
// A deal counts under each of its products, so product totals exceed deal count.
const splitProducts = v => String(v || '').split(';').map(s => s.trim()).filter(Boolean);

// dealHealth is a picklist: Green / Amber / Red.
const isRed = r => String(r.dealHealth).toLowerCase() === 'red';
const isAmber = r => String(r.dealHealth).toLowerCase() === 'amber';
const isGreen = r => String(r.dealHealth).toLowerCase() === 'green';
const healthTone = v => ({ red: 'bad', amber: 'warn', green: 'good' })[String(v).toLowerCase()] || 'neutral';
const fmtCompact = n => new Intl.NumberFormat('en', {
  notation: 'compact', maximumFractionDigits: 1,
}).format(n || 0);

export default function Dashboard({ user }) {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() => savedDashboardState(templateId).view || 'pulse');
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    ...(savedDashboardState(templateId).filters || {}),
  }));
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
  const oppsPerAccountRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    tableStateRestored.current = false;
    const local = savedDashboardState(templateId);
    getDashboardState(templateId).then(async remote => {
      if (cancelled) return;
      const initial = remote || local;
      if (initial?.filters) setFilters({ ...EMPTY_FILTERS, ...initial.filters });
      if (initial?.view) setTab(initial.view);
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
  // the rows refetch without pretending the filters changed.
  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    setLoading(true);
    getData(templateId, filters)
      .then(rows => { setData(rows); setLoading(false); })
      .catch(err => { console.error(err); setData([]); setLoading(false); });
  }, [templateId, filters, reloadTick]);

  const [options, setOptions] = useState({
    region: [], orgType: [], stage: [], owner: [], source: [], type: [],
  });

  useEffect(() => {
    getOptions(templateId, filters)
      .then(setOptions)
      .catch(err => console.error('options', err));
  }, [templateId, filters]);

  /* ===================== PULSE ===================== */
  const pulse = useMemo(() => {
    const open = data.filter(r => !r.isClosed);
    const won = data.filter(r => r.isWon);
    const closed = data.filter(r => r.isClosed);
    const openPipeline = open.reduce((s, r) => s + (r.amount || 0), 0);
    const weighted = open.reduce((s, r) => {
      const p = { 'Pipeline': .25, 'Best Case': .5, 'Commit': .75, 'Closed': 1 }[r.forecastCategory] ?? .25;
      return s + (r.amount || 0) * p;
    }, 0);
    return {
      openPipeline, weighted,
      wonValue: won.reduce((s, r) => s + (r.amount || 0), 0),
      winRate: closed.length ? (won.length / closed.length) * 100 : 0,
      openArr: open.reduce((s, r) => s + (r.arr || 0), 0),
      wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
      avgCycle: closed.length
        ? Math.round(closed.reduce((s, r) => s + (r.cycleDays || 0), 0) / closed.length) : 0,
      openCount: open.length, wonCount: won.length, closedCount: closed.length,
    };
  }, [data]);

  const funnelData = useMemo(() => {
    const m = {};
    STAGE_ORDER.forEach(s => m[s] = { count: 0, value: 0 });
    data.filter(r => !r.isClosed).forEach(r => {
      if (m[r.stage]) { m[r.stage].count++; m[r.stage].value += (r.amount || 0); }
    });
    return STAGE_ORDER.map(s => ({ stage: s, ...m[s] }))
      .filter(x => x.count > 0 && !x.stage.startsWith('Closed'));
  }, [data]);

  const outcomeMix = useMemo(() => [
    { label: 'Closed Won', value: data.filter(r => r.isWon).length, color: '#10B981' },
    { label: 'Closed Lost', value: data.filter(r => r.isClosed && !r.isWon).length, color: '#EF4444' },
    { label: 'Open', value: data.filter(r => !r.isClosed).length, color: '#3B82F6' },
  ], [data]);

  const regionPerformance = useMemo(() => {
    const regions = [...new Set(data.map(r => r.region).filter(Boolean))];
    return regions.map(rg => {
      const rows = data.filter(r => r.region === rg);
      const won = rows.filter(r => r.isWon);
      const closed = rows.filter(r => r.isClosed);
      const winRate = closed.length ? (won.length / closed.length) * 100 : 0;
      return {
        label: rg,
        value: won.reduce((s, r) => s + (r.amount || 0), 0),
        meta: `${fmtPercent(winRate, 0)} win · ${rows.length} opps`,
        color: '#0E9384',
      };
    });
  }, [data]);

  const largestOpen = useMemo(() =>
    data.filter(r => !r.isClosed)
      .sort((a, b) => (b.amount || 0) - (a.amount || 0)), [data]);

  /* ===================== DIAGNOSTICS ===================== */
  const diagnostics = useMemo(() => {
    const lost = data.filter(r => r.isClosed && !r.isWon);
    const closed = data.filter(r => r.isClosed);
    const open = data.filter(r => !r.isClosed);
    const red = open.filter(isRed);
    const amber = open.filter(isAmber);
    const disengaged = lost.filter(r =>
      ['Not Responding', 'No Longer Evaluating'].includes(r.lossReason));
    return {
      valueLost: lost.reduce((s, r) => s + (r.amount || 0), 0),
      lostCount: lost.length,
      lossRate: closed.length ? (lost.length / closed.length) * 100 : 0,
      redValue: red.reduce((s, r) => s + (r.amount || 0), 0), redCount: red.length,
      redArr: red.reduce((s, r) => s + (r.arr || 0), 0),
      amberValue: amber.reduce((s, r) => s + (r.amount || 0), 0), amberCount: amber.length,
      amberArr: amber.reduce((s, r) => s + (r.arr || 0), 0),
      disengagement: closed.length ? (disengaged.length / closed.length) * 100 : 0,
      avgDaysToLose: lost.length
        ? Math.round(lost.reduce((s, r) => s + (r.cycleDays || 0), 0) / lost.length) : 0,
    };
  }, [data]);

  const healthByArr = useMemo(() => {
    const open = data.filter(r => !r.isClosed);
    const bucket = (label, test, color) => {
      const rows = open.filter(test);
      return { label, color, value: rows.reduce((s, r) => s + (r.arr || 0), 0), count: rows.length, meta: `${rows.length} deals` };
    };
    return [
      bucket('Healthy (green)', isGreen, '#15803D'),
      bucket('Declining (amber)', isAmber, '#D9A407'),
      bucket('At risk (red)', isRed, '#C81E1E'),
    ];
  }, [data]);

  const lossReasons = useMemo(() => {
    const lost = data.filter(r => r.isClosed && !r.isWon && r.lossReason);
    const m = {};
    lost.forEach(r => {
      if (!m[r.lossReason]) m[r.lossReason] = { value: 0, ids: new Set() };
      m[r.lossReason].value += (r.amount || 0);
      m[r.lossReason].ids.add(r.id);
    });
    const sorted = Object.entries(m).sort((a, b) => b[1].value - a[1].value);
    const total = sorted.reduce((s, [, v]) => s + v.value, 0) || 1;
    let cum = 0;
    return sorted.map(([reason, metrics]) => {
      const value = metrics.value;
      cum += value;
      return { reason, value, count: metrics.ids.size, cumulative: (cum / total) * 100 };
    });
  }, [data]);

  // Share of each org type's lost deal count, by reason. Percentages within a column
  // sum to 100 — the residual is folded into a remainder row rather than dropped.
  const lossGrid = useMemo(() => {
    const orgs = [...new Set(data.map(r => r.orgType).filter(Boolean))]
      .sort((a, b) => ORG_ORDER.indexOf(a) - ORG_ORDER.indexOf(b));

    const lostBy = {};
    orgs.forEach(og => {
      lostBy[og] = data.filter(r => r.orgType === og && r.isClosed && !r.isWon);
    });

    const totals = {};
    const byReason = {};
    orgs.forEach(og => {
      totals[og] = lostBy[og].length;
      lostBy[og].forEach(r => {
        const k = r.lossReason || 'Not recorded';
        byReason[k] = byReason[k] || {};
        byReason[k][og] = (byReason[k][og] || 0) + 1;
      });
    });

    const ranked = Object.entries(byReason)
      .map(([reason, cols]) => ({
        reason, cols,
        total: Object.values(cols).reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total);

    const top = ranked;

    return { orgs, rows: top, totals };
  }, [data]);
  const winRateByOrg = useMemo(() => {
    const orgs = [...new Set(data.map(r => r.orgType).filter(Boolean))];
    return orgs.map(og => {
      const closed = data.filter(r => r.orgType === og && r.isClosed);
      const won = closed.filter(r => r.isWon);
      const avgDeal = closed.length ? closed.reduce((s, r) => s + (r.amount || 0), 0) / closed.length : 0;
      return {
        label: og,
        value: closed.length ? (won.length / closed.length) * 100 : 0,
        winRate: closed.length ? (won.length / closed.length) * 100 : 0,
        wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
        meta: `avg ${fmtCurrency(avgDeal)}`,
        color: '#0E9384',
      };
    }).sort((a, b) => ORG_ORDER.indexOf(a.label) - ORG_ORDER.indexOf(b.label));
  }, [data]);

// Renewals are a different question from new business — a lost renewal is churn.
  const renewalHealth = useMemo(() => {
    const byType = t => {
      const rows = data.filter(r => r.type === t);
      const closed = rows.filter(r => r.isClosed);
      const won = closed.filter(r => r.isWon);
      const lost = closed.filter(r => !r.isWon);
      return {
        type: t, opps: rows.length, closed: closed.length,
        winRate: closed.length ? (won.length / closed.length) * 100 : 0,
        wonValue: won.reduce((s, r) => s + (r.amount || 0), 0),
        lostValue: lost.reduce((s, r) => s + (r.amount || 0), 0),
        wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
        lostArr: lost.reduce((s, r) => s + (r.arr || 0), 0),
        openValue: rows.filter(r => !r.isClosed).reduce((s, r) => s + (r.amount || 0), 0),
      };
    };
    const types = [...new Set(data.map(r => r.type).filter(Boolean))];
    const all = types.map(byType);
    const renewal = all.find(t => /renew/i.test(t.type));
    return { all, renewal };
  }, [data]);

  const typeValue = useMemo(() =>
    renewalHealth.all.map(t => ({
      label: t.type,
      value: t.wonValue,
      meta: `${fmtPercent(t.winRate, 0)} win · ${t.closed} closed`,
      color: /renew/i.test(t.type) ? '#8B5CF6'
           : /new/i.test(t.type) ? '#0E9384' : '#3B82F6',
    })), [renewalHealth]);

  const cycleByType = useMemo(() => {
    const med = rows => {
      const v = rows.map(r => r.cycleDays).filter(x => x != null).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : 0;
    };
    return [...new Set(data.map(r => r.type).filter(Boolean))].map(t => ({
      type: t,
      won: med(data.filter(r => r.type === t && r.isWon)),
      lost: med(data.filter(r => r.type === t && r.isClosed && !r.isWon)),
      count: data.filter(r => r.type === t && r.isClosed).length,
    }));
  }, [data]);

  const atRiskPipeline = useMemo(() =>
    data.filter(r => !r.isClosed && (isRed(r) || isAmber(r)))
      .sort((a, b) => (b.amount || 0) - (a.amount || 0)), [data]);

  /* ===================== VELOCITY ===================== */
  const velocity = useMemo(() => {
    const open = data.filter(r => !r.isClosed);
    const ds = open.map(r => r.daysStuck || 0).sort((a, b) => a - b);
    const stalled = open.filter(r => r.isStalled);
    const wayOver = open.filter(r => r.staleThreshold && (r.daysStuck || 0) >= r.staleThreshold * 2);
    const avg = rows => rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.cycleDays || 0), 0) / rows.length) : 0;
    return {
      avgDays: Math.round(open.reduce((s, r) => s + (r.daysStuck || 0), 0) / (open.length || 1)),
      medianDays: ds.length ? ds[Math.floor(ds.length / 2)] : 0,
      stalledCount: stalled.length,
      stalledValue: stalled.reduce((s, r) => s + (r.amount || 0), 0),
      stalledArr: stalled.reduce((s, r) => s + (r.arr || 0), 0),
      wayOverCount: wayOver.length,
      wayOverValue: wayOver.reduce((s, r) => s + (r.amount || 0), 0),
      avgCycleWon: avg(data.filter(r => r.isWon)),
      avgCycleLost: avg(data.filter(r => r.isClosed && !r.isWon)),
    };
  }, [data]);

  const agingBuckets = useMemo(() => {
    const open = data.filter(r => !r.isClosed);
    return [
      { label: '0–30 days', min: 0, max: 30, color: '#10B981' },
      { label: '30–60 days', min: 30, max: 60, color: '#65A30D' },
      { label: '60–90 days', min: 60, max: 90, color: '#F59E0B' },
      { label: '90–180 days', min: 90, max: 180, color: '#EA580C' },
      { label: '180–365 days', min: 180, max: 365, color: '#DC2626' },
      { label: '365+ days', min: 365, max: Infinity, color: '#7F1D1D' },
    ].map(x => {
      const rows = open.filter(r => (r.daysStuck || 0) >= x.min && (r.daysStuck || 0) < x.max);
      return { label: x.label, color: x.color,
               value: rows.reduce((s, r) => s + (r.amount || 0), 0), meta: `${rows.length} deals` };
    });
  }, [data]);

  const daysByStage = useMemo(() =>
    STAGE_ORDER.map(s => {
      const rows = data.filter(r => r.stage === s && !r.isClosed);
      return {
        label: s, color: STAGE_COLORS[s] || '#64748B',
        value: rows.length ? Math.round(rows.reduce((sum, r) => sum + (r.daysStuck || 0), 0) / rows.length) : 0,
        meta: `${rows.length} open`, count: rows.length,
      };
    }).filter(x => x.count > 0), [data]);

  const cycleBands = useMemo(() => {
    const bands = [[0,30,'0–30 d'],[30,60,'30–60 d'],[60,90,'60–90 d'],[90,120,'90–120 d'],[120,Infinity,'120+ d']];
    return bands.map(([min, max, label]) => {
      const closed = data.filter(r => r.isClosed && r.cycleDays >= min && r.cycleDays < max);
      const won = closed.filter(r => r.isWon);
      return { label, won: won.length, lost: closed.length - won.length,
               winRate: closed.length ? (won.length / closed.length) * 100 : 0 };
    });
  }, [data]);

  const cycleByOrg = useMemo(() => {
    const orgs = [...new Set(data.map(r => r.orgType).filter(Boolean))];
    const med = rows => {
      const v = rows.map(r => r.cycleDays).filter(x => x != null).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : 0;
    };
    return orgs.map(og => ({
      org: og,
      won: med(data.filter(r => r.orgType === og && r.isWon)),
      lost: med(data.filter(r => r.orgType === og && r.isClosed && !r.isWon)),
    })).sort((a, b) => ORG_ORDER.indexOf(a.org) - ORG_ORDER.indexOf(b.org));
  }, [data]);

  const stalledDeals = useMemo(() =>
    data.filter(r => r.isStalled)
      .sort((a, b) => (b.daysStuck || 0) - (a.daysStuck || 0)), [data]);

  /* ===================== WHERE WE WIN ===================== */
  const heatRegions = useMemo(() =>
    [...new Set(data.map(r => r.region).filter(Boolean))].sort(), [data]);

  const heatOrgs = useMemo(() => {
    const found = [...new Set(data.map(r => r.orgType).filter(Boolean))];
    return ORG_ORDER.filter(o => found.includes(o)).concat(found.filter(o => !ORG_ORDER.includes(o)));
  }, [data]);

  const heatCell = useMemo(() => (region, org) => {
    const closed = data.filter(r => r.region === region && r.orgType === org && r.isClosed);
    const won = closed.filter(r => r.isWon);
    return { count: closed.length, value: closed.length ? (won.length / closed.length) * 100 : 0 };
  }, [data]);

  const productPortfolio = useMemo(() => {
    const products = [...new Set(data.flatMap(r => splitProducts(r.product)))];
    return products.map(pr => {
      const rows = data.filter(r => splitProducts(r.product).includes(pr));
      const closed = rows.filter(r => r.isClosed);
      const won = closed.filter(r => r.isWon);
      const rate = closed.length ? (won.length / closed.length) * 100 : 0;
      return {
        label: pr,
        value: rows.reduce((s, r) => s + (r.amount || 0), 0),
        meta: `${fmtPercent(rate, 0)} win · ${rows.length} opps · ${closed.length} closed`,
        color: rate >= 50 ? '#15803D' : rate >= 35 ? '#D9A407' : '#C81E1E',
      };
    });
  }, [data]);

  const leadSource = useMemo(() => {
    const sources = [...new Set(data.map(r => r.source).filter(Boolean))];
    return sources.map(sr => {
      const closed = data.filter(r => r.source === sr && r.isClosed);
      const won = closed.filter(r => r.isWon);
      const rate = closed.length ? (won.length / closed.length) * 100 : 0;
      return {
        label: sr,
        value: won.reduce((s, r) => s + (r.amount || 0), 0),
        meta: `${fmtPercent(rate, 0)} win · ${closed.length} closed`,
        color: '#3B82F6',
      };
    });
  }, [data]);

  const industryScorecard = useMemo(() => {
    const inds = [...new Set(data.map(r => r.industry).filter(Boolean))];
    return inds.map(ind => {
      const closed = data.filter(r => r.industry === ind && r.isClosed);
      const won = closed.filter(r => r.isWon);
      return {
        industry: ind, closed: closed.length,
        winRate: closed.length ? (won.length / closed.length) * 100 : 0,
        wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
        lostArr: closed.filter(r => !r.isWon).reduce((s, r) => s + (r.arr || 0), 0),
        wonValue: won.reduce((s, r) => s + (r.amount || 0), 0),
        lostValue: closed.filter(r => !r.isWon).reduce((s, r) => s + (r.amount || 0), 0),
      };
    }).filter(r => r.closed >= 3);
  }, [data]);

  const whereWeWin = useMemo(() => {
    const empty = { label: '—', wonArr: 0, winRate: 0 };
    const best = arr => arr.length ? [...arr].sort((a, b) =>
      b.wonArr - a.wonArr || b.winRate - a.winRate)[0] : empty;
    const weakest = arr => arr.length ? [...arr].sort((a, b) =>
      a.wonArr - b.wonArr || a.winRate - b.winRate)[0] : empty;
    const orgs = winRateByOrg.map(x => ({ label: x.label, wonArr: x.wonArr, winRate: x.winRate }));
    const inds = industryScorecard.map(x => ({ label: x.industry, wonArr: x.wonArr, winRate: x.winRate }));
    return {
      bestOrg: best(orgs),
      bestIndustry: best(inds),
      weakestIndustry: weakest(inds),
      industriesTracked: new Set(data.map(r => r.industry).filter(Boolean)).size,
      rankable: industryScorecard.length,
    };
  }, [winRateByOrg, industryScorecard, data]);

  /* ===================== REP PERFORMANCE ===================== */
  const repStats = useMemo(() => {
    const reps = [...new Set(data.map(r => r.owner).filter(Boolean))];
    return reps.map(rep => {
      const rows = data.filter(r => r.owner === rep);
      const closed = rows.filter(r => r.isClosed);
      const won = closed.filter(r => r.isWon);
      const cycles = closed.map(r => r.cycleDays).filter(x => x != null).sort((a, b) => a - b);
      return {
        rep, pod: rows[0]?.pod || '—',
        closed: closed.length, wins: won.length,
        winRate: closed.length ? (won.length / closed.length) * 100 : 0,
        booked: won.reduce((s, r) => s + (r.amount || 0), 0),
        openValue: rows.filter(r => !r.isClosed).reduce((s, r) => s + (r.amount || 0), 0),
        stalled: rows.filter(r => r.isStalled).length,
        avgCycle: cycles.length ? cycles[Math.floor(cycles.length / 2)] : 0,
      };
    });
  }, [data]);

  const repSummary = useMemo(() => {
    const rates = repStats.map(r => r.winRate).sort((a, b) => a - b);
    const byBooked = [...repStats].sort((a, b) => b.booked - a.booked);
    const qualified = repStats.filter(r => r.closed >= 3).sort((a, b) => b.winRate - a.winRate);
    return {
      activeReps: repStats.length,
      medianWinRate: rates.length ? rates[Math.floor(rates.length / 2)] : 0,
      spread: rates.length ? `${rates[0].toFixed(0)}–${rates[rates.length - 1].toFixed(0)}%` : '—',
      topByWinRate: qualified[0],
      topByBookings: byBooked[0],
    };
  }, [repStats]);

  const podPerformance = useMemo(() => {
    const pods = [...new Set(data.map(r => r.pod).filter(Boolean))];
    return pods.map(p => {
      const rows = data.filter(r => r.pod === p);
      const closed = rows.filter(r => r.isClosed);
      const won = closed.filter(r => r.isWon);
      return {
        pod: p, opps: rows.length, closed: closed.length,
        wins: won.length, losses: closed.length - won.length,
        winRate: closed.length ? (won.length / closed.length) * 100 : 0,
        wonArr: won.reduce((s, r) => s + (r.arr || 0), 0),
        lostArr: closed.filter(r => !r.isWon).reduce((s, r) => s + (r.arr || 0), 0),
        openArr: rows.filter(r => !r.isClosed).reduce((s, r) => s + (r.arr || 0), 0),
      };
    }).sort((a, b) => b.wonArr - a.wonArr);
  }, [data]);

  const winRateByPod = useMemo(() =>
    podPerformance.map(p => ({
      label: p.pod, value: p.winRate,
      meta: `${p.closed} closed · ${p.wins} won · ${p.losses} lost`,
      color: p.winRate >= 50 ? '#15803D' : p.winRate >= 35 ? '#D9A407' : '#C81E1E',
    })), [podPerformance]);

  /* ===================== ACCOUNTS ===================== */
  const accountMap = useMemo(() => {
    const m = new Map();
    data.forEach(r => {
      if (!r.accountId) return;
      if (!m.has(r.accountId)) m.set(r.accountId, {
        accountId: r.accountId, account: r.account || r.accountId, industry: r.industry, orgType: r.orgType,
        opps: 0, wins: 0, losses: 0, open: 0,
        openValue: 0, wonValue: 0, lostValue: 0, reps: new Set(),
      });
      const a = m.get(r.accountId);
      a.opps++; a.reps.add(r.owner);
      if (r.isWon) { a.wins++; a.wonValue += (r.amount || 0); }
      else if (r.isClosed) { a.losses++; a.lostValue += (r.amount || 0); }
      else { a.open++; a.openValue += (r.amount || 0); }
    });
    return [...m.values()];
  }, [data]);

  const accounts = useMemo(() => {
    const wonAccts = accountMap.filter(a => a.wins > 0);
    const repeatLoss = accountMap.filter(a => a.losses >= 2 && a.wins === 0);
    const expansion = accountMap.filter(a => a.wins > 0 && a.openValue > 0);
    return {
      total: accountMap.length,
      multi: accountMap.filter(a => a.opps > 1).length,
      won: wonAccts.length,
      repeatLoss: repeatLoss.length,
      repeatLossValue: repeatLoss.reduce((s, a) => s + a.lostValue, 0),
      expansion: expansion.length,
      expansionValue: expansion.reduce((s, a) => s + a.openValue, 0),
      oppsPerAccount: accountMap.length
        ? accountMap.reduce((s, a) => s + a.opps, 0) / accountMap.length : 0,
      valuePerWon: wonAccts.length
        ? wonAccts.reduce((s, a) => s + a.wonValue, 0) / wonAccts.length : 0,
    };
  }, [accountMap]);

  const accountOutcome = useMemo(() => {
    let wonNoOpen = 0, wonExpansion = 0, repeatLoss = 0, singleLoss = 0, openOnly = 0;
    accountMap.forEach(a => {
      if (a.wins > 0 && a.open === 0) wonNoOpen++;
      else if (a.wins > 0) wonExpansion++;
      else if (a.losses >= 2) repeatLoss++;
      else if (a.losses === 1) singleLoss++;
      else openOnly++;
    });
    return [
      { label: 'Won, no open pipeline', value: wonNoOpen, color: '#047857' },
      { label: 'Won, expansion in play', value: wonExpansion, color: '#10B981' },
      { label: 'Repeat loss, no win', value: repeatLoss, color: '#DC2626' },
      { label: 'Single loss only', value: singleLoss, color: '#F59E0B' },
      { label: 'Open, never closed', value: openOnly, color: '#3B82F6' },
    ];
  }, [accountMap]);

  const oppsPerAccountBands = useMemo(() => {
    const buckets = { '1 opp': [], '2 opps': [], '3 opps': [], '4+ opps': [] };
    accountMap.forEach(a => {
      const k = a.opps === 1 ? '1 opp' : a.opps === 2 ? '2 opps' : a.opps === 3 ? '3 opps' : '4+ opps';
      buckets[k].push(a);
    });
    return Object.entries(buckets).map(([bucket, arr]) => ({
      bucket, accounts: arr.length,
      winRate: arr.length
        ? (arr.reduce((s, a) => s + a.wins, 0) / arr.reduce((s, a) => s + a.opps, 0)) * 100 : 0,
    }));
  }, [accountMap]);

  const repeatLossAccounts = useMemo(() =>
    accountMap.filter(a => a.losses >= 2 && a.wins === 0)
      .map(a => ({ ...a, repsTried: a.reps.size }))
      .sort((a, b) => b.lostValue - a.lostValue), [accountMap]);

  const expansionCandidates = useMemo(() =>
    accountMap.filter(a => a.wins > 0 && a.open > 0)
      .sort((a, b) => b.openValue - a.openValue), [accountMap]);

  /* ===================== CHART.JS ===================== */
  const axis = useMemo(() => {
    const a = timeAxis(data.map(r => r.closeDate?.slice(0, 7)), { force: grain });
    const has = p => data.some(r => a.matches(r.closeDate?.slice(0, 7), p) && r.isClosed);
    return { ...a, periods: trimEmpty(a.periods, has) };
  }, [data, grain]);

  // A combined created/closed chart needs one visible reporting window. If only
  // one date range is selected, apply it to both series; when both are selected,
  // each series keeps its explicitly selected range.
  const pipelineCreatedRows = useMemo(() => {
    const from = filters.createdFrom || filters.closeFrom;
    const to = filters.createdTo || filters.closeTo;
    return data.filter(r => r.createdDate
      && (!from || r.createdDate >= from)
      && (!to || r.createdDate <= to));
  }, [data, filters.createdFrom, filters.createdTo, filters.closeFrom, filters.closeTo]);

  const pipelineClosedRows = useMemo(() => {
    const from = filters.closeFrom || filters.createdFrom;
    const to = filters.closeTo || filters.createdTo;
    return data.filter(r => r.isClosed && r.closeDate
      && (!from || r.closeDate >= from)
      && (!to || r.closeDate <= to));
  }, [data, filters.createdFrom, filters.createdTo, filters.closeFrom, filters.closeTo]);

  const createdAxis = useMemo(() => {
    const a = timeAxis([
      ...pipelineCreatedRows.map(r => r.createdDate?.slice(0, 7)),
      ...pipelineClosedRows.map(r => r.closeDate?.slice(0, 7)),
    ], { force: grain });
    const has = p => pipelineCreatedRows.some(r => a.matches(r.createdDate?.slice(0, 7), p))
      || pipelineClosedRows.some(r => a.matches(r.closeDate?.slice(0, 7), p));
    return { ...a, periods: trimEmpty(a.periods, has) };
  }, [pipelineCreatedRows, pipelineClosedRows, grain]);

  useEffect(() => {
    const redraw = () => setThemeVersion(v => v + 1);
    window.addEventListener('themechange', redraw);
    return () => window.removeEventListener('themechange', redraw);
  }, []);

  useEffect(() => {
    if (loading) return;
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
      const P = axis.periods;
      mk(bookingsRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: P.map(axis.label),
          datasets: [
            { label: 'Bookings', order: 2, backgroundColor: '#10B981', borderRadius: 4,
              valueFormat: fmtCurrency,
              data: P.map(p => data.filter(r => axis.matches(r.closeDate?.slice(0, 7), p) && r.isWon)
                .reduce((s, r) => s + (r.amount || 0), 0)) },
            { label: 'Win rate', type: 'line', order: 1, yAxisID: 'y1',
              borderColor: '#2F8C88', backgroundColor: '#2F8C88', tension: .3, pointRadius: 3,
              valueFormat: v => `${v.toFixed(0)}%`,
              data: P.map(p => {
                const c = data.filter(r => axis.matches(r.closeDate?.slice(0, 7), p) && r.isClosed);
                return c.length ? (c.filter(r => r.isWon).length / c.length) * 100 : 0;
              }) },
          ],
        },
        options: baseOptions({ percentRight: true }),
      });

      const C = createdAxis.periods;
      mk(pipelineRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: C.map(createdAxis.label),
          datasets: [
            { label: 'Created', backgroundColor: '#3B82F6', borderRadius: 4, valueFormat: fmtCurrency,
              data: C.map(p => pipelineCreatedRows.filter(r => createdAxis.matches(r.createdDate?.slice(0, 7), p))
                .reduce((s, r) => s + (r.amount || 0), 0)) },
            { label: 'Closed out', backgroundColor: '#94A3B8', borderRadius: 4, valueFormat: fmtCurrency,
              data: C.map(p => pipelineClosedRows.filter(r => createdAxis.matches(r.closeDate?.slice(0, 7), p))
                .reduce((s, r) => s + (r.amount || 0), 0)) },
          ],
        },
        options: baseOptions(),
      });
    }

    if (tab === 'diagnostics') {
      const lossParetoOptions = baseOptions({ percentRight: true });
      lossParetoOptions.scales.x.ticks = {
        ...lossParetoOptions.scales.x.ticks,
        autoSkip: false,
        minRotation: 0,
        maxRotation: 0,
        padding: 8,
      };
      lossParetoOptions.plugins.tooltip.callbacks = {
        title: contexts => lossReasons[contexts[0]?.dataIndex]?.reason || '',
        afterLabel: context => context.dataset.label === 'Value lost'
          ? `Distinct opportunities: ${fmtNumber(lossReasons[context.dataIndex]?.count || 0)}`
          : '',
      };
      mk(lossParetoRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: lossReasons.map(r => wrapAxisLabel(r.reason)),
          datasets: [
            { label: 'Value lost', order: 2, backgroundColor: '#CF5D70',
              borderColor: '#D97A8A', borderWidth: 1, borderRadius: 5,
              valueFormat: fmtCurrency,
              secondaryData: lossReasons.map(r => r.count),
              secondaryFormat: count => `${fmtNumber(count)} opps`,
              data: lossReasons.map(r => r.value) },
            { label: 'Cumulative', type: 'line', order: 1, yAxisID: 'y1',
              borderColor: '#4F76B5', backgroundColor: '#4F76B5', tension: .3,
              pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: chartSurface,
              pointBorderColor: '#4F76B5', pointBorderWidth: 2,
              valueFormat: v => `${v.toFixed(0)}%`, data: lossReasons.map(r => r.cumulative) },
          ],
        },
        options: lossParetoOptions,
      });

      
    }

    if (tab === 'velocity') {
      mk(cycleWonLostRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: cycleBands.map(b => b.label),
          datasets: [
            { label: 'Won', backgroundColor: '#10B981', borderRadius: 4, data: cycleBands.map(b => b.won) },
            { label: 'Lost', backgroundColor: '#DC2626', borderRadius: 4, data: cycleBands.map(b => b.lost) },
          ],
        },
        options: baseOptions(),
      });

      mk(cycleWinRateRef, 'line', {
        plugins: [valueLabels],
        data: {
          labels: cycleBands.map(b => b.label),
          datasets: [{
            label: 'Win rate', borderColor: '#4F76B5', backgroundColor: 'rgba(79,118,181,.12)',
            fill: true, tension: .3, pointRadius: 4,
            valueFormat: v => `${v.toFixed(0)}%`, data: cycleBands.map(b => b.winRate),
          }],
        },
        options: baseOptions(),
      });
    }

    if (tab === 'repperformance') {
      const median = repSummary.medianWinRate;
      const base = baseOptions();
      const plottedReps = repStats
        .filter(r => r.closed > 0 && r.wins > 0 && r.booked > 0)
        .map(r => {
          const avgWonDeal = Math.max(1, r.booked / r.wins);
          return { ...r, avgWonDeal, dealSizeLog: Math.log10(avgWonDeal) };
        });
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
          ctx.save();
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = '#94A3B8';
          ctx.lineWidth = 1;
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
            data: [{ x: r.dealSizeLog, y: r.winRate,
              r: Math.max(5, Math.min(18, 4 + Math.sqrt(r.closed) * 1.8)) }],
            backgroundColor: r.winRate >= median && r.avgWonDeal >= medianDealSize
              ? 'rgba(14,147,132,.76)'
              : r.winRate >= median ? 'rgba(79,118,181,.74)'
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
              label: c => {
                const rep = plottedReps[c.datasetIndex];
                return [`Win rate: ${rep.winRate.toFixed(1)}%`,
                  `Average won deal: ${fmtCurrency(rep.avgWonDeal)}`,
                  `Closed deals: ${rep.closed}`, `Booked value: ${fmtCurrency(rep.booked)}`];
              } } },
          },
          scales: {
            x: { type: 'linear', min: minDealLog, max: maxDealLog,
                 title: { display: true, text: 'Average won deal size (log scale)', font: { size: 11 } },
                 grid: { color: chartGrid },
                 ticks: { stepSize: 1, color: chartTick, callback: v => fmtCurrency(10 ** v), font: { size: 10 } } },
            y: { min: 0, max: 100, title: { display: true, text: 'Win rate %', font: { size: 11 } },
                 grid: { color: chartGrid }, ticks: { color: chartTick, callback: v => `${v}%`, font: { size: 10.5 } } },
          },
        },
      });
    }

    if (tab === 'accounts') {
      mk(oppsPerAccountRef, 'bar', {
        plugins: [valueLabels],
        data: {
          labels: oppsPerAccountBands.map(b => b.bucket),
          datasets: [
            { label: 'Accounts', order: 2, backgroundColor: 'rgba(109,130,166,.78)',
              borderColor: '#8296B5', borderWidth: 1, borderRadius: 6,
              data: oppsPerAccountBands.map(b => b.accounts) },
            { label: 'Win rate', type: 'line', order: 1, yAxisID: 'y1',
              borderColor: '#2F8C88', backgroundColor: '#2F8C88', tension: .32,
              pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: chartSurface,
              pointBorderColor: '#63AAA6', pointBorderWidth: 2,
              valueFormat: v => `${v.toFixed(0)}%`, data: oppsPerAccountBands.map(b => b.winRate) },
          ],
        },
        options: baseOptions({ percentRight: true }),
      });
    }

    return () => charts.forEach(c => c.destroy());
  }, [data, tab, loading, axis, createdAxis, pipelineCreatedRows, pipelineClosedRows, lossReasons, cycleBands,
      repStats, repSummary, oppsPerAccountBands, themeVersion]);

  const updateFilter = (k, v) => setFilters(s => ({ ...s, [k]: v }));
  const startPresentation = scope => {
    const tableTops = {
      largestOpen: largestSort.top, atRisk: riskSort.top,
      cycleOrg: cycleOrgSort.top, cycleType: cycleTypeSort.top,
      stalled: stalledSort.top, industry: indSort.top, pod: podSort.top,
      reps: repSort.top, repeatLoss: repeatLossSort.top, expansion: expansionSort.top,
    };
    const presentationSettings = { scope, view: tab };
    localStorage.setItem('testmu-presentation-config', JSON.stringify({ templateId, filters, scope, view: tab, tableTops }));
    saveDashboardState(templateId, { view: tab, filters, tableTops, presentationSettings }).catch(() => {});
    setPresentMenuOpen(false);
    window.open(`/present/${templateId}`, '_blank', 'noopener');
  };
  const activeFilterCount = Object.entries(filters).reduce((count, [, value]) =>
    count + (Array.isArray(value) ? (value.length ? 1 : 0) : (value ? 1 : 0)), 0);
  const repSort = useTableSort('booked');
  const indSort = useTableSort('wonArr');
  const largestSort = useTableSort('amount');
  const riskSort = useTableSort('amount');
  const cycleOrgSort = useTableSort('won');
  const cycleTypeSort = useTableSort('won');
  const stalledSort = useTableSort('daysStuck');
  const podSort = useTableSort('wonArr');
  const repeatLossSort = useTableSort('lostValue');
  const expansionSort = useTableSort('openValue');
  const currentConfiguration = () => ({view:tab,filters,tableTops:{
    largestOpen:largestSort.top,atRisk:riskSort.top,cycleOrg:cycleOrgSort.top,cycleType:cycleTypeSort.top,
    stalled:stalledSort.top,industry:indSort.top,pod:podSort.top,reps:repSort.top,
    repeatLoss:repeatLossSort.top,expansion:expansionSort.top}});
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
    if(config.view)setTab(config.view); if(config.filters)setFilters({...EMPTY_FILTERS,...config.filters});
    const tables={largestOpen:largestSort,atRisk:riskSort,cycleOrg:cycleOrgSort,cycleType:cycleTypeSort,
      stalled:stalledSort,industry:indSort,pod:podSort,reps:repSort,repeatLoss:repeatLossSort,expansion:expansionSort};
    Object.entries(config.tableTops||{}).forEach(([key,value])=>tables[key]?.setTop(value));
  };

  useEffect(() => {
    if (!stateHydrated || tableStateRestored.current) return;
    const saved = persistedStateRef.current;
    const tables = {
      largestOpen: largestSort, atRisk: riskSort, cycleOrg: cycleOrgSort,
      cycleType: cycleTypeSort, stalled: stalledSort, industry: indSort,
      pod: podSort, reps: repSort, repeatLoss: repeatLossSort, expansion: expansionSort,
    };
    Object.entries(tables).forEach(([key, table]) => {
      if (Object.prototype.hasOwnProperty.call(saved.tableTops || {}, key)) table.setTop(saved.tableTops[key]);
      if (saved.tableSorting?.[key]) table.setSort(saved.tableSorting[key]);
    });
    tableStateRestored.current = true;
  }, [stateHydrated]);

  useEffect(() => {
    if (!stateHydrated || !tableStateRestored.current) return;
    const timer = setTimeout(() => {
      const tableTops = {
        largestOpen: largestSort.top, atRisk: riskSort.top, cycleOrg: cycleOrgSort.top,
        cycleType: cycleTypeSort.top, stalled: stalledSort.top, industry: indSort.top,
        pod: podSort.top, reps: repSort.top, repeatLoss: repeatLossSort.top, expansion: expansionSort.top,
      };
      const tableSorting = {
        largestOpen: largestSort.sort, atRisk: riskSort.sort, cycleOrg: cycleOrgSort.sort,
        cycleType: cycleTypeSort.sort, stalled: stalledSort.sort, industry: indSort.sort,
        pod: podSort.sort, reps: repSort.sort, repeatLoss: repeatLossSort.sort, expansion: expansionSort.sort,
      };
      const state = { templateId, view: tab, filters, tableTops, tableSorting };
      localStorage.setItem(`testmu-dashboard-state-${templateId}`, JSON.stringify(state));
      saveDashboardState(templateId, state).catch(error => console.error('dashboard state save', error));
    }, 500);
    return () => clearTimeout(timer);
  }, [stateHydrated, templateId, tab, filters,
    largestSort.top, riskSort.top, cycleOrgSort.top, cycleTypeSort.top, stalledSort.top,
    indSort.top, podSort.top, repSort.top, repeatLossSort.top, expansionSort.top,
    largestSort.sort, riskSort.sort, cycleOrgSort.sort, cycleTypeSort.sort, stalledSort.sort,
    indSort.sort, podSort.sort, repSort.sort, repeatLossSort.sort, expansionSort.sort]);

  return (
    <div className="wrap">
      <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
        <div className="brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/gallery')}>
          <img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI" />
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

      <header className="top">
        <div className="top-row">
          <div>
            <h1>Opportunity Analytics — TestMu BI</h1>
            <div className="sub">
              {fmtNumber(data.length)} opportunities · {new Set(data.map(r => r.accountId).filter(Boolean)).size} accounts
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
          {[
            { key: 'region', label: 'Region', opts: options.region },
            { key: 'orgType', label: 'Org type', opts: options.orgType },
            { key: 'stage', label: 'Stage', opts: options.stage },
            { key: 'owner', label: 'Owner', opts: options.owner },
            { key: 'source', label: 'Source', opts: options.source },
            { key: 'type', label: 'Opportunity type', opts: options.type },
          ].map(f => (
            <MultiSelect
              key={f.key}
              label={f.label}
              options={f.opts}
              value={filters[f.key]}
              onChange={value => updateFilter(f.key, value)}
            />
          ))}
          <DateRangeFilter filters={filters} setFilters={setFilters} />
          <button className="btn-reset" onClick={() => setFilters(EMPTY_FILTERS)}>Reset all</button>
          <div className="scope">Showing <b>{fmtNumber(data.length)}</b> opportunities</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t, i) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="num">{i + 1}</span>{t.label}
          </button>
        ))}
      </nav>

      {loading && <AppLoader label="Fetching data…" />}

      {/* ---------- PULSE ---------- */}
      {!loading && tab === 'pulse' && (
        <>
          <div className="intro">
            <h2>What's going on</h2>
            <p>Headline state of the business: pipeline volume and value, conversion through the funnel, and the bookings trend over time.</p>
          </div>

          <div className="kpis">
            <Kpi tone="blue" label="Total Opportunities" value={fmtCompact(data.length)} foot="all deals, open and closed" />
            <Kpi tone="teal" label="Open Opportunities" value={fmtCompact(pulse.openCount)} foot="deals still in progress" />
            <Kpi tone="violet" label="Weighted Forecast" value={fmtCurrency(pulse.weighted)}
              foot={`${Math.round((pulse.weighted / (pulse.openPipeline || 1)) * 100)}% of open value`} />
            <Kpi tone="green" label="Win Rate" value={fmtPercent(pulse.winRate)} foot={`${pulse.wonCount} of ${pulse.closedCount} closed`} />
            <Kpi tone="blue" label="Open ARR" value={fmtCurrency(pulse.openArr)} foot="annualised, still in play" />
            <Kpi tone="teal" label="Won ARR" value={fmtCurrency(pulse.wonArr)} foot="annualised, booked" />
            <Kpi tone="amber" label="Avg Sales Cycle" value={fmtDays(pulse.avgCycle)} foot="creation to close" />
          </div>

          <div className="g21">
            <ChartCard title="Stage funnel — open pipeline" hint="Value and count per open stage, in sequence.">
              <div className="funnel">
                {funnelData.map(f => (
                  <div className="fstep" key={f.stage}>
                    <div className="fname">{f.stage}</div>
                    <div className="ftrack">
                      <div className="ffill" style={{
                        width: `${Math.max(5, (f.value / (funnelData[0]?.value || 1)) * 100)}%`,
                        background: STAGE_COLORS[f.stage],
                      }}>{fmtCurrency(f.value)}</div>
                    </div>
                    <div className="fmeta">{f.count} deals</div>
                  </div>
                ))}
              </div>
              <div className="card-foot">
                Total open {fmtCurrency(pulse.openPipeline)} · Weighted {fmtCurrency(pulse.weighted)}
              </div>
            </ChartCard>

            <ChartCard title="Outcome mix" hint="Every opportunity by current or final state.">
              <Donut data={outcomeMix} centerLabel="opportunities" format={fmtNumber} />
            </ChartCard>
          </div>

          <div className="g2">
            <ChartCard title="Bookings & win rate"
              hint={`Closed-won value against win rate, by ${axis.granularity}.`}
              controls={<GrainToggle grain={grain} setGrain={setGrain} auto={axis.granularity} />}>
              <ChartScroll count={axis.periods.length}>
                <canvas ref={bookingsRef} />
              </ChartScroll>
            </ChartCard>
            <ChartCard title="Pipeline created vs. closed" hint={`New value created against value closed out, by ${createdAxis.granularity}.`}>
              <ChartScroll count={createdAxis.periods.length}>
                <canvas ref={pipelineRef} />
              </ChartScroll>
            </ChartCard>
          </div>

          <div className="g2 pulse-open-row">
            <ChartCard title="Region performance" hint="Closed-won value by region.">
              <NeonColumns data={regionPerformance.map((d, i) => ({ ...d,
                color: seriesColor(i) }))} format={fmtCurrency} />
            </ChartCard>

            <ChartCard title="Largest open opportunities" hint="All open opportunities; click any column heading to sort." controls={<TableTopControl table={largestSort} count={largestOpen.length} />}>
              <div className="scroll open-opportunities-scroll">
                <table className="open-opportunities-table">
                  <colgroup><col /><col /><col /><col /><col /></colgroup>
                  <thead><tr><Th label="Opportunity" sortKey="name" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Stage" sortKey="stage" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Owner" sortKey="owner" sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Value" sortKey="amount" numeric sort={largestSort.sort} onSort={largestSort.onSort} /><Th label="Idle" sortKey="daysStuck" numeric sort={largestSort.sort} onSort={largestSort.onSort} /></tr></thead>
                  <tbody>
                    {largestSort.apply(largestOpen).map((r, i) => (
                      <tr key={r.id}>
                        <td title={r.name}><span className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</span><span className="cell-ellipsis">{r.name}</span></td>
                        <td><Pill tone="info">{r.stage}</Pill></td>
                        <td title={r.owner}><span className="cell-ellipsis">{r.owner}</span></td>
                        <td className="n mono">{fmtCurrency(r.amount)}</td>
                        <td className="n mono" style={{ color: r.isStalled ? 'var(--red)' : 'inherit' }}>{r.daysStuck}d</td>
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
      {!loading && tab === 'diagnostics' && (
        <>
          <div className="intro">
            <h2>What's going wrong</h2>
            <p>Red means intervene now; amber means the trend is wrong but there is still time.</p>
          </div>

          <div className="kpis">
            <Kpi tone="red" label="Value Lost" value={fmtCurrency(diagnostics.valueLost)} foot={`${diagnostics.lostCount} lost opportunities`} />
            <Kpi tone="red" label="Loss Rate" value={fmtPercent(diagnostics.lossRate)} foot="share of closed deals lost" />
            <Kpi tone="red" label="At Risk — Red" value={fmtCurrency(diagnostics.redValue)} foot={`${diagnostics.redCount} deals · ${fmtCurrency(diagnostics.redArr)} ARR`} />
            <Kpi tone="amber" label="Declining — Amber" value={fmtCurrency(diagnostics.amberValue)} foot={`${diagnostics.amberCount} deals · ${fmtCurrency(diagnostics.amberArr)} ARR`} />
            <Kpi tone="violet" label="Disengagement Losses" value={fmtPercent(diagnostics.disengagement, 0)} foot="lost to no-decision reasons" />
            <Kpi tone="red" label="Renewal ARR Lost"
              value={fmtCurrency(renewalHealth.renewal?.lostArr || 0)}
              foot={renewalHealth.renewal
                ? `${fmtPercent(100 - renewalHealth.renewal.winRate, 0)} of renewals churned`
                : 'no renewal deals in scope'} />
            <Kpi tone="blue" label="Avg Days to Lose" value={fmtDays(diagnostics.avgDaysToLose)} foot="time spent before the loss" />
          </div>

          <div className="g2">
            <ChartCard title="Open ARR by deal health" hint="How much recurring revenue sits in each health state.">
              <ConcentricRings data={healthByArr} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Win rate by org type" hint="Conversion against average deal size.">
              <MetricGauges data={winRateByOrg.map((d, i) => ({ ...d,
                color: seriesColor(i) }))} format={v => fmtPercent(v, 1)} />
            </ChartCard>
          </div>


          <div className="g2">
            <ChartCard title="Loss reasons by value lost"
              hint="Bars are value; the line is cumulative share. Left of 80% is where to focus.">
              <ChartScroll count={lossReasons.length} perItem={150} height={330}>
                <canvas ref={lossParetoRef} />
              </ChartScroll>
            </ChartCard>

          <ChartCard title="Loss reason concentration"
              hint="Share of each org type's lost deals. Read down a column — the percentages sum to 100.">
            <div className="loss-heatmap-scroll">
              <Heatmap
                rows={lossGrid.rows.map(r => r.reason)}
                cols={lossGrid.orgs}
                format={v => `${v.toFixed(0)}%`}
                bands={[
                  { max: 10, bg: '#20365F', label: '<10%' },
                  { max: 20, bg: '#17658A', label: '10–20%' },
                  { max: 30, bg: '#009EB2', label: '20–30%' },
                  { max: 45, bg: '#F59E0B', label: '30–45%' },
                  { max: Infinity, bg: '#F43F5E', label: '>45%' },
                ]}
                cell={(reason, org) => {
                  const row = lossGrid.rows.find(r => r.reason === reason);
                  const total = lossGrid.totals[org] || 0;
                  const v = row?.cols[org] || 0;
                  return { count: v, value: total ? (v / total) * 100 : 0 };
                }}
              />
            </div>
            </ChartCard>
            </div>
          <ChartCard title="At-risk open pipeline" style={{ marginTop: 16 }}
            hint="Red and amber deals, largest first — the intervention list." controls={<TableTopControl table={riskSort} count={atRiskPipeline.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Opportunity" sortKey="name" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Health" sortKey="dealHealth" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Stage" sortKey="stage" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Owner" sortKey="owner" sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Value" sortKey="amount" numeric sort={riskSort.sort} onSort={riskSort.onSort} /><Th label="Idle" sortKey="daysStuck" numeric sort={riskSort.sort} onSort={riskSort.onSort} /></tr></thead>
                <tbody>
                  {riskSort.apply(atRiskPipeline).map(r => (
                    <tr key={r.id} className={isRed(r) ? 'sev-high' : 'sev-med'}>
                      <td>{r.name}</td>
                      <td><Pill tone={healthTone(r.dealHealth)}>{r.dealHealth}</Pill></td>
                      <td>{r.stage}</td>
                      <td>{r.owner}</td>
                      <td className="n mono">{fmtCurrency(r.amount)}</td>
                      <td className="n mono" style={{ color: 'var(--red)' }}>{r.daysStuck}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- VELOCITY ---------- */}
      {!loading && tab === 'velocity' && (
        <>
          <div className="intro">
            <h2>Velocity & aging</h2>
            <p>Stale thresholds vary by org type — 90 days Enterprise, 30 Mid-Market, 15 SMB — because deal rhythms differ. A deal is stalled once it passes its own threshold, not a flat number.</p>
          </div>

          <div className="kpis">
            <Kpi tone="blue" label="Avg Days in Stage" value={fmtDays(velocity.avgDays)} foot="across open pipeline" />
            <Kpi tone="blue" label="Median Days in Stage" value={fmtDays(velocity.medianDays)} foot="half the pipeline is older" />
            <Kpi tone="red" label="Stalled" value={fmtNumber(velocity.stalledCount)} foot={`past threshold · ${fmtCurrency(velocity.stalledValue)}`} />
            <Kpi tone="red" label="Stalled ARR" value={fmtCurrency(velocity.stalledArr)} foot="recurring revenue at a standstill" />
            <Kpi tone="red" label="Twice Over Threshold" value={fmtNumber(velocity.wayOverCount)} foot={`effectively dormant · ${fmtCurrency(velocity.wayOverValue)}`} />
            <Kpi tone="teal" label="Avg Cycle — Won" value={fmtDays(velocity.avgCycleWon)} foot={`lost deals take ${velocity.avgCycleLost} d`} />
          </div>

          <div className="g2">
            <ChartCard title="Aging profile of open pipeline" hint="Open value by how long each deal has sat in its current stage.">
              <NeonColumns data={agingBuckets} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Average days in stage, by stage" hint="The bottleneck is wherever this bar is longest.">
              <LollipopList data={daysByStage} format={fmtDays} />
            </ChartCard>
          </div>

          <div className="g2">
            <ChartCard title="Sales cycle: won vs. lost" hint="Deal counts by cycle-length band.">
              <div className="cw"><canvas ref={cycleWonLostRef} /></div>
            </ChartCard>
            <ChartCard title="Cycle length vs. win rate" hint="Win rate for deals closing in each band.">
              <div className="cw"><canvas ref={cycleWinRateRef} /></div>
            </ChartCard>
          </div>

          <div className="g2" style={{ marginTop: 16 }}>
          <ChartCard title="Median sales cycle by org type"
            hint="Medians, not means — one long Enterprise deal would distort an average. Compare within a band rather than across." controls={<TableTopControl table={cycleOrgSort} count={cycleByOrg.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Org type" sortKey="org" sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Won" sortKey="won" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Lost" sortKey="lost" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /><Th label="Difference" sortKey="difference" numeric sort={cycleOrgSort.sort} onSort={cycleOrgSort.onSort} /></tr></thead>
                <tbody>
                  {cycleOrgSort.apply(cycleByOrg.map(c => ({ ...c, difference: c.lost - c.won }))).map(c => {
                    const max = Math.max(...cycleByOrg.map(x => Math.max(x.won, x.lost)), 1);
                    return (
                      <tr key={c.org}>
                        <td><b>{c.org}</b></td>
                        <td className="n"><MiniBar value={c.won} max={max} color="#10B981" label={fmtDays(c.won)} /></td>
                        <td className="n"><MiniBar value={c.lost} max={max} color="#DC2626" label={fmtDays(c.lost)} /></td>
                        <td className="n mono">{c.lost - c.won > 0 ? '+' : ''}{c.lost - c.won} d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
          <ChartCard title="Median sales cycle by type"
            hint="Renewals close in a fraction of the time new business takes, so a blended average tells you little." controls={<TableTopControl table={cycleTypeSort} count={cycleByType.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Type" sortKey="type" sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Won" sortKey="won" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Lost" sortKey="lost" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /><Th label="Closed" sortKey="count" numeric sort={cycleTypeSort.sort} onSort={cycleTypeSort.onSort} /></tr></thead>
                <tbody>
                  {cycleTypeSort.apply(cycleByType).map(c => {
                    const max = Math.max(...cycleByType.map(x => Math.max(x.won, x.lost)), 1);
                    return (
                      <tr key={c.type}>
                        <td><b>{c.type}</b></td>
                        <td className="n"><MiniBar value={c.won} max={max} color="#10B981" label={fmtDays(c.won)} /></td>
                        <td className="n"><MiniBar value={c.lost} max={max} color="#DC2626" label={fmtDays(c.lost)} /></td>
                        <td className="n mono">{fmtNumber(c.count)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
          </div>

          <ChartCard title="Stalled open deals" style={{ marginTop: 16 }}
            hint="Past their org-type threshold, longest idle first." controls={<TableTopControl table={stalledSort} count={stalledDeals.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="Opportunity" sortKey="name" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Account" sortKey="account" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Org type" sortKey="orgType" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Stage" sortKey="stage" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Owner" sortKey="owner" sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Value" sortKey="amount" numeric sort={stalledSort.sort} onSort={stalledSort.onSort} /><Th label="Idle vs limit" sortKey="daysStuck" numeric sort={stalledSort.sort} onSort={stalledSort.onSort} /></tr></thead>
                <tbody>
                  {stalledSort.apply(stalledDeals).map(r => {
                    const ratio = r.staleThreshold ? (r.daysStuck / r.staleThreshold) : 1;
                    return (
                      <tr key={r.id} className={ratio >= 2 ? 'sev-high' : 'sev-med'}>
                        <td>{r.name}</td>
                        <td style={{ color: 'var(--txt-2)' }}>{r.account}</td>
                        <td><Pill tone="neutral">{r.orgType}</Pill></td>
                        <td>{r.stage}</td>
                        <td>{r.owner}</td>
                        <td className="n mono">{fmtCurrency(r.amount)}</td>
                        <td className="n"><Pill tone={ratio >= 2 ? 'bad' : 'warn'}>{r.daysStuck}d / {r.staleThreshold}d</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- WHERE WE WIN ---------- */}
      {!loading && tab === 'wherewewin' && (
        <>
          <div className="intro">
            <h2>Where we win</h2>
            <p>Product, industry, region and org-type fit. Use this to decide where to point capacity — and where to stop spending it.</p>
          </div>

          <div className="kpis">
            <Kpi tone="teal" label="Best Org Type" value={whereWeWin.bestOrg.label}
              foot={`${fmtCurrency(whereWeWin.bestOrg.wonArr)} Won ARR · ${fmtPercent(whereWeWin.bestOrg.winRate, 0)} win rate`} />
            <Kpi tone="teal" label="Best Industry" value={whereWeWin.bestIndustry.label}
              foot={`${fmtCurrency(whereWeWin.bestIndustry.wonArr)} Won ARR · ${fmtPercent(whereWeWin.bestIndustry.winRate, 0)} win rate`} />
            <Kpi tone="red" label="Weakest Industry" value={whereWeWin.weakestIndustry.label}
              foot={`${fmtCurrency(whereWeWin.weakestIndustry.wonArr)} Won ARR · ${fmtPercent(whereWeWin.weakestIndustry.winRate, 0)} win rate`} />
            <Kpi tone="violet" label="Industries Tracked" value={fmtNumber(whereWeWin.industriesTracked)} foot={`${whereWeWin.rankable} with 3+ closed deals`} />
          </div>

          <ChartCard title="Win rate: region × org type" hint="Colour is win rate; the number beneath is closed deal count.">
            <Heatmap rows={heatRegions} cols={heatOrgs} cell={heatCell} />
          </ChartCard>

          <div className="g2" style={{ marginTop: 16 }}>
            <ChartCard title="Product portfolio"
              hint="Total opportunity value by product, coloured by win rate. Deals list several products, so a deal counts under each — product totals exceed deal count.">
              <BarList data={productPortfolio} format={fmtCurrency} />
            </ChartCard>
            <ChartCard title="Lead source effectiveness" hint="Closed-won value and win rate by how the deal originated.">
              <BarList data={leadSource} format={fmtCurrency} />
            </ChartCard>
          </div>
          <ChartCard title="Business mix" style={{ marginTop: 16 }}
            hint="Closed-won value by opportunity type. Renewals convert far higher than new business by nature — compare within a type, not across.">
            <BarList data={typeValue} format={fmtCurrency} />
          </ChartCard>
          <ChartCard title="Industry scorecard" style={{ marginTop: 16 }}
            hint="Industries with three or more closed deals. Won ARR is the primary ranking metric; click a column to sort." controls={<TableTopControl table={indSort} count={industryScorecard.length} />}>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <Th label="Industry" sortKey="industry" sort={indSort.sort} onSort={indSort.onSort} />
                    <Th label="Closed" sortKey="closed" numeric sort={indSort.sort} onSort={indSort.onSort} />
                    <Th label="Win Rate" sortKey="winRate" numeric sort={indSort.sort} onSort={indSort.onSort} />
                    <Th label="Won ARR" sortKey="wonArr" numeric sort={indSort.sort} onSort={indSort.onSort} />
                    <Th label="Lost ARR" sortKey="lostArr" numeric sort={indSort.sort} onSort={indSort.onSort} />
                  </tr>
                </thead>
                <tbody>
                  {indSort.apply(industryScorecard).map(r => (
                    <tr key={r.industry}>
                      <td><b>{r.industry}</b></td>
                      <td className="n mono">{r.closed}</td>
                      <td className="n"><Pill tone={rateTone(r.winRate)}>{fmtPercent(r.winRate, 0)}</Pill></td>
                      <td className="n mono">{fmtCurrency(r.wonArr)}</td>
                      <td className="n mono">{fmtCurrency(r.lostArr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- REP PERFORMANCE ---------- */}
      {!loading && tab === 'repperformance' && (
        <>
          <div className="intro">
            <h2>Rep performance</h2>
            <p>Volume against conversion. Read alongside org-type mix — Enterprise reps face structurally lower win rates and longer cycles.</p>
          </div>

          <div className="kpis">
            <Kpi tone="blue" label="Active Reps" value={fmtNumber(repSummary.activeReps)} foot={`${podPerformance.length} PODs`} />
            <Kpi tone="teal" label="Median Win Rate" value={fmtPercent(repSummary.medianWinRate)} foot="team midpoint" />
            <Kpi tone="amber" label="Win Rate Spread" value={repSummary.spread} foot="worst to best" />
            <Kpi tone="teal" label="Top by Win Rate" value={repSummary.topByWinRate?.rep || '—'}
              foot={repSummary.topByWinRate ? `${fmtPercent(repSummary.topByWinRate.winRate, 0)} on ${repSummary.topByWinRate.closed} closed` : '3+ closed required'} />
            <Kpi tone="teal" label="Top by Bookings" value={repSummary.topByBookings?.rep || '—'} foot={fmtCurrency(repSummary.topByBookings?.booked || 0)} />
          </div>

          <div className="g2">
            <ChartCard title="Rep performance map" hint="Win rate vs average won deal size. Bubble size is closed-deal volume; dashed lines mark team medians.">
              <div className="cw" style={{ height: 360 }}><canvas ref={repQuadrantRef} /></div>
            </ChartCard>
            
            <ChartCard title="Win rate by POD" hint="Closed includes both won and lost deals. Counts below each gauge show all three outcomes.">
              <MetricGauges data={winRateByPod} format={v => fmtPercent(v, 1)} />
            </ChartCard>
          </div>

          <ChartCard title="Opportunities and ARR by POD" style={{ marginTop: 16 }}
            hint="Won against lost ARR per team." controls={<TableTopControl table={podSort} count={podPerformance.length} />}>
            <div className="scroll">
              <table>
                <thead><tr><Th label="POD" sortKey="pod" sort={podSort.sort} onSort={podSort.onSort} /><Th label="Opps" sortKey="opps" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Closed" sortKey="closed" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Win Rate" sortKey="winRate" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Won ARR" sortKey="wonArr" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Lost ARR" sortKey="lostArr" numeric sort={podSort.sort} onSort={podSort.onSort} /><Th label="Open ARR" sortKey="openArr" numeric sort={podSort.sort} onSort={podSort.onSort} /></tr></thead>
                <tbody>
                  {podSort.apply(podPerformance).map(p => {
                    const maxArr = Math.max(...podPerformance.map(x => x.wonArr), 1);
                    return (
                      <tr key={p.pod}>
                        <td><b>{p.pod}</b></td>
                        <td className="n mono">{fmtNumber(p.opps)}</td>
                        <td className="n mono">{fmtNumber(p.closed)}</td>
                        <td className="n"><Pill tone={rateTone(p.winRate)}>{fmtPercent(p.winRate, 0)}</Pill></td>
                        <td className="n"><MiniBar value={p.wonArr} max={maxArr} color="#10B981" label={fmtCurrency(p.wonArr)} /></td>
                        <td className="n mono" style={{ color: 'var(--red)' }}>{fmtCurrency(p.lostArr)}</td>
                        <td className="n mono">{fmtCurrency(p.openArr)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard title="Rep scorecard" style={{ marginTop: 16 }}
            hint="Click any column to sort. Open value is what each rep still has in play." controls={<TableTopControl table={repSort} count={repStats.length} />}>
            <div className="scroll" style={{ maxHeight: 460 }}>
              <table>
                <thead>
                  <tr>
                    <Th label="Rep" sortKey="rep" sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="POD" sortKey="pod" sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Closed" sortKey="closed" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Wins" sortKey="wins" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Win Rate" sortKey="winRate" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Booked" sortKey="booked" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Open Value" sortKey="openValue" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Stalled" sortKey="stalled" numeric sort={repSort.sort} onSort={repSort.onSort} />
                    <Th label="Cycle" sortKey="avgCycle" numeric sort={repSort.sort} onSort={repSort.onSort} />
                  </tr>
                </thead>
                <tbody>
                  {repSort.apply(repStats).map((r, i) => {
                    const maxBooked = Math.max(...repStats.map(x => x.booked), 1);
                    return (
                      <tr key={r.rep}>
                        <td><span className={`rank${i < 3 && repSort.sort.dir === 'desc' ? ' top' : ''}`}>{i + 1}</span><b>{r.rep}</b></td>
                        <td><Pill tone="neutral">{r.pod}</Pill></td>
                        <td className="n mono">{r.closed}</td>
                        <td className="n mono">{r.wins}</td>
                        <td className="n"><Pill tone={rateTone(r.winRate)}>{fmtPercent(r.winRate, 0)}</Pill></td>
                        <td className="n"><MiniBar value={r.booked} max={maxBooked} label={fmtCurrency(r.booked)} /></td>
                        <td className="n mono">{fmtCurrency(r.openValue)}</td>
                        <td className="n mono" style={{ color: r.stalled > 3 ? 'var(--red)' : 'inherit' }}>{r.stalled}</td>
                        <td className="n mono">{fmtDays(r.avgCycle)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}

      {/* ---------- ACCOUNTS ---------- */}
      {!loading && tab === 'accounts' && (
        <>
          <div className="intro">
            <h2>Accounts & whitespace</h2>
            <p>The account, not the deal, is the unit of value. This finds accounts we keep losing at, and accounts where a first win never turned into a second.</p>
          </div>

          <div className="kpis">
            <Kpi tone="blue" label="Accounts" value={fmtNumber(accounts.total)} foot={`${accounts.multi} with more than one opportunity`} />
            <Kpi tone="teal" label="Accounts Won" value={fmtNumber(accounts.won)} foot={`${fmtPercent((accounts.won / (accounts.total || 1)) * 100, 0)} of the base`} />
            <Kpi tone="red" label="Repeat-Loss Accounts" value={fmtNumber(accounts.repeatLoss)} foot={`${fmtCurrency(accounts.repeatLossValue)} lost, zero wins`} />
            <Kpi tone="teal" label="Expansion Candidates" value={fmtNumber(accounts.expansion)} foot={`${fmtCurrency(accounts.expansionValue)} open on won accounts`} />
            <Kpi tone="violet" label="Avg Opps per Account" value={accounts.oppsPerAccount.toFixed(1)} foot="depth of engagement" />
            <Kpi tone="teal" label="Value per Won Account" value={fmtCurrency(accounts.valuePerWon)} foot="average booked per landed logo" />
          </div>

          <div className="g2">
            <ChartCard title="Account outcome distribution" hint="Every account by its track record with us.">
              <Donut data={accountOutcome} centerLabel="accounts" format={fmtNumber} />
            </ChartCard>
            <ChartCard title="Win rate by opportunities per account" hint="Does engaging an account repeatedly improve conversion?">
              <div className="cw"><canvas ref={oppsPerAccountRef} /></div>
            </ChartCard>
          </div>

          <div className="g2">
            <ChartCard title="Repeat-loss accounts" hint="Two or more closed opportunities, zero wins. Qualify harder or walk away." controls={<TableTopControl table={repeatLossSort} count={repeatLossAccounts.length} />}>
              <div className="scroll">
                <table>
                  <thead><tr><Th label="Account" sortKey="account" sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /><Th label="Industry" sortKey="industry" sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /><Th label="Losses" sortKey="losses" numeric sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /><Th label="Value Lost" sortKey="lostValue" numeric sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /><Th label="Still Open" sortKey="openValue" numeric sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /><Th label="Reps" sortKey="repsTried" numeric sort={repeatLossSort.sort} onSort={repeatLossSort.onSort} /></tr></thead>
                  <tbody>
                    {repeatLossSort.apply(repeatLossAccounts).map((r, i) => (
                      <tr key={r.account} className={i < 3 ? 'sev-high' : ''}>
                        <td><b>{r.account}</b></td>
                        <td style={{ color: 'var(--txt-2)' }}>{r.industry}</td>
                        <td className="n mono">{r.losses}</td>
                        <td className="n mono">{fmtCurrency(r.lostValue)}</td>
                        <td className="n mono">{r.openValue > 0 ? fmtCurrency(r.openValue) : '—'}</td>
                        <td className="n mono">{r.repsTried}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard title="Expansion candidates" hint="A win on the board and open pipeline still running." controls={<TableTopControl table={expansionSort} count={expansionCandidates.length} />}>
              <div className="scroll">
                <table>
                  <thead><tr><Th label="Account" sortKey="account" sort={expansionSort.sort} onSort={expansionSort.onSort} /><Th label="Org type" sortKey="orgType" sort={expansionSort.sort} onSort={expansionSort.onSort} /><Th label="Wins" sortKey="wins" numeric sort={expansionSort.sort} onSort={expansionSort.onSort} /><Th label="Booked" sortKey="wonValue" numeric sort={expansionSort.sort} onSort={expansionSort.onSort} /><Th label="Open Value" sortKey="openValue" numeric sort={expansionSort.sort} onSort={expansionSort.onSort} /></tr></thead>
                  <tbody>
                    {expansionSort.apply(expansionCandidates).map(r => {
                      const maxOpen = Math.max(...expansionCandidates.map(x => x.openValue), 1);
                      return (
                        <tr key={r.account}>
                          <td><b>{r.account}</b></td>
                          <td><Pill tone="neutral">{r.orgType}</Pill></td>
                          <td className="n mono">{r.wins}</td>
                          <td className="n mono">{fmtCurrency(r.wonValue)}</td>
                          <td className="n"><MiniBar value={r.openValue} max={maxOpen} label={fmtCurrency(r.openValue)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        </>
      )}

      <div className="page-foot">
        All figures recompute against the active filters.
        <br />
        Days in stage is measured from the last stage change; sales cycle is creation to close.
        A deal is stalled once it passes its org-type threshold — 90 days Enterprise, 30 Mid-Market, 15 SMB.
      </div>

      <button type="button" className="floating-filter-button"
        aria-label="Open dashboard filters" title="Dashboard filters"
        onClick={() => setFilterPanelOpen(open => !open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5" />
          <circle cx="16" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="13" cy="18" r="2" />
        </svg>
        {activeFilterCount > 0 && <span className="floating-filter-badge">{activeFilterCount}</span>}
      </button>

      {filterPanelOpen && (
        <aside className="floating-filter-panel" aria-label="Dashboard filters">
          <div className="floating-filter-head">
            <div>
              <b>Dashboard filters</b>
              <span>{fmtNumber(data.length)} opportunities</span>
            </div>
            <button type="button" aria-label="Close filters" onClick={() => setFilterPanelOpen(false)}>×</button>
          </div>
          <div className="floating-filter-controls">
            {[
              { key: 'region', label: 'Region', opts: options.region },
              { key: 'orgType', label: 'Org type', opts: options.orgType },
              { key: 'stage', label: 'Stage', opts: options.stage },
              { key: 'owner', label: 'Owner', opts: options.owner },
              { key: 'source', label: 'Source', opts: options.source },
              { key: 'type', label: 'Opportunity type', opts: options.type },
            ].map(f => (
              <MultiSelect key={f.key} label={f.label} options={f.opts}
                value={filters[f.key]} onChange={value => updateFilter(f.key, value)} />
            ))}
            <DateRangeFilter filters={filters} setFilters={setFilters} />
          </div>
          <button className="floating-filter-reset" type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset all filters
          </button>
        </aside>
      )}
    </div>
  );
}

/* ---------- KPI tile ---------- */
function Kpi({ tone, label, value, foot }) {
  return (
    <div className={`kpi acc-${tone}`}>
      <div className="kpi-label-row"><div className="lb">{label}</div></div>
      <div className="vl">{value}</div>
      <div className="ft">{foot}</div>
    </div>
  );
}

/* ---------- Month / quarter toggle ---------- */
function GrainToggle({ grain, setGrain, auto }) {
  const opts = [
    { key: null, label: 'Auto' },
    { key: 'month', label: 'Month' },
    { key: 'quarter', label: 'Quarter' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {opts.map(o => {
        const on = grain === o.key;
        return (
          <button key={o.label} type="button" onClick={() => setGrain(o.key)}
            title={o.key === null ? `Currently showing ${auto}s` : undefined}
            style={{
              padding: '3px 9px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
              fontFamily: 'inherit',
              border: `1px solid ${on ? 'var(--teal)' : 'var(--line)'}`,
              background: on ? 'var(--teal)' : 'transparent',
              color: on ? '#fff' : 'var(--txt-2)',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Date range filter ---------- */

const PRESETS = [
  { key: 'thisQuarter', label: 'This quarter' },
  { key: 'lastQuarter', label: 'Last quarter' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'next90', label: 'Next 90 days' },
];

function isoLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function presetRange(key) {
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
  const [target, setTarget] = useState('close');
  const wrapRef = useRef(null);

  const { closeFrom, closeTo, createdFrom, createdTo } = filters;
  const active = Boolean(closeFrom || closeTo || createdFrom || createdTo);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 6 });
    };
    measure();
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const set = patch => setFilters(s => ({ ...s, ...patch }));

  function applyPresetTo(key) {
    const [f, t] = presetRange(key);
    set(target === 'close' ? { closeFrom: f, closeTo: t } : { createdFrom: f, createdTo: t });
  }

  function summary() {
    if (!active) return 'All dates';
    const parts = [];
    if (closeFrom || closeTo) parts.push(`Close ${shortDate(closeFrom) || '…'} – ${shortDate(closeTo) || '…'}`);
    if (createdFrom || createdTo) parts.push(`Created ${shortDate(createdFrom) || '…'} – ${shortDate(createdTo) || '…'}`);
    return parts.join('  ·  ');
  }

  const [tFrom, tTo] = target === 'close' ? [closeFrom, closeTo] : [createdFrom, createdTo];
  const activePreset = PRESETS.find(p => {
    const [f, t] = presetRange(p.key);
    return f === tFrom && t === tTo;
  })?.key;

  return (
    <div className="fg" ref={wrapRef} style={{ position: 'relative' }}>
      <label>Date range</label>
      <button type="button" className={`date-range-trigger${active ? ' on' : ''}`}
        onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        padding: '8px 12px', borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
        minWidth: 150, whiteSpace: 'nowrap',
      }}>
        <span style={{ opacity: .75, fontSize: 12 }}>▤</span>
        {summary()}
        <span style={{ opacity: .5, fontSize: 9, marginLeft: 'auto' }}>▼</span>
      </button>

      {open && rect && createPortal(
        <div style={{
          position: 'fixed', left: rect.left, top: rect.top, zIndex: 1000, width: 340,
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,.18)', padding: 14, color: 'var(--txt)',
        }}>
          <div style={popLabel}>Apply quick ranges to</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, marginBottom: 12 }}>
            {[['close', 'Close date'], ['created', 'Created date']].map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setTarget(k)} style={{
                flex: 1, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                fontFamily: 'inherit', borderRadius: 6,
                border: `1px solid ${target === k ? 'var(--txt)' : 'var(--line)'}`,
                background: target === k ? 'var(--txt)' : 'transparent',
                color: target === k ? 'var(--card)' : 'var(--txt-2)',
                fontWeight: target === k ? 650 : 400,
              }}>{lbl}</button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(p => {
              const on = activePreset === p.key;
              return (
                <button key={p.key} type="button" onClick={() => applyPresetTo(p.key)} style={{
                  padding: '5px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                  fontFamily: 'inherit',
                  border: `1px solid ${on ? 'var(--teal)' : 'var(--line)'}`,
                  background: on ? 'var(--teal)' : 'transparent',
                  color: on ? '#fff' : 'var(--txt-2)',
                }}>{p.label}</button>
              );
            })}
          </div>

          <div style={{ ...popLabel, marginTop: 16 }}>Close date</div>
          <RangeInputs from={closeFrom} to={closeTo}
            onFrom={v => set({ closeFrom: v })} onTo={v => set({ closeTo: v })} />

          <div style={{ ...popLabel, marginTop: 12 }}>Created date</div>
          <RangeInputs from={createdFrom} to={createdTo}
            onFrom={v => set({ createdFrom: v })} onTo={v => set({ createdTo: v })} />

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)',
          }}>
            <button type="button"
              onClick={() => set({ closeFrom: '', closeTo: '', createdFrom: '', createdTo: '' })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                       fontSize: 12.5, color: 'var(--txt-3)', fontFamily: 'inherit' }}>
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
      <input type="date" value={from} max={to || undefined}
        onChange={e => onFrom(e.target.value)} style={dateInput} />
      <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>→</span>
      <input type="date" value={to} min={from || undefined}
        onChange={e => onTo(e.target.value)} style={dateInput} />
    </div>
  );
}

const popLabel = {
  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.5px',
  color: 'var(--txt-3)', fontWeight: 650,
};

const dateInput = {
  flex: 1, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 6,
  fontSize: 12.5, fontFamily: 'inherit', background: 'var(--card)', color: 'var(--txt)',
  colorScheme: 'light',
};

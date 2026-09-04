// Opportunity Analytics — every number the five-tab board and its TV layer
// show, computed here from mapped opportunity rows so it can be unit-tested,
// validated against the raw source, and served as one small snapshot instead
// of shipping every row to the browser.
//
// One row = one opportunity (the source "Opportunity flow Data" is
// opportunity-grained, verified 2026-09-04: 54,873 rows, 54,873 distinct ids).
// The only money measure is ARR — the business ruling is that every $ on this
// board is annualised recurring revenue, never the raw Amount.
import { buildGenericComparison } from './periodComparison.js';

// Stage sequence by Salesforce stage probability (10% → 90%), read off the
// source itself — no worksheet sort order travels through the data-source
// API. Stages the source adds later are appended after these, so a new
// stage can never silently vanish from the funnel.
export const STAGE_ORDER = [
  'Qualification', 'Risk', 'No Contact', 'Demo', 'Pre-Trial', 'Work In Progress', 'Trial',
  'Post Trial Discussion', 'Proposal', 'Confirmed', 'Negotiation', 'Procurement',
  'Closed Won', 'Closed Lost',
];
export const ORG_ORDER = ['SMB', 'Mid-Market', 'Enterprise'];

// Loss-reason families agreed with the business (2026-09-04). The raw
// picklist keeps 18 values; charts and the Disengagement KPI read the family,
// tables keep the raw reason for drill-down. An unrecognised new picklist
// value lands in "Other / not recorded" so it stays visible in the raw table
// rather than disappearing.
export const LOSS_FAMILIES = [
  { key: 'Disengaged / no decision', reasons: ['Not Responding', 'No Decision / Non-Responsive', 'Decision Deferred', 'No Longer In Company'] },
  { key: 'Priority or budget', reasons: ['Change of Priority', 'No Budget / Lost Funding', 'Upcoming Cut', 'Project Based'] },
  { key: 'Product fit', reasons: ['Product Feature Gap', 'Limitation/Complex Use Case', 'Product Issue', 'Support'] },
  { key: 'Competition or price', reasons: ['Competition', 'Lost to Competitor', 'Price'] },
  { key: 'Not a real deal', reasons: ['Duplicate Deal', 'Junk Lead'] },
  { key: 'Other / not recorded', reasons: ['Others'] },
];
export const DISENGAGEMENT_FAMILY = LOSS_FAMILIES[0].key;
export const UNRECORDED_FAMILY = LOSS_FAMILIES[LOSS_FAMILIES.length - 1].key;
const FAMILY_BY_REASON = new Map(LOSS_FAMILIES.flatMap(family => family.reasons.map(reason => [reason.toLowerCase(), family.key])));
export const lossFamilyOf = reason => FAMILY_BY_REASON.get(String(reason || '').trim().toLowerCase()) || UNRECORDED_FAMILY;

// Deal Health is a picklist that is blank on most open deals; blank is its
// own honest state, not "healthy".
export const HEALTH_STATES = ['Green', 'Amber', 'Red', 'Not rated'];
export const healthOf = row => {
  const value = String(row?.dealHealth || '').trim().toLowerCase();
  return value === 'green' ? 'Green' : value === 'amber' ? 'Amber' : value === 'red' ? 'Red' : 'Not rated';
};

const LIST_CAP = 300;   // longest row list any table receives
const money = row => Number(row.arr) || 0;
const sum = rows => rows.reduce((total, row) => total + money(row), 0);
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const pct = (part, whole) => (whole ? part / whole * 100 : null);
const round = (value, places = 1) => (value === null || value === undefined ? null : Number(Number(value).toFixed(places)));
const median = values => {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const average = values => {
  const nums = values.filter(finite).map(Number);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};
const distinct = (rows, field) => [...new Set(rows.map(row => row[field]).filter(Boolean))];
const winRate = rows => {
  const closed = rows.filter(row => row.isClosed);
  return pct(closed.filter(row => row.isWon).length, closed.length);
};
export const stageRank = stage => {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? STAGE_ORDER.length : index;
};
const orderStages = stages => [...stages].sort((a, b) => stageRank(a) - stageRank(b) || String(a).localeCompare(String(b)));
const orgRank = org => { const index = ORG_ORDER.indexOf(org); return index === -1 ? ORG_ORDER.length : index; };

const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
// Geography is the CUSTOMER's continent group (APAC / Americas / EMEA rolled
// up from Acc Continent, blanks kept as "No Continent"), not the rep-role
// Region column — business ruling, 2026-09-04.
export const OPPORTUNITY_FILTER_FIELDS = ['continentGroup', 'orgType', 'stage', 'owner', 'source', 'type', 'industry', 'pod'];

// Same rules the generic /api/data route applies, kept here so the snapshot
// and any verification script filter identically: categorical multi-selects,
// inclusive date bounds (a null date drops out once that bound is set), and
// one row per opportunity id.
export function filterOpportunityRows(rows, query = {}) {
  let data = rows;
  for (const field of OPPORTUNITY_FILTER_FIELDS) {
    const selected = list(query[field]);
    if (selected.length) data = data.filter(row => selected.includes(row[field]));
  }
  if (query.createdFrom) data = data.filter(row => row.createdDate && row.createdDate >= query.createdFrom);
  if (query.createdTo) data = data.filter(row => row.createdDate && row.createdDate <= query.createdTo);
  if (query.closeFrom) data = data.filter(row => row.closeDate && row.closeDate >= query.closeFrom);
  if (query.closeTo) data = data.filter(row => row.closeDate && row.closeDate <= query.closeTo);
  const seen = new Set();
  return data.filter(row => {
    const id = String(row.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ===== Time buckets for the Pulse trend =====
const monthKey = date => (date ? String(date).slice(0, 7) : null);
const quarterKey = month => {
  if (!month) return null;
  const [year, mm] = month.split('-');
  return `${year}-Q${Math.floor((Number(mm) - 1) / 3) + 1}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = key => { const [year, mm] = key.split('-'); return `${MONTHS[Number(mm) - 1]} ${year.slice(2)}`; };
const quarterLabel = key => { const [year, q] = key.split('-'); return `${q} ${year.slice(2)}`; };
const monthRange = (from, to) => {
  const out = [];
  let [year, month] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1; if (month > 12) { month = 1; year += 1; }
  }
  return out;
};
function buildTrend(rows, today = new Date()) {
  // A handful of deals carry close dates years ahead (CRM typos); letting
  // them stretch the axis into 2027 forced every this-year view onto a
  // quarterly grain with empty tails. The trend stops at the current month.
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const closed = rows.filter(row => row.isClosed && row.closeDate && monthKey(row.closeDate) <= currentMonth);
  const created = rows.filter(row => row.createdDate && monthKey(row.createdDate) <= currentMonth);
  const months = [...closed.map(row => monthKey(row.closeDate)), ...created.map(row => monthKey(row.createdDate))].filter(Boolean).sort();
  if (!months.length) return { monthly: [], quarterly: [] };
  const bucket = (keyOf, labelOf, keys) => keys.map(key => {
    const closedIn = closed.filter(row => keyOf(monthKey(row.closeDate)) === key);
    const wonIn = closedIn.filter(row => row.isWon);
    const createdIn = created.filter(row => keyOf(monthKey(row.createdDate)) === key);
    return {
      key, label: labelOf(key),
      closedCount: closedIn.length, wonCount: wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)),
      bookingsArr: sum(wonIn), closedArr: sum(closedIn),
      createdCount: createdIn.length, createdArr: sum(createdIn),
    };
  });
  const monthKeys = monthRange(months[0], months[months.length - 1]);
  const quarterKeys = [...new Set(monthKeys.map(quarterKey))];
  return {
    monthly: bucket(key => key, monthLabel, monthKeys),
    quarterly: bucket(quarterKey, quarterLabel, quarterKeys),
  };
}

const rowSummary = row => ({
  id: row.id, name: row.name || row.id, account: row.account || '', stage: row.stage || '', owner: row.owner || '',
  orgType: row.orgType || '', arr: money(row), daysStuck: finite(row.daysStuck) ? Number(row.daysStuck) : null,
  staleThreshold: finite(row.staleThreshold) ? Number(row.staleThreshold) : null,
  isStalled: Boolean(row.isStalled), health: healthOf(row), type: row.type || '', continent: row.continentGroup || '',
});

// ===== The metrics =====
export function buildOpportunityMetrics(rows) {
  const open = rows.filter(row => !row.isClosed);
  const closed = rows.filter(row => row.isClosed);
  const won = closed.filter(row => row.isWon);
  const lost = closed.filter(row => !row.isWon);

  const pulse = {
    total: rows.length, openCount: open.length, closedCount: closed.length, wonCount: won.length, lostCount: lost.length,
    winRate: round(pct(won.length, closed.length)),
    openArr: sum(open), wonArr: sum(won), lostArr: sum(lost), closedArr: sum(closed),
    arrWinRate: round(pct(sum(won), sum(closed))),
    avgCycle: round(average(closed.map(row => row.cycleDays)), 0),
    medianCycle: median(closed.map(row => row.cycleDays)),
    accounts: distinct(rows, 'accountId').length,
  };

  const funnel = orderStages(distinct(open, 'stage')).map(stage => {
    const inStage = open.filter(row => row.stage === stage);
    return { stage, count: inStage.length, arr: sum(inStage), share: round(pct(inStage.length, open.length)) };
  });

  const outcomeMix = [
    { label: 'Closed Won', value: won.length },
    { label: 'Closed Lost', value: lost.length },
    { label: 'Open', value: open.length },
  ];

  const byContinent = distinct(rows, 'continentGroup').map(continent => {
    const inContinent = rows.filter(row => row.continentGroup === continent);
    const closedIn = inContinent.filter(row => row.isClosed);
    const wonIn = closedIn.filter(row => row.isWon);
    return { label: continent, opps: inContinent.length, closed: closedIn.length, won: wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), wonArr: sum(wonIn), openArr: sum(inContinent.filter(row => !row.isClosed)) };
  }).sort((a, b) => b.wonArr - a.wonArr);

  const largestOpen = [...open].sort((a, b) => money(b) - money(a)).slice(0, LIST_CAP).map(rowSummary);

  // ---- Diagnostics ----
  const healthMix = HEALTH_STATES.map(state => {
    const inState = open.filter(row => healthOf(row) === state);
    return { label: state, count: inState.length, arr: sum(inState), share: round(pct(inState.length, open.length)) };
  });
  const rated = open.filter(row => healthOf(row) !== 'Not rated');
  const red = open.filter(row => healthOf(row) === 'Red');
  const amber = open.filter(row => healthOf(row) === 'Amber');
  const disengaged = lost.filter(row => lossFamilyOf(row.lossReason) === DISENGAGEMENT_FAMILY);
  const renewalRows = rows.filter(row => /renew/i.test(String(row.type || '')));
  const renewalClosed = renewalRows.filter(row => row.isClosed);
  const renewalLost = renewalClosed.filter(row => !row.isWon);
  const diagnostics = {
    lostArr: sum(lost), lostCount: lost.length, lossRate: round(pct(lost.length, closed.length)),
    arrLossRate: round(pct(sum(lost), sum(closed))),
    ratedCount: rated.length, ratedShare: round(pct(rated.length, open.length)),
    redCount: red.length, redArr: sum(red), amberCount: amber.length, amberArr: sum(amber),
    atRiskShareOfRated: round(pct(red.length + amber.length, rated.length)),
    disengagedCount: disengaged.length, disengagedArr: sum(disengaged),
    disengagementRate: round(pct(disengaged.length, closed.length)),
    disengagedShareOfLost: round(pct(disengaged.length, lost.length)),
    avgDaysToLose: round(average(lost.map(row => row.cycleDays)), 0),
    medianDaysToLose: median(lost.map(row => row.cycleDays)),
    renewal: renewalRows.length ? {
      opps: renewalRows.length, closed: renewalClosed.length, lost: renewalLost.length,
      lostArr: sum(renewalLost), churnRate: round(pct(renewalLost.length, renewalClosed.length)),
    } : null,
  };

  const reasonRows = new Map();
  lost.forEach(row => {
    const reason = String(row.lossReason || '').trim() || 'Not recorded';
    if (!reasonRows.has(reason)) reasonRows.set(reason, []);
    reasonRows.get(reason).push(row);
  });
  const lossReasons = [...reasonRows].map(([reason, inReason]) => ({
    reason, family: lossFamilyOf(reason === 'Not recorded' ? '' : reason), count: inReason.length, arr: sum(inReason),
    share: round(pct(inReason.length, lost.length)),
  })).sort((a, b) => b.count - a.count || b.arr - a.arr);
  let cumulative = 0;
  const lossFamilies = LOSS_FAMILIES.map(family => {
    const reasons = lossReasons.filter(item => item.family === family.key);
    const count = reasons.reduce((total, item) => total + item.count, 0);
    return { family: family.key, count, arr: reasons.reduce((total, item) => total + item.arr, 0),
      share: round(pct(count, lost.length)), reasons };
  }).filter(item => item.count > 0).sort((a, b) => b.count - a.count).map(item => {
    cumulative += item.count;
    return { ...item, cumulativeShare: round(pct(cumulative, lost.length)) };
  });

  const lossGrid = (() => {
    const orgs = distinct(lost, 'orgType').sort((a, b) => orgRank(a) - orgRank(b));
    const totals = Object.fromEntries(orgs.map(org => [org, lost.filter(row => row.orgType === org).length]));
    const gridRows = lossFamilies.map(item => ({
      family: item.family, total: item.count,
      cols: Object.fromEntries(orgs.map(org => [org, lost.filter(row => row.orgType === org && lossFamilyOf(row.lossReason) === item.family).length])),
    }));
    return { orgs, rows: gridRows, totals };
  })();

  const winRateByOrg = distinct(rows, 'orgType').map(org => {
    const closedIn = closed.filter(row => row.orgType === org);
    const wonIn = closedIn.filter(row => row.isWon);
    return { label: org, closed: closedIn.length, won: wonIn.length, lost: closedIn.length - wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), lossRate: round(pct(closedIn.length - wonIn.length, closedIn.length)),
      wonArr: sum(wonIn), avgWonArr: wonIn.length ? sum(wonIn) / wonIn.length : null,
      openCount: open.filter(row => row.orgType === org).length };
  }).sort((a, b) => orgRank(a.label) - orgRank(b.label));

  const typeHealth = distinct(rows, 'type').map(type => {
    const inType = rows.filter(row => row.type === type);
    const closedIn = inType.filter(row => row.isClosed);
    const wonIn = closedIn.filter(row => row.isWon);
    const lostIn = closedIn.filter(row => !row.isWon);
    return { type, opps: inType.length, closed: closedIn.length, won: wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), wonArr: sum(wonIn), lostArr: sum(lostIn),
      openArr: sum(inType.filter(row => !row.isClosed)), isRenewal: /renew/i.test(type),
      medianCycleWon: median(wonIn.map(row => row.cycleDays)), medianCycleLost: median(lostIn.map(row => row.cycleDays)) };
  }).sort((a, b) => b.wonArr - a.wonArr);

  const atRisk = open.filter(row => ['Red', 'Amber'].includes(healthOf(row)))
    .sort((a, b) => (healthOf(a) === healthOf(b) ? money(b) - money(a) : healthOf(a) === 'Red' ? -1 : 1))
    .slice(0, LIST_CAP).map(rowSummary);

  // ---- Velocity ----
  const stalled = open.filter(row => row.isStalled);
  const wayOver = open.filter(row => finite(row.staleThreshold) && Number(row.staleThreshold) > 0
    && Number(row.daysStuck || 0) >= Number(row.staleThreshold) * 2);
  const velocity = {
    avgDays: round(average(open.map(row => row.daysStuck)), 0),
    medianDays: median(open.map(row => row.daysStuck)),
    stalledCount: stalled.length, stalledArr: sum(stalled), stalledShare: round(pct(stalled.length, open.length)),
    wayOverCount: wayOver.length, wayOverArr: sum(wayOver),
    avgCycleWon: round(average(won.map(row => row.cycleDays)), 0), avgCycleLost: round(average(lost.map(row => row.cycleDays)), 0),
    medianCycleWon: median(won.map(row => row.cycleDays)), medianCycleLost: median(lost.map(row => row.cycleDays)),
  };
  const agingBuckets = [
    ['0–30 days', 0, 30], ['30–60 days', 30, 60], ['60–90 days', 60, 90], ['90–180 days', 90, 180], ['180–365 days', 180, 365], ['365+ days', 365, Infinity],
  ].map(([label, min, max]) => {
    const inBand = open.filter(row => Number(row.daysStuck || 0) >= min && Number(row.daysStuck || 0) < max);
    return { label, count: inBand.length, arr: sum(inBand), share: round(pct(inBand.length, open.length)) };
  });
  const daysByStage = orderStages(distinct(open, 'stage')).map(stage => {
    const inStage = open.filter(row => row.stage === stage);
    return { stage, count: inStage.length, avgDays: round(average(inStage.map(row => row.daysStuck)), 0),
      medianDays: median(inStage.map(row => row.daysStuck)), stalled: inStage.filter(row => row.isStalled).length };
  });
  const cycleBands = [['0–30 d', 0, 30], ['30–60 d', 30, 60], ['60–90 d', 60, 90], ['90–120 d', 90, 120], ['120+ d', 120, Infinity]].map(([label, min, max]) => {
    const inBand = closed.filter(row => finite(row.cycleDays) && Number(row.cycleDays) >= min && Number(row.cycleDays) < max);
    const wonIn = inBand.filter(row => row.isWon);
    return { label, won: wonIn.length, lost: inBand.length - wonIn.length, winRate: round(pct(wonIn.length, inBand.length)) };
  });
  const cycleByOrg = distinct(closed, 'orgType').sort((a, b) => orgRank(a) - orgRank(b)).map(org => ({
    org, won: median(won.filter(row => row.orgType === org).map(row => row.cycleDays)),
    lost: median(lost.filter(row => row.orgType === org).map(row => row.cycleDays)),
    closed: closed.filter(row => row.orgType === org).length,
  }));
  const stalledDeals = [...stalled].sort((a, b) => Number(b.daysStuck || 0) - Number(a.daysStuck || 0)).slice(0, LIST_CAP).map(rowSummary);

  // ---- Where we win ----
  const heatContinents = distinct(rows, 'continentGroup').sort();
  const heatOrgs = distinct(rows, 'orgType').sort((a, b) => orgRank(a) - orgRank(b));
  const heat = { continents: heatContinents, orgs: heatOrgs, cells: {} };
  heatContinents.forEach(continent => {
    heat.cells[continent] = {};
    heatOrgs.forEach(org => {
      const closedIn = closed.filter(row => row.continentGroup === continent && row.orgType === org);
      const wonIn = closedIn.filter(row => row.isWon);
      heat.cells[continent][org] = { closed: closedIn.length, won: wonIn.length, winRate: round(pct(wonIn.length, closedIn.length)) };
    });
  });
  const leadSource = distinct(rows, 'source').map(source => {
    const closedIn = closed.filter(row => row.source === source);
    const wonIn = closedIn.filter(row => row.isWon);
    return { label: source, opps: rows.filter(row => row.source === source).length, closed: closedIn.length, won: wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), wonArr: sum(wonIn) };
  }).sort((a, b) => b.wonArr - a.wonArr);
  const industryScorecard = distinct(rows, 'industry').map(industry => {
    const closedIn = closed.filter(row => row.industry === industry);
    const wonIn = closedIn.filter(row => row.isWon);
    return { industry, closed: closedIn.length, won: wonIn.length, winRate: round(pct(wonIn.length, closedIn.length)),
      wonArr: sum(wonIn), lostArr: sum(closedIn.filter(row => !row.isWon)) };
  }).filter(item => item.closed >= 3).sort((a, b) => b.wonArr - a.wonArr);
  const best = items => (items.length ? [...items].sort((a, b) => b.wonArr - a.wonArr || (b.winRate || 0) - (a.winRate || 0))[0] : null);
  const weakest = items => (items.length ? [...items].sort((a, b) => (a.winRate || 0) - (b.winRate || 0) || a.wonArr - b.wonArr)[0] : null);
  const whereWeWin = {
    bestOrg: best(winRateByOrg.map(item => ({ label: item.label, wonArr: item.wonArr, winRate: item.winRate, closed: item.closed }))),
    bestIndustry: best(industryScorecard.map(item => ({ label: item.industry, wonArr: item.wonArr, winRate: item.winRate, closed: item.closed }))),
    weakestIndustry: weakest(industryScorecard.map(item => ({ label: item.industry, wonArr: item.wonArr, winRate: item.winRate, closed: item.closed }))),
    industriesTracked: distinct(rows, 'industry').length, rankable: industryScorecard.length,
  };

  // ---- Rep performance ----
  const repStats = distinct(rows, 'owner').map(rep => {
    const inRep = rows.filter(row => row.owner === rep);
    const closedIn = inRep.filter(row => row.isClosed);
    const wonIn = closedIn.filter(row => row.isWon);
    return { rep, pod: inRep.find(row => row.pod)?.pod || '—', team: inRep.find(row => row.team)?.team || '—',
      opps: inRep.length, closed: closedIn.length, wins: wonIn.length, losses: closedIn.length - wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), booked: sum(wonIn), openArr: sum(inRep.filter(row => !row.isClosed)),
      openCount: inRep.filter(row => !row.isClosed).length, stalled: inRep.filter(row => row.isStalled).length,
      medianCycle: median(closedIn.map(row => row.cycleDays)) };
  }).sort((a, b) => b.booked - a.booked);
  const qualifiedReps = repStats.filter(item => item.closed >= 3);
  const rates = qualifiedReps.map(item => item.winRate).filter(finite).sort((a, b) => a - b);
  const repSummary = {
    activeReps: repStats.length, qualifiedReps: qualifiedReps.length,
    medianWinRate: rates.length ? rates[Math.floor(rates.length / 2)] : null,
    spread: rates.length ? { min: rates[0], max: rates[rates.length - 1] } : null,
    topByWinRate: [...qualifiedReps].sort((a, b) => (b.winRate || 0) - (a.winRate || 0) || b.wins - a.wins)[0] || null,
    topByBookings: repStats[0] || null,
    topByWins: [...repStats].sort((a, b) => b.wins - a.wins)[0] || null,
  };
  const podPerformance = distinct(rows, 'pod').map(pod => {
    const inPod = rows.filter(row => row.pod === pod);
    const closedIn = inPod.filter(row => row.isClosed);
    const wonIn = closedIn.filter(row => row.isWon);
    return { pod, opps: inPod.length, closed: closedIn.length, wins: wonIn.length, losses: closedIn.length - wonIn.length,
      winRate: round(pct(wonIn.length, closedIn.length)), wonArr: sum(wonIn), lostArr: sum(closedIn.filter(row => !row.isWon)),
      openArr: sum(inPod.filter(row => !row.isClosed)), reps: distinct(inPod, 'owner').length };
  }).sort((a, b) => b.wonArr - a.wonArr);


  return {
    pulse, funnel, outcomeMix, byContinent, largestOpen, trend: buildTrend(rows),
    diagnostics, healthMix, lossReasons, lossFamilies, lossGrid, winRateByOrg, typeHealth, atRisk,
    velocity, agingBuckets, daysByStage, cycleBands, cycleByOrg, stalledDeals,
    heat, leadSource, industryScorecard, whereWeWin,
    repStats: repStats.slice(0, LIST_CAP), repSummary, podPerformance,
  };
}

// ===== Highlights: three readings per tab, arithmetic over the metrics =====
// `publicSafe` produces the wall variant: counts, rates and names only —
// never a currency figure or a day count, per the board's public-display
// policy. Text uses **bold** markers the client renders as emphasis.
const fmtMoney = value => {
  const n = Number(value) || 0, abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
};
const fmtPct = value => (value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`);
const fmtN = value => Number(value || 0).toLocaleString('en-US');
const plural = (n, word) => `${fmtN(n)} ${Number(n) === 1 ? word : word.endsWith('s') ? `${word}es` : `${word}s`}`;

export function buildOpportunityHighlights(metrics, view, { publicSafe = false, comparison = null } = {}) {
  const items = [];
  const add = (tag, text, tone) => { if (text) items.push({ tag, text, tone }); };
  const m = metrics;
  if (view === 'pulse') {
    const delta = comparison?.available ? comparison.dealWinRatePointChange : null;
    const change = delta === null || delta === undefined ? '' : ` — ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} pts on the previous equal period`;
    if (m.pulse.closedCount) add('Win rate', `**${fmtPct(m.pulse.winRate)}** of ${plural(m.pulse.closedCount, 'closed opp')} were won${change}.`, delta === null || delta === undefined ? undefined : delta >= 0 ? 'good' : 'bad');
    const topStage = [...m.funnel].sort((a, b) => (publicSafe ? b.count - a.count : b.arr - a.arr))[0];
    if (topStage && m.pulse.openCount) add('Pipeline', publicSafe
      ? `**${topStage.stage}** holds ${fmtPct(topStage.share)} of open opportunities (${plural(topStage.count, 'deal')}).`
      : `**${topStage.stage}** holds ${fmtPct(pct(topStage.arr, m.pulse.openArr))} of open ARR — ${fmtMoney(topStage.arr)} across ${plural(topStage.count, 'deal')}.`);
    const continent = publicSafe ? [...m.byContinent].sort((a, b) => b.won - a.won)[0] : m.byContinent[0];
    if (continent && continent.won) add('Continent', publicSafe
      ? `**${continent.label}** leads with ${plural(continent.won, 'win')} at a ${fmtPct(continent.winRate)} win rate.`
      : `**${continent.label}** books ${fmtPct(pct(continent.wonArr, m.pulse.wonArr))} of Won ARR (${fmtMoney(continent.wonArr)}) at a ${fmtPct(continent.winRate)} win rate.`);
  }
  if (view === 'diagnostics') {
    const family = m.lossFamilies[0];
    if (family) add('Loss driver', publicSafe
      ? `**${family.family}** explains ${fmtPct(family.share)} of losses (${plural(family.count, 'opp')}).`
      : `**${family.family}** explains ${fmtPct(family.share)} of losses — ${plural(family.count, 'opp')}, ${fmtMoney(family.arr)} of ARR.`, 'bad');
    if (m.pulse.openCount) add('Health coverage', m.diagnostics.ratedCount
      ? `Only **${fmtPct(m.diagnostics.ratedShare)}** of open opps carry a health rating; ${fmtPct(m.diagnostics.atRiskShareOfRated)} of rated deals are Red or Amber${publicSafe ? '' : ` (${fmtMoney(m.diagnostics.redArr + m.diagnostics.amberArr)})`}.`
      : 'No open opportunity carries a Deal Health rating in this scope.', m.diagnostics.atRiskShareOfRated > 30 ? 'bad' : undefined);
    const worstOrg = [...m.winRateByOrg].filter(item => item.closed >= 3).sort((a, b) => (b.lossRate || 0) - (a.lossRate || 0))[0];
    if (worstOrg) add('Weakest segment', `**${worstOrg.label}** loses ${fmtPct(worstOrg.lossRate)} of its closed deals (${plural(worstOrg.lost, 'loss')} of ${fmtN(worstOrg.closed)}).`, (worstOrg.lossRate || 0) > (m.diagnostics.lossRate || 0) + 10 ? 'bad' : undefined);
  }
  if (view === 'velocity') {
    if (m.pulse.openCount) add('Stalled', publicSafe
      ? `**${fmtPct(m.velocity.stalledShare)}** of open opportunities (${fmtN(m.velocity.stalledCount)}) are past their stale threshold.`
      : `**${fmtPct(m.velocity.stalledShare)}** of open opportunities (${fmtN(m.velocity.stalledCount)}) are past their stale threshold — ${fmtMoney(m.velocity.stalledArr)} of open ARR.`, (m.velocity.stalledShare || 0) > 50 ? 'bad' : undefined);
    const slowest = [...m.daysByStage].filter(item => item.count >= 3).sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0))[0];
    if (slowest) add('Bottleneck', publicSafe
      ? `**${slowest.stage}** is the slowest stage: ${fmtPct(pct(slowest.stalled, slowest.count))} of its ${plural(slowest.count, 'open deal')} are stalled.`
      : `**${slowest.stage}** is the slowest stage at ${fmtN(slowest.avgDays)} days on average across ${plural(slowest.count, 'open deal')}.`);
    if (m.velocity.medianCycleWon !== null && m.velocity.medianCycleLost !== null && !publicSafe) {
      const faster = m.velocity.medianCycleWon <= m.velocity.medianCycleLost;
      add('Cycle', `Won deals close in **${fmtN(m.velocity.medianCycleWon)} days** (median) against ${fmtN(m.velocity.medianCycleLost)} for lost — winners move ${faster ? 'faster' : 'slower'}.`, faster ? 'good' : 'bad');
    } else if (publicSafe && m.pulse.openCount) {
      // The wall never quotes a day count, so the cycle reading becomes a
      // threshold multiple instead of a band of days.
      add('Dormant', `**${fmtN(m.velocity.wayOverCount)}** open deals (${fmtPct(pct(m.velocity.wayOverCount, m.pulse.openCount))}) have sat in their stage for twice its threshold.`, m.velocity.wayOverCount > m.pulse.openCount / 2 ? 'bad' : undefined);
    }
  }
  if (view === 'wherewewin') {
    const bestOrg = [...m.winRateByOrg].filter(item => item.closed >= 3).sort((a, b) => (b.winRate || 0) - (a.winRate || 0))[0];
    if (bestOrg) add('Best segment', `**${bestOrg.label}** converts best: ${fmtPct(bestOrg.winRate)} of ${plural(bestOrg.closed, 'closed deal')}${publicSafe ? '' : `, ${fmtMoney(bestOrg.wonArr)} won`}.`, 'good');
    const bestSource = [...m.leadSource].filter(item => item.closed >= 3).sort((a, b) => (b.winRate || 0) - (a.winRate || 0))[0];
    if (bestSource) add('Source', `**${bestSource.label}** deals win ${fmtPct(bestSource.winRate)} of the time (${fmtN(bestSource.closed)} closed)${publicSafe ? '' : ` — ${fmtMoney(bestSource.wonArr)} of Won ARR`}.`);
    let bestCell = null;
    m.heat.continents.forEach(continent => m.heat.orgs.forEach(org => {
      const cell = m.heat.cells[continent][org];
      if (cell.closed >= 5 && (!bestCell || (cell.winRate || 0) > (bestCell.winRate || 0))) bestCell = { continent, org, ...cell };
    }));
    if (bestCell) add('Sweet spot', `**${bestCell.continent} × ${bestCell.org}** is the strongest cell at ${fmtPct(bestCell.winRate)} (${fmtN(bestCell.closed)} closed).`, 'good');
  }
  if (view === 'repperformance') {
    const top = publicSafe ? m.repSummary.topByWins : m.repSummary.topByBookings;
    if (top && top.wins) add('Top rep', publicSafe
      ? `**${top.rep}** leads with ${plural(top.wins, 'win')} (${fmtPct(top.winRate)} win rate).`
      : `**${top.rep}** leads bookings with ${fmtMoney(top.booked)} from ${plural(top.wins, 'win')}.`, 'good');
    if (m.repSummary.topByWinRate) add('Best conversion', `**${m.repSummary.topByWinRate.rep}** has the best win rate, ${fmtPct(m.repSummary.topByWinRate.winRate)} on ${plural(m.repSummary.topByWinRate.closed, 'closed deal')}.`);
    const pod = publicSafe ? [...m.podPerformance].filter(item => item.closed >= 3).sort((a, b) => (b.winRate || 0) - (a.winRate || 0))[0] : m.podPerformance[0];
    if (pod) add('POD', publicSafe
      ? `**${pod.pod}** is the best-converting POD at ${fmtPct(pod.winRate)} (${fmtN(pod.closed)} closed).`
      : `**${pod.pod}** is the top POD by Won ARR — ${fmtMoney(pod.wonArr)} at ${fmtPct(pod.winRate)}.`);
  }
  return items.slice(0, 3);
}

export const OPPORTUNITY_VIEWS = ['pulse', 'diagnostics', 'velocity', 'wherewewin', 'repperformance'];

// The route's one call: filter, compute, compare, narrate.
export function buildOpportunitySnapshot(allRows, query = {}) {
  const rows = filterOpportunityRows(allRows, query);
  const metrics = buildOpportunityMetrics(rows);
  const comparison = buildGenericComparison(allRows, query);
  const highlights = Object.fromEntries(OPPORTUNITY_VIEWS.map(view => [view, buildOpportunityHighlights(metrics, view, { comparison })]));
  const publicHighlights = Object.fromEntries(OPPORTUNITY_VIEWS.map(view => [view, buildOpportunityHighlights(metrics, view, { comparison, publicSafe: true })]));
  return { rowCount: rows.length, metrics, comparison, highlights, publicHighlights };
}

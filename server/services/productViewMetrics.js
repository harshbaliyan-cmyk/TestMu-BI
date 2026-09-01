import { previousEqualPeriod } from './periodComparison.js';

// Product View works on PRODUCT LINE rows: one opportunity can appear on
// several rows, one per product it contains. Every ARR figure therefore sums
// plain rows (each row carries its product's share), while every opportunity
// count is a true COUNTD over Opportunity ID — summing per-row counts would
// double-count a deal that spans products, which is exactly the trap the
// grand-total rows exist to avoid. This is why nothing here reuses
// distinctOpportunityRows(): dropping duplicate IDs would drop product rows.

// Product ARR = ([TotalPrice] / [Subscription Duration]) * 12 — the LINE's
// annualised value, mapped as its own field. The opp-level `arr` is never
// read here: it repeats the whole deal's value on every product row.
const sumArr = rows => rows.reduce((total, row) => total + (Number(row.productArr) || 0), 0);
const distinctCount = rows => new Set(rows.map(row => String(row.id || '').trim()).filter(Boolean)).size;
// Undefined, not zero: a slice with nothing closed has no win rate yet, and
// the client renders null as an em dash / a break in the line.
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : null;

const isOpen = row => !row.isClosed;
const isWon = row => row.isClosed && row.isWon;
const isLost = row => row.isClosed && !row.isWon;
// The raw Opportunity Forecast column carries more categories than the board
// shows. In Tableau they are merged with an ad-hoc GROUP, but ad-hoc groups
// do not survive the published-datasource pull (the same reason POD is a
// calculation, not a group), so the raw values arrive here and the merge is
// applied in code. Three NAMED buckets — a null/blank forecast belongs to
// none of them, deliberately: "No Projection" is a rep's explicit call, an
// empty cell is the absence of one.
const FORECAST_BUCKETS = {
  commit: new Set(['commit']),
  'best case': new Set(['best case', 'high']),
  'no projection': new Set(['low', 'no projection']),
};
const forecastIs = (row, bucket) => {
  const value = String(row.opportunityForecast || '').trim().toLowerCase();
  return value !== '' && FORECAST_BUCKETS[bucket].has(value);
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Early → late, per the pipeline stacks. Unknown stage names slot in after
// the known open stages (alphabetically, for a stable render) but always
// before the closed pair.
const STAGE_ORDER = ['Prospecting','Qualification','Discovery','Demo','Evaluation','Trial','Proof of Concept','Proposal','Negotiation','Commit','Closed Won','Closed Lost'];
export function orderStages(stages) {
  const known = new Map(STAGE_ORDER.map((stage, index) => [stage.toLowerCase(), index]));
  const rank = stage => {
    const index = known.get(String(stage).toLowerCase());
    if (index !== undefined) return index;
    return String(stage).toLowerCase().includes('closed') ? STAGE_ORDER.length + 1 : STAGE_ORDER.length - 3.5;
  };
  return [...stages].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

// The shared calculation block from the spec, over one slice of rows.
export function summarizeProductRows(rows, label) {
  const openRows = rows.filter(isOpen);
  const wonRows = rows.filter(isWon);
  const lostRows = rows.filter(isLost);
  const commitRows = rows.filter(row => forecastIs(row, 'commit'));
  const bestCaseRows = rows.filter(row => forecastIs(row, 'best case'));
  const noProjectionRows = rows.filter(row => forecastIs(row, 'no projection'));
  const wonArr = sumArr(wonRows);
  const lostArr = sumArr(lostRows);
  const wonCount = distinctCount(wonRows);
  const lostCount = distinctCount(lostRows);
  return {
    label,
    openPipe: sumArr(openRows),
    openOppCount: distinctCount(openRows),
    closedWonArr: wonArr,
    closedWonCount: wonCount,
    closedLostArr: lostArr,
    closedLostCount: lostCount,
    commitArr: sumArr(commitRows),
    commitOppCount: distinctCount(commitRows),
    bestCaseArr: sumArr(bestCaseRows),
    bestCaseOppCount: distinctCount(bestCaseRows),
    noProjectionArr: sumArr(noProjectionRows),
    noProjectionOppCount: distinctCount(noProjectionRows),
    winRateCount: percent(wonCount, wonCount + lostCount),
    winRateArr: percent(wonArr, wonArr + lostArr),
    avgDealSize: wonCount ? wonArr / wonCount : null,
  };
}

const groupValues = (rows, key) => [...new Set(rows.map(row => row[key]).filter(Boolean))];

function groupSummaries(rows, key) {
  return groupValues(rows, key).map(value => summarizeProductRows(rows.filter(row => row[key] === value), value));
}

// Both views share one filter shelf; only the date field differs and is
// handled by each view's own scoping below.
export function applyCategoryFilters(rows, filters = {}) {
  const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  let filtered = rows;
  for (const field of ['productGroup','product','type','orgType','pod','stage','owner','continentGroup']) {
    const selected = list(filters[field]);
    if (selected.length) filtered = filtered.filter(row => selected.includes(row[field]));
  }
  return filtered;
}

export function resolveTrendYear(from, to) {
  const source = to || from;
  const year = source ? Number(String(source).slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

// value(rowsInBucket) per series member, for the trend year's 12 months and
// 4 quarters. Series = one entry per distinct `seriesKey` value, ordered by
// its full-year total descending so "top N" is a client-side slice. `count`
// rides along per bucket (a true COUNTD of the bucket's opportunities) so
// tooltips can say "$1.2M · 14 opps" without a second request.
function buildSeriesTrend(rows, dateField, seriesKey, year, value, count) {
  const inYear = rows.filter(row => row[dateField]?.startsWith(`${year}-`));
  const members = groupValues(inYear, seriesKey)
    .map(member => ({ member, rows: inYear.filter(row => row[seriesKey] === member) }))
    .sort((a, b) => value(b.rows) - value(a.rows));
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const quarterMonths = q => monthKeys.slice(q * 3, q * 3 + 3);
  return {
    year,
    monthlyLabels: monthKeys.map((_, i) => `${MONTH_ABBR[i]}-${String(year).slice(2)}`),
    quarterlyLabels: [1, 2, 3, 4].map(q => `Q${q}-${String(year).slice(2)}`),
    series: members.map(({ member, rows: memberRows }) => {
      const monthRows = monthKeys.map(key => memberRows.filter(row => row[dateField]?.startsWith(key)));
      const quarterRows = [0, 1, 2, 3].map(q =>
        memberRows.filter(row => quarterMonths(q).some(key => row[dateField]?.startsWith(key))));
      return {
        label: member,
        total: value(memberRows),
        monthly: monthRows.map(value),
        quarterly: quarterRows.map(value),
        monthlyCounts: monthRows.map(count),
        quarterlyCounts: quarterRows.map(count),
      };
    }),
  };
}

function kpiComparison(dateField, filtered, filters, dateFrom, dateTo, summarize) {
  const period = previousEqualPeriod(dateFrom, dateTo, filters.datePreset, filters.dateCount, filters.dateUnit);
  if (!period) return { available: false, reason: `Select both ${dateField === 'closeDate' ? 'Close' : 'Created'} Date boundaries` };
  const inRange = (row, from, to) => row[dateField] && row[dateField] >= from && row[dateField] <= to;
  const current = summarize(filtered.filter(row => inRange(row, period.currentFrom, period.currentTo)));
  const previous = summarize(filtered.filter(row => inRange(row, period.previousFrom, period.previousTo)));
  const growth = (now, before) => (Number(before) ? (now - before) / before * 100 : null);
  const points = (now, before) => (now === null || before === null ? null : now - before);
  return {
    available: true, period, current, previous,
    growth: {
      openPipe: growth(current.openPipe, previous.openPipe),
      closedWonArr: growth(current.closedWonArr, previous.closedWonArr),
      closedLostArr: growth(current.closedLostArr, previous.closedLostArr),
      commitArr: growth(current.commitArr, previous.commitArr),
      bestCaseArr: growth(current.bestCaseArr, previous.bestCaseArr),
      avgDealSize: growth(current.avgDealSize, previous.avgDealSize),
    },
    pointChange: {
      winRateCount: points(current.winRateCount, previous.winRateCount),
      winRateArr: points(current.winRateArr, previous.winRateArr),
    },
  };
}

// ===== View 1 — Pipeline, scoped by Opp Created Date =====
export function buildProductPipelineSnapshot(rows, filters = {}) {
  const categorical = applyCategoryFilters(rows, filters);
  const from = filters.createdFrom, to = filters.createdTo;
  let scoped = categorical;
  if (from) scoped = scoped.filter(row => row.createdDate && row.createdDate >= from);
  if (to) scoped = scoped.filter(row => row.createdDate && row.createdDate <= to);

  const overall = summarizeProductRows(scoped, 'All products');
  const byGroup = groupSummaries(scoped, 'productGroup').sort((a, b) => b.openPipe - a.openPipe);
  const byProduct = groupSummaries(scoped, 'product').sort((a, b) => b.openPipe - a.openPipe);

  // Open pipe by group, stacked by stage (open stages only — closed deals
  // have no place in an open-pipe stack), early → late.
  const openRows = scoped.filter(isOpen);
  const stages = orderStages(groupValues(openRows, 'stage'));
  const stageStack = groupValues(openRows, 'productGroup')
    .map(group => {
      const groupRows = openRows.filter(row => row.productGroup === group);
      const stageRows = stages.map(stage => groupRows.filter(row => row.stage === stage));
      return {
        label: group,
        total: sumArr(groupRows),
        totalCount: distinctCount(groupRows),
        stages: stageRows.map(sumArr),
        counts: stageRows.map(distinctCount),
      };
    })
    .sort((a, b) => b.total - a.total);

  // Trend follows the Win Board convention: the full calendar year of the
  // active range's end, so a narrow filter still shows the year's shape.
  const trendYear = resolveTrendYear(from, to);
  const trend = buildSeriesTrend(categorical, 'createdDate', 'productGroup', trendYear, sumArr, distinctCount);

  return {
    metrics: {
      overall, trendYear, trend, stages, stageStack,
      // Counts ride along so the chart's tooltip can say "$1.2M · 14 opps".
      forecastByGroup: byGroup.map(({ label, openPipe, openOppCount, commitArr, commitOppCount, bestCaseArr, bestCaseOppCount, noProjectionArr, noProjectionOppCount }) =>
        ({ label, openPipe, openOppCount, commitArr, commitOppCount, bestCaseArr, bestCaseOppCount, noProjectionArr, noProjectionOppCount })),
      funnelByGroup: byGroup,
      funnelByProduct: byProduct,
      topProducts: byProduct.map(({ label, openPipe, openOppCount }) => ({ label, openPipe, openOppCount })),
    },
    comparison: kpiComparison('createdDate', categorical, filters, from, to, r => summarizeProductRows(r, 'period')),
  };
}

// ===== View 2 — Won ARR, scoped by Opp Close Date =====
// Open pipe / Commit / Best Case are deliberately absent here: open deals
// carry tentative close dates, and filtering them by close date would turn
// this into a forecast view rather than an actual-won one.
export function buildProductWonSnapshot(rows, filters = {}) {
  const categorical = applyCategoryFilters(rows, filters);
  const from = filters.closeFrom, to = filters.closeTo;
  const closedOnly = categorical.filter(row => row.isClosed);
  let scoped = closedOnly;
  if (from) scoped = scoped.filter(row => row.closeDate && row.closeDate >= from);
  if (to) scoped = scoped.filter(row => row.closeDate && row.closeDate <= to);

  const overall = summarizeProductRows(scoped, 'All products');
  const byGroup = groupSummaries(scoped, 'productGroup').sort((a, b) => b.closedWonArr - a.closedWonArr);
  const byProduct = groupSummaries(scoped, 'product').sort((a, b) => b.closedWonArr - a.closedWonArr);

  const trendYear = resolveTrendYear(from, to);
  const wonValue = slice => sumArr(slice.filter(isWon));
  const wonCount = slice => distinctCount(slice.filter(isWon));
  const trendByGroup = buildSeriesTrend(closedOnly, 'closeDate', 'productGroup', trendYear, wonValue, wonCount);
  const trendByProduct = buildSeriesTrend(closedOnly, 'closeDate', 'product', trendYear, wonValue, wonCount);

  // Product mix: each group's share of that quarter's total Won ARR — the
  // shares within one quarter add to 100 by construction.
  const quarterTotals = [0, 1, 2, 3].map(q =>
    trendByGroup.series.reduce((total, series) => total + series.quarterly[q], 0));
  const productMix = {
    labels: trendByGroup.quarterlyLabels,
    groups: trendByGroup.series.map(series => ({
      label: series.label,
      shares: series.quarterly.map((value, q) => percent(value, quarterTotals[q])),
    })),
  };

  return {
    metrics: {
      overall, trendYear, trendByGroup, trendByProduct, productMix,
      winRateByGroup: byGroup.map(({ label, winRateCount, winRateArr }) => ({ label, winRateCount, winRateArr })),
      winRateByProduct: byProduct.map(({ label, winRateCount, winRateArr }) => ({ label, winRateCount, winRateArr })),
      avgDealSizeByProduct: byProduct
        .filter(item => item.avgDealSize !== null)
        .map(({ label, avgDealSize }) => ({ label, avgDealSize }))
        .sort((a, b) => b.avgDealSize - a.avgDealSize),
      wonLostByGroup: byGroup,
      wonLostByProduct: byProduct,
    },
    comparison: kpiComparison('closeDate', closedOnly, filters, from, to, r => summarizeProductRows(r, 'period')),
  };
}

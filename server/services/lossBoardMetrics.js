import {previousEqualPeriod,compareLossArr} from './periodComparison.js';
import {distinctOpportunityRows,resolveTrendYear} from './winBoardMetrics.js';

const sumArr = rows => rows.reduce((total, row) => total + (Number(row.arr) || 0), 0);
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : 0;

// Loss Board's mirror of winBoardMetrics.js's summarizeWinRows: same shape,
// three metrics renamed to their loss equivalents (lossOppRate/arrLostRate/
// lossContribution instead of dealWinRate/arrWinRate/contribution).
export function summarizeLossRows(rows, label, totalLostArr) {
  const closedRows = rows.filter(row => row.isClosed);
  const openRows = rows.filter(row => !row.isClosed);
  const wonRows = closedRows.filter(row => row.isWon);
  const lostRows = closedRows.filter(row => !row.isWon);
  const lostArr = sumArr(lostRows);
  const closedArr = sumArr(closedRows);
  const totalArr = sumArr(rows);
  const openArr = sumArr(openRows);
  return {
    label,
    opportunities: rows.length,
    open: openRows.length,
    lostArr,
    closedArr,
    totalArr,
    openArr,
    closed: closedRows.length,
    wins: wonRows.length,
    losses: lostRows.length,
    // SUM(IF Lost THEN 1 ELSE 0 END) / SUM(IF Closed THEN 1 ELSE 0 END)
    lossOppRate: percent(lostRows.length, closedRows.length),
    // COUNTD(IF [Opp Stage]="Closed Lost" THEN [Opp Id] END) / COUNTD(Total [Opp Id])
    lossOppRateOfAll: percent(lostRows.length, rows.length),
    // SUM(IF Lost THEN ARR END) / SUM(IF Closed THEN ARR END)
    arrLostRate: percent(lostArr, closedArr),
    // SUM(IF NOT [Closed] THEN [ARR] END) / SUM([ARR])
    openArrPct: percent(openArr, totalArr),
    // COUNTD(IF NOT [Closed] THEN [Opp Id] END) / COUNTD([Opp Id])
    openOppRate: percent(openRows.length, rows.length),
    // SUM(Lost ARR for category) / TOTAL(SUM(Lost ARR))
    lossContribution: percent(lostArr, totalLostArr),
  };
}

function groupRows(rows, key, totalLostArr) {
  return [...new Set(rows.map(row => row[key]).filter(Boolean))]
    .map(value => summarizeLossRows(rows.filter(row => row[key] === value), value, totalLostArr));
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(period) {
  const [year, month] = period.split('-');
  return `${MONTH_ABBR[Number(month)-1]}-${year.slice(2)}`;
}

// Mirrors winBoardMetrics.js's buildYearlyTrend/emptyYearSummary — see the
// comments there for why the trend is always a full calendar year (plus
// year-1 for a true year-over-year line) regardless of the active date
// filter, and why a dataless month/quarter is null rather than a
// misleading flat 0%.
function emptyYearSummary(label) {
  return {
    label, opportunities: 0, open: 0, lostArr: 0, closedArr: 0, totalArr: 0, openArr: 0,
    closed: 0, wins: 0, losses: 0,
    lossOppRate: null, lossOppRateOfAll: null, arrLostRate: null, openArrPct: null, openOppRate: null, lossContribution: null,
  };
}

export function buildYearlyLossTrend(yearRows, year) {
  const totalLostArr = sumArr(yearRows.filter(row => row.isClosed && !row.isWon));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const rows = yearRows.filter(row => row.createdDate?.startsWith(period));
    const label = `${MONTH_ABBR[i]}-${String(year).slice(2)}`;
    return { ...(rows.length ? summarizeLossRows(rows, label, totalLostArr) : emptyYearSummary(label)), period };
  });
  const quarterly = Array.from({ length: 4 }, (_, i) => {
    const quarter = i + 1;
    const monthKeys = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3].map(m => `${year}-${String(m).padStart(2, '0')}`);
    const rows = yearRows.filter(row => row.createdDate && monthKeys.some(key => row.createdDate.startsWith(key)));
    const label = `Q${quarter}-${String(year).slice(2)}`;
    return { ...(rows.length ? summarizeLossRows(rows, label, totalLostArr) : emptyYearSummary(label)), period: `${year}-Q${quarter}` };
  });
  return { monthly, quarterly };
}

export function buildLossBoardMetrics(rows) {
  const seen = new Set();
  rows = rows.filter(row => {
    const id = String(row.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const totalLostArr = sumArr(rows.filter(row => row.isClosed && !row.isWon));
  const overall = summarizeLossRows(rows, 'All opportunities', totalLostArr);

  // Lost after trial: COUNTD(IF NOT ISNULL([Trial Stage At]) AND [Opp Stage] =
  // "Closed Lost" THEN [Opp Id] END), and its rate against every closed
  // opportunity that also reached a trial (not against all lost deals).
  const trialClosedRows = rows.filter(row => row.isClosed && row.trialStageAt);
  const trialLostRows = trialClosedRows.filter(row => !row.isWon);
  overall.lostAfterTrial = {
    count: trialLostRows.length,
    trialClosedCount: trialClosedRows.length,
    rate: percent(trialLostRows.length, trialClosedRows.length),
  };

  const periods = [...new Set(rows.map(row => row.createdDate?.slice(0, 7)).filter(Boolean))].sort();
  const trend = periods.map(period => ({
    ...summarizeLossRows(rows.filter(row => row.createdDate?.startsWith(period)), monthLabel(period), totalLostArr),
    period,
  }));
  const pods = groupRows(rows, 'pod', totalLostArr).filter(item => item.closed > 0).sort((a,b) => b.lostArr-a.lostArr);
  const orgTypes = groupRows(rows, 'orgType', totalLostArr).filter(item => item.closed > 0).sort((a,b) => b.lostArr-a.lostArr);
  // lossReason is only ever populated on lost deals, so grouping by it
  // already excludes won/open rows without an extra filter.
  const lossReasons = groupRows(rows, 'lossReason', totalLostArr).sort((a,b) => b.lostArr-a.lostArr);
  return { overall, trend, pods, orgTypes, lossReasons };
}

function compareGroup(currentItems, previousItems, metric) {
  const previousByLabel = new Map(previousItems.map(item => [item.label, item]));
  return currentItems.map(item => {
    const previous = previousByLabel.get(item.label);
    const hasPrevious = Boolean(previous);
    const currentLossOppRate = Number(item.lossOppRate) || 0;
    const currentArrLostRate = Number(item.arrLostRate) || 0;
    const currentLossContribution = Number(item.lossContribution) || 0;
    const previousLossOppRate = hasPrevious ? (Number(previous.lossOppRate) || 0) : null;
    const previousArrLostRate = hasPrevious ? (Number(previous.arrLostRate) || 0) : null;
    const previousLossContribution = hasPrevious ? (Number(previous.lossContribution) || 0) : null;
    const currentByMetric = {
      lossOppRate: currentLossOppRate,
      arrLostRate: currentArrLostRate,
      lossContribution: currentLossContribution,
    };
    const previousByMetric = {
      lossOppRate: previousLossOppRate,
      arrLostRate: previousArrLostRate,
      lossContribution: previousLossContribution,
    };
    const pointChange = (currentValue, previousValue) => hasPrevious ? currentValue - previousValue : null;
    const lossOppRatePointChange = pointChange(currentLossOppRate, previousLossOppRate);
    const arrLostRatePointChange = pointChange(currentArrLostRate, previousArrLostRate);
    const lossContributionPointChange = pointChange(currentLossContribution, previousLossContribution);
    const pointChanges = { lossOppRatePointChange, arrLostRatePointChange, lossContributionPointChange };
    const currentValue = currentByMetric[metric];
    const previousValue = previousByMetric[metric];
    const currentLostArr = Number(item.lostArr) || 0;
    const previousLostArr = Number(previous?.lostArr) || 0;
    const hasLostArrBaseline = hasPrevious && previousLostArr !== 0;
    return {
      label: item.label,
      metric,
      current: currentValue,
      previous: hasPrevious ? previousValue : null,
      hasPrevious,
      hasLostArrBaseline,
      lostArrGrowthPct: hasLostArrBaseline ? (currentLostArr-previousLostArr)/previousLostArr*100 : null,
      changePoints: pointChanges[`${metric}PointChange`],
      currentLossOppRate, previousLossOppRate, lossOppRatePointChange,
      currentArrLostRate, previousArrLostRate, arrLostRatePointChange,
      currentLossContribution, previousLossContribution, lossContributionPointChange,
      metrics: {
        lossOppRate: { current: currentLossOppRate, previous: previousLossOppRate, changePoints: lossOppRatePointChange },
        arrLostRate: { current: currentArrLostRate, previous: previousArrLostRate, changePoints: arrLostRatePointChange },
        lossContribution: { current: currentLossContribution, previous: previousLossContribution, changePoints: lossContributionPointChange },
      },
    };
  });
}

export function buildLossBoardComparisons(currentRows, previousRows) {
  const current = buildLossBoardMetrics(currentRows), previous = buildLossBoardMetrics(previousRows);
  return {
    pods: compareGroup(current.pods, previous.pods, 'lossContribution'),
    orgTypes: compareGroup(current.orgTypes, previous.orgTypes, 'arrLostRate'),
    lossReasons: compareGroup(current.lossReasons, previous.lossReasons, 'lossContribution'),
  };
}

export function buildLossBoardSnapshot(rows, filters = {}) {
  const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  // Industry is a filter here even though the Loss Board has no industry
  // chart (unlike Win Board): narrowing the scope to an industry and asking
  // "what are we losing on, and why" is a real question, and every other
  // Loss Board chart answers it. Same four categorical filters as Win Board.
  const baseFilters = { region: filters.region, orgType: filters.orgType, industry: filters.industry, type: filters.type };
  let filtered = rows;
  for (const [field, value] of Object.entries(baseFilters)) {
    const selected = list(value);
    if (selected.length) filtered = filtered.filter(row => selected.includes(row[field]));
  }

  const inRange = (row, from, to) => row.createdDate && row.createdDate >= from && row.createdDate <= to;
  // Always a full calendar year for the trend chart, regardless of the
  // active date filter — see buildYearlyLossTrend / resolveTrendYear.
  const trendYear = resolveTrendYear(filters);
  const previousTrendYear = trendYear - 1;
  const trend = buildYearlyLossTrend(distinctOpportunityRows(filtered.filter(row => inRange(row, `${trendYear}-01-01`, `${trendYear}-12-31`))), trendYear);
  const previousTrend = buildYearlyLossTrend(distinctOpportunityRows(filtered.filter(row => inRange(row, `${previousTrendYear}-01-01`, `${previousTrendYear}-12-31`))), previousTrendYear);

  const period = previousEqualPeriod(
    filters.createdFrom, filters.createdTo, filters.datePreset, filters.dateCount, filters.dateUnit,
  );
  if (!period) {
    let currentRows = filtered;
    if (filters.createdFrom) currentRows = currentRows.filter(row => row.createdDate && row.createdDate >= filters.createdFrom);
    if (filters.createdTo) currentRows = currentRows.filter(row => row.createdDate && row.createdDate <= filters.createdTo);
    const metrics = buildLossBoardMetrics(distinctOpportunityRows(currentRows));
    metrics.trend = trend; metrics.trendYear = trendYear;
    return { metrics, comparison: { available: false, reason: 'Select both Created Date boundaries', previousTrend, previousTrendYear } };
  }

  const currentRows = distinctOpportunityRows(filtered.filter(row => inRange(row, period.currentFrom, period.currentTo)));
  const previousRows = distinctOpportunityRows(filtered.filter(row => inRange(row, period.previousFrom, period.previousTo)));
  const comparison = compareLossArr(currentRows, previousRows, period);
  comparison.groups = buildLossBoardComparisons(currentRows, previousRows);
  comparison.previousTrend = previousTrend;
  comparison.previousTrendYear = previousTrendYear;
  const metrics = buildLossBoardMetrics(currentRows);
  metrics.trend = trend; metrics.trendYear = trendYear;
  return { metrics, comparison: { available: true, ...comparison } };
}

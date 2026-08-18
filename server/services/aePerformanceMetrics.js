import {previousEqualPeriod} from './periodComparison.js';
import {distinctOpportunityRows} from './winBoardMetrics.js';

const sumArr = rows => rows.reduce((total, row) => total + (Number(row.arr) || 0), 0);
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : 0;

// The board is scoped to AE-owned rows: STARTSWITH([Role Name],"AE").
// Case-sensitive prefix match on purpose — matches the source formula exactly
// rather than guessing at casing tolerance the way the pod calc's UPPER() does.
const isAeRow = row => typeof row.ownerRole === 'string' && row.ownerRole.startsWith('AE');

// Contribution is a rep's share of WON ARR:
//   {FIXED [Opp Owner Id]: SUM(IF [Closed Won] AND STARTSWITH([Role Name],"AE") THEN [Opp ARR] END)}
//   / {FIXED: SUM(IF [Closed Won] AND STARTSWITH([Role Name],"AE") THEN [Opp ARR] END)}
// Won only, not all closed ARR — a lost deal is not a contribution, so
// including losses in the numerator would rank a rep highly for losing a
// large deal. Same semantics as Win Board's Won ARR contribution %, scoped
// to AE reps instead of PODs.
export function summarizeAeRep(rows, label, totalWonAeArr) {
  const closedRows = rows.filter(row => row.isClosed);
  const wonRows = closedRows.filter(row => row.isWon);
  const closedArr = sumArr(closedRows);
  const wonArr = sumArr(wonRows);
  return {
    label,
    opportunities: rows.length,
    closed: closedRows.length,
    wins: wonRows.length,
    losses: closedRows.length - wonRows.length,
    closedArr,
    wonArr,
    dealWinRate: percent(wonRows.length, closedRows.length),
    arrWinRate: percent(wonArr, closedArr),
    // SUM(Won ARR for this rep) / TOTAL(SUM(Won ARR)) — among AE rows only.
    contribution: percent(wonArr, totalWonAeArr),
  };
}

// Both rankings share one denominator (total AE Won ARR), so rep
// contributions and POD contributions are directly comparable and each
// list sums to 100% on its own.
function groupBy(rows, keyOf, totalWonAeArr) {
  return [...new Set(rows.map(keyOf).filter(Boolean))]
    .map(value => summarizeAeRep(rows.filter(row => keyOf(row) === value), value, totalWonAeArr))
    // No Won ARR means no contribution by definition; dropped rather than
    // listed as a run of 0% rows on a top-performer board.
    .filter(item => item.wonArr > 0)
    .sort((a, b) => b.contribution - a.contribution);
}

// The same POD field the Win and Loss boards group by — all three read the
// same source, so the PODs must be the same PODs ("EMEA AE", "AMER AE II",
// …). This used to group by the raw Role Name instead, which splits the
// identical rows a different way and, worse, collapsed a six-POD board down
// to whichever couple of roles happened to hold Won ARR.
//
// Role Name is kept as a fallback for a source that maps it but has no POD
// column: without one the ranking would be empty rather than merely grouped
// differently, and the AE row filter already depends on Role Name anyway.
const podOf = row => row.pod || row.ownerRole;

export function buildAePerformanceMetrics(rows) {
  const aeRows = rows.filter(isAeRow);
  const totalWonAeArr = sumArr(aeRows.filter(row => row.isClosed && row.isWon));
  const overall = summarizeAeRep(aeRows, 'All AE reps', totalWonAeArr);
  const reps = groupBy(aeRows, row => row.owner, totalWonAeArr);
  const pods = groupBy(aeRows, podOf, totalWonAeArr);
  return { overall, reps, pods };
}

function compareGroup(currentItems, previousItems) {
  const previousByLabel = new Map(previousItems.map(item => [item.label, item]));
  return currentItems.map(item => {
    const previous = previousByLabel.get(item.label);
    const hasPrevious = Boolean(previous);
    const currentContribution = Number(item.contribution) || 0;
    const previousContribution = hasPrevious ? (Number(previous.contribution) || 0) : null;
    const currentWonArr = Number(item.wonArr) || 0;
    const previousWonArr = Number(previous?.wonArr) || 0;
    const hasWonArrBaseline = hasPrevious && previousWonArr !== 0;
    return {
      label: item.label,
      current: currentContribution,
      previous: previousContribution,
      hasPrevious,
      changePoints: hasPrevious ? currentContribution - previousContribution : null,
      // Contribution is a share, so it can fall while a rep's own Won ARR
      // grows (the team total grew faster). This carries the rep's actual
      // Won ARR movement alongside it so the two are never conflated.
      hasWonArrBaseline,
      wonArrGrowthPct: hasWonArrBaseline ? (currentWonArr - previousWonArr) / previousWonArr * 100 : null,
    };
  });
}

export function buildAePerformanceComparisons(currentRows, previousRows) {
  const current = buildAePerformanceMetrics(currentRows), previous = buildAePerformanceMetrics(previousRows);
  return {
    reps: compareGroup(current.reps, previous.reps),
    pods: compareGroup(current.pods, previous.pods),
  };
}

export function buildAePerformanceSnapshot(rows, filters = {}) {
  const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  const baseFilters = { region: filters.region, orgType: filters.orgType, type: filters.type };
  let filtered = distinctOpportunityRows(rows);
  for (const [field, value] of Object.entries(baseFilters)) {
    const selected = list(value);
    if (selected.length) filtered = filtered.filter(row => selected.includes(row[field]));
  }

  // Close date, not created date (unlike Win Board and Loss Board, which rank
  // on when an opportunity was raised). This board ranks reps by Won ARR, and
  // a win belongs to the period the deal actually closed in — crediting it to
  // the quarter the opportunity was first created would attribute this
  // quarter's revenue to whenever the pipeline happened to be built.
  const inRange = (row, from, to) => row.closeDate && row.closeDate >= from && row.closeDate <= to;

  const period = previousEqualPeriod(
    filters.closeFrom, filters.closeTo, filters.datePreset, filters.dateCount, filters.dateUnit,
  );
  if (!period) {
    let currentRows = filtered;
    if (filters.closeFrom) currentRows = currentRows.filter(row => row.closeDate && row.closeDate >= filters.closeFrom);
    if (filters.closeTo) currentRows = currentRows.filter(row => row.closeDate && row.closeDate <= filters.closeTo);
    const metrics = buildAePerformanceMetrics(currentRows);
    return { metrics, comparison: { available: false, reason: 'Select both Close Date boundaries' } };
  }

  const currentRows = filtered.filter(row => inRange(row, period.currentFrom, period.currentTo));
  const previousRows = filtered.filter(row => inRange(row, period.previousFrom, period.previousTo));
  const metrics = buildAePerformanceMetrics(currentRows);
  const comparison = { available: true, period, groups: buildAePerformanceComparisons(currentRows, previousRows) };
  return { metrics, comparison };
}

import {previousEqualPeriod} from './periodComparison.js';
import {filterRepList, isActiveRep, repStatusSummary, resolveRepStatus} from './repStatus.js';
import {distinctOpportunityRows} from './winBoardMetrics.js';

const sumArr = rows => rows.reduce((total, row) => total + (Number(row.arr) || 0), 0);
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : 0;

// The board is scoped to AE-owned rows: STARTSWITH([Role Name],"AE").
// Case-sensitive prefix match on purpose — matches the source formula exactly
// rather than guessing at casing tolerance the way the pod calc's UPPER() does.
const isAeRow = row => typeof row.ownerRole === 'string' && row.ownerRole.startsWith('AE');

// AM Performance is the same board with one different scope rule, so the row
// filter is injected rather than the whole module being copied. Everything
// downstream - quota, attainment, POD sums, rep status, comparisons - is
// shared, which is the point: the two boards cannot drift apart.
//
// Word boundary, NOT a substring. "AMER AE II", "AMER AE I" and "AMER AE Corp"
// all contain the letters "AM", so a plain includes() check pulls seven PODs
// into an AM board instead of three.
export const isAmRow = row => typeof row.pod === 'string'
  && row.pod.split(/[^A-Za-z0-9]+/).includes('AM');

// ===== QUOTA ATTAINMENT =====
//
// Ranking metric for this board:
//   IF   {FIXED [Full Name]: MIN([Quota])} = 0 THEN NULL
//   ELSE {FIXED [Full Name]: SUM([Won ARR])} / {FIXED [Full Name]: MIN([Quota])}
//
// Two things about that translation are deliberate.
//
// MIN, not SUM, on the quota. Quota arrives repeated on every one of a rep's
// opportunity rows, so summing it would multiply the target by their deal
// count and drive attainment towards zero for the busiest reps.
//
// The numerator is computed from rows rather than read from the source's
// pre-aggregated "Q3 Won ARR" column. The two agree to the dollar on all nine
// PODs against the live extract, so this is not a guess at what that column
// means - it is a deliberate choice to derive both quarters identically. The
// pre-aggregated column exists for ONE hard-coded quarter, so reading it would
// make the two halves of the comparison tile incomparable the moment the
// quarter rolls, and a gap between them would be a definitional artefact
// rather than a real movement.

// Quarter containing a YYYY-MM-DD date, as the quarter's first day.
export function quarterStartOf(isoDate) {
  if (!isoDate) return null;
  const [y, m] = String(isoDate).split('-').map(Number);
  if (!y || !m) return null;
  const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(firstMonth).padStart(2, '0')}-01`;
}

export function previousQuarterStart(quarterStart) {
  if (!quarterStart) return null;
  const [y, m] = quarterStart.split('-').map(Number);
  return m === 1 ? `${y - 1}-10-01` : `${y}-${String(m - 3).padStart(2, '0')}-01`;
}

// A quota belongs to a quarter, and the board reports on whichever quarter we
// are actually in. Derived from the clock rather than from the filter, so the
// denominator cannot silently become a partial period: filtering to two weeks
// must not make every rep look like they missed their number.
export function resolveQuotaQuarters(today = new Date()) {
  const current = quarterStartOf(today.toISOString().slice(0, 10));
  return { current, previous: previousQuarterStart(current) };
}

// Reads the period a quota column claims, from its own name. Handles both
// naming conventions present in the source ("Q3-2026 Quota" and "Q2'26 Quota").
// Returns null when the name carries no period, in which case nothing is
// asserted - a guard that guesses is worse than no guard.
export function quarterFromColumnName(columnName) {
  if (!columnName) return null;
  const match = String(columnName).match(/Q([1-4])\D{0,3}((?:20)?\d{2})\b/i);
  if (!match) return null;
  const quarter = Number(match[1]);
  const rawYear = match[2];
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return { quarter, year, label: `Q${quarter}-${year}` };
}

const quarterLabel = quarterStart => {
  if (!quarterStart) return null;
  const [y, m] = quarterStart.split('-').map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1}-${y}`;
};

// One quota per rep. Nulls are skipped so a rep whose quota lands on only
// some of their rows still resolves.
// A quota belongs to a PERSON, so it is read per person and then summed.
//
// This used to be a flat Math.min over every row handed in. For one rep that is
// correct - all their rows carry the same number. For a POD it returned the
// single smallest member's quota while the numerator summed the whole POD's
// Won ARR, so a POD of three reps read at roughly three times its real
// attainment. That is what produced 773%.
//
// Summing per-rep minimums is right for both: an individual rep is just the
// single-member case, so one rule serves both rankings.
const quotaByRep = (rows, field) => {
  const perRep = new Map();
  for (const row of rows) {
    // Rows with no owner collapse into one bucket rather than being dropped:
    // for an individual rep group that is exactly the right reading, and for
    // unassigned rows it keeps their target visible instead of silently zero.
    const rep = row.owner || String.fromCharCode(0) + "unowned";
    const value = Number(row[field]);
    if (!Number.isFinite(value)) continue;
    perRep.set(rep, perRep.has(rep) ? Math.min(perRep.get(rep), value) : value);
  }
  return perRep;
};

const quotaOf = (rows, field) => {
  const perRep = quotaByRep(rows, field);
  if (!perRep.size) return null;
  let total = 0;
  for (const value of perRep.values()) total += value;
  return total;
};

// Reps carrying no usable target. Their ARR is excluded from the numerator as
// well, so a rep contributes to both halves of the fraction or to neither -
// counting revenue with no target behind it is the same inflation in miniature.
const repsWithoutQuota = (rows, field) => {
  const withQuota = new Set(quotaByRep(rows, field).keys());
  return new Set(rows.map(row => row.owner).filter(rep => rep && !withQuota.has(rep)));
};

const wonArrInQuarter = (rows, quarterStart, excludeReps = null) => rows
  .filter(row => row.isWon && row.isClosed && quarterStartOf(row.closeDate) === quarterStart)
  .filter(row => !excludeReps || !excludeReps.has(row.owner))
  .reduce((total, row) => total + (Number(row.arr) || 0), 0);

// EVERY rep carrying a target is in the denominator, including reps who closed
// nothing this quarter. A POD must not improve its percentage by having a
// member go quiet - a quiet quarter is a miss, and hiding the miss is the one
// thing this board must not do.
//
// This is a deliberate, known divergence from the reference Tableau view.
// There, "Won ARR" is NULL - never 0 - on every non-winning row, so a rep who
// closed nothing draws no marks, drops out of the view, and takes their quota
// out of the SUM with them. That is a property of how the view is built rather
// than a decision anyone made, and it inflates a POD by exactly the target of
// whoever had a bad quarter (AMER AE III reads 31.9% there against 12.3% of
// its real team target). The board reports the full target on purpose.
//
// Returns null (not zero) when there is no usable target, matching the
// source formula's NULL branch. Null means "cannot be measured"; zero means
// "measured, and they have not closed anything" - the board must not conflate
// the two, so they sort differently.
export function quotaAttainment(rows, quotaField, quarterStart) {
  const quota = quotaOf(rows, quotaField);
  const untargeted = repsWithoutQuota(rows, quotaField);
  // Reported so an excluded rep is visible rather than silently missing.
  const excludedArr = wonArrInQuarter(rows, quarterStart) - wonArrInQuarter(rows, quarterStart, untargeted);
  const wonArr = wonArrInQuarter(rows, quarterStart, untargeted);
  if (quota === null || quota === 0) {
    return { quota, wonArr, attainment: null, repsWithoutQuota: untargeted.size, excludedArr };
  }
  return { quota, wonArr, attainment: wonArr / quota * 100, repsWithoutQuota: untargeted.size, excludedArr };
}


// Contribution is a rep's share of WON ARR:
//   {FIXED [Opp Owner Id]: SUM(IF [Closed Won] AND STARTSWITH([Role Name],"AE") THEN [Opp ARR] END)}
//   / {FIXED: SUM(IF [Closed Won] AND STARTSWITH([Role Name],"AE") THEN [Opp ARR] END)}
// Won only, not all closed ARR — a lost deal is not a contribution, so
// including losses in the numerator would rank a rep highly for losing a
// large deal. Same semantics as Win Board's Won ARR contribution %, scoped
// to AE reps instead of PODs.
export function summarizeAeRep(rows, label, totalWonAeArr, quarters = null, quotaOptions = {}) {
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
    // No longer the ranking metric, but still computed: it answers "who drove
    // the quarter" where attainment answers "who hit their number".
    contribution: percent(wonArr, totalWonAeArr),
    ...quotaBlock(rows, quarters, quotaOptions),
  };
}

// Quota figures are quarter-anchored and filter-independent, so they are
// derived from the rep's full row set rather than the date-filtered slice.
function quotaBlock(rows, quarters, quotaOptions = {}) {
  if (!quarters) return { quota: null, quotaWonArr: 0, attainment: null, priorQuota: null, priorWonArr: 0, priorAttainment: null };
  // The rep-status filter reaches the quota calculation, and ONLY the quota
  // calculation. Win rates, deal counts and contribution still read every row,
  // so a departed rep's closed history keeps reconciling with what was
  // reported at the time - see repStatus.js. Their TARGET, though, left with
  // them: a quarter's quota belongs to whoever is carrying it now.
  const scoped = quotaOptions.activeOnly ? rows.filter(isActiveRep) : rows;
  const now = quotaAttainment(scoped, 'quotaCurrent', quarters.current);
  const prior = quotaAttainment(scoped, 'quotaPrior', quarters.previous);
  return {
    quota: now.quota, quotaWonArr: now.wonArr, attainment: now.attainment,
    repsWithoutQuota: now.repsWithoutQuota, excludedArr: now.excludedArr,
    priorQuota: prior.quota, priorWonArr: prior.wonArr, priorAttainment: prior.attainment,
  };
}

// Both rankings share one denominator (total AE Won ARR), so rep
// contributions and POD contributions are directly comparable and each
// list sums to 100% on its own.
function groupBy(rows, keyOf, totalWonAeArr, quarters, quotaOptions = {}) {
  return [...new Set(rows.map(keyOf).filter(Boolean))]
    .map(value => summarizeAeRep(rows.filter(row => keyOf(row) === value), value, totalWonAeArr, quarters, quotaOptions))
    // Everyone carrying a measurable quota stays on the board, including reps
    // at 0%. On a quota board that rep is the whole point of looking; dropping
    // them would hide exactly the conversation the ranking exists to start.
    // Reps with no usable quota (unmapped, or a zero target) sort to the end,
    // after the genuine zeroes, because "cannot be measured" is not a score.
    .sort((a, b) => {
      const av = a.attainment, bv = b.attainment;
      if (av === null && bv === null) return b.wonArr - a.wonArr;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
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

export function buildAePerformanceMetrics(rows, quarters = null, repStatus = 'active', scope = isAeRow) {
  const aeRows = rows.filter(scope);
  // Every aggregate below is built from the FULL row set. Departed reps are
  // removed from the individual list at the end, after the denominators are
  // already fixed, so hiding a rep never moves a total or a POD figure.
  const totalWonAeArr = sumArr(aeRows.filter(row => row.isClosed && row.isWon));

  // How a GROUPING (a POD, or the all-reps total) reads its quota differs from
  // one rep's own row set in exactly ONE way: a departed rep takes their target
  // with them. Everyone still here is in the denominator whether or not they
  // closed anything, so a quiet quarter shows up as the miss it is.
  //
  // This cannot fire on an unmapped Active field. With no row anywhere flagged
  // active, "hide the inactive" would empty every denominator and read as data
  // loss rather than as a missing mapping - the same guard, and the same
  // reason, as filterRepList.
  const groupQuota = {
    activeOnly: resolveRepStatus(repStatus) === 'active' && aeRows.some(isActiveRep),
  };

  const overall = summarizeAeRep(aeRows, 'All AE reps', totalWonAeArr, quarters, groupQuota);
  const allReps = groupBy(aeRows, row => row.owner, totalWonAeArr, quarters);
  const pods = groupBy(aeRows, podOf, totalWonAeArr, quarters, groupQuota);
  const reps = filterRepList(allReps, aeRows, row => row.owner, repStatus);
  return {
    overall, reps, pods,
    // Rep contributions no longer sum to 100 once anyone is hidden: the
    // denominator still holds the departed reps' ARR, by design. Reported so
    // the shortfall is explained rather than looking like a rounding fault.
    repsHidden: allReps.length - reps.length,
    repStatus: { ...repStatusSummary(aeRows), mode: resolveRepStatus(repStatus) },
  };
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

export function buildAePerformanceComparisons(currentRows, previousRows, repStatus = 'active', scope = isAeRow) {
  const current = buildAePerformanceMetrics(currentRows, null, repStatus, scope),
        previous = buildAePerformanceMetrics(previousRows, null, repStatus, scope);
  return {
    reps: compareGroup(current.reps, previous.reps),
    pods: compareGroup(current.pods, previous.pods),
  };
}

function describeMismatch(columnName, expectedLabel) {
  const claimed = quarterFromColumnName(columnName);
  if (!claimed || !expectedLabel) return null;
  return claimed.label === expectedLabel ? null : { expected: expectedLabel, mappedTo: claimed.label, columnName };
}

export function buildAePerformanceSnapshot(rows, filters = {}, options = {}) {
  const scope = options.scope || isAeRow;
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
  // Quota is a commitment for a whole quarter, so its numerator and
  // denominator are both anchored to that quarter and NOT to the date filter.
  // `filtered` here has had the dimension filters applied but not the date
  // ones, which is exactly the input the quota figures need: filtering to a
  // fortnight must narrow the pipeline tiles without making every rep appear
  // to have missed a target they still have weeks to hit.
  const quarters = resolveQuotaQuarters();
  const quota = {
    currentQuarter: quarterLabel(quarters.current),
    previousQuarter: quarterLabel(quarters.previous),
    currentQuarterStart: quarters.current,
    previousQuarterStart: quarters.previous,
    // Surfaced so the board can say so on screen rather than leaving a viewer
    // to assume the headline number moves with the picker.
    ignoresDateFilter: true,
    mapped: filtered.some(row => row.quotaCurrent !== null && row.quotaCurrent !== undefined),
    priorMapped: filtered.some(row => row.quotaPrior !== null && row.quotaPrior !== undefined),
    sourceColumn: options.quotaSourceColumn || null,
    priorSourceColumn: options.quotaPriorSourceColumn || null,
    // A quota column named for a different quarter than the one being reported
    // still produces a full, plausible-looking board - just against the wrong
    // target. Surfaced rather than corrected: the column name is a hint, not
    // authority, so the board warns and the human decides.
    mismatch: describeMismatch(options.quotaSourceColumn, quarterLabel(quarters.current)),
    priorMismatch: describeMismatch(options.quotaPriorSourceColumn, quarterLabel(quarters.previous)),
  };
  const quotaMetrics = buildAePerformanceMetrics(filtered, quarters, filters.repStatus, scope);

  if (!period) {
    let currentRows = filtered;
    if (filters.closeFrom) currentRows = currentRows.filter(row => row.closeDate && row.closeDate >= filters.closeFrom);
    if (filters.closeTo) currentRows = currentRows.filter(row => row.closeDate && row.closeDate <= filters.closeTo);
    const metrics = buildAePerformanceMetrics(currentRows, null, filters.repStatus, scope);
    return { metrics, quota, quotaMetrics,
      comparison: { available: false, reason: 'Select both Close Date boundaries' } };
  }

  const currentRows = filtered.filter(row => inRange(row, period.currentFrom, period.currentTo));
  const previousRows = filtered.filter(row => inRange(row, period.previousFrom, period.previousTo));
  const metrics = buildAePerformanceMetrics(currentRows, null, filters.repStatus, scope);
  const comparison = { available: true, period, groups: buildAePerformanceComparisons(currentRows, previousRows, filters.repStatus, scope) };
  return { metrics, quota, quotaMetrics, comparison };
}

// Rep status: who is still at the company.
//
// This is NOT a row filter, and that distinction is the whole design.
//
// A rep who leaves still closed the deals they closed. If "Active only" simply
// dropped their rows, every historical total would fall the day they resigned
// and a closed quarter would stop reconciling with what was reported at the
// time. So the rule is narrower:
//
//   individual rep rankings  ->  departed reps are hidden
//   totals, win rates,
//   contribution shares      ->  their rows still count
//   POD quota attainment     ->  their TARGET leaves with them
//
// That last line is the one exception: a quarter's quota belongs to whoever is
// carrying it now, so a departed rep is removed from both halves of the
// attainment fraction at once. Applied in aePerformanceMetrics.quotaBlock,
// which is the ONLY place this filter reaches a denominator.
//
// A rep who is still here but closed nothing is NOT removed - they keep their
// target in the POD, so a quiet quarter reads as the miss it is.
//
// A blank flag counts as INACTIVE. That is the strict reading and it is a
// deliberate choice: an unmatched rep is hidden rather than assumed present.
// The cost is that a broken user-table join looks like reps disappearing, so
// the count of unclassified rows is reported alongside the metrics rather than
// being absorbed silently.

export const REP_STATUS = { ACTIVE: 'active', ALL: 'all' };

// Blank, null and undefined are all "not explicitly active", so all are hidden.
export const isActiveRep = row => row.ownerActive === true;

export function resolveRepStatus(value) {
  return value === REP_STATUS.ALL ? REP_STATUS.ALL : REP_STATUS.ACTIVE;
}

// Applied to the INDIVIDUAL rep list only. Never to the row set that feeds
// totals, POD groupings or any denominator.
export function filterRepList(reps, rows, keyOf, repStatus) {
  if (resolveRepStatus(repStatus) === REP_STATUS.ALL) return reps;
  const activeLabels = new Set(rows.filter(isActiveRep).map(keyOf).filter(Boolean));

  // "Blank means inactive" is the rule for rows that CARRY the flag. It cannot
  // also mean "hide everyone" when the field is simply not mapped: with no
  // signal at all, hiding every rep would blank every board and read as data
  // loss rather than as a missing mapping. So no active rep anywhere is
  // treated as "nothing to filter on", and the board says so instead.
  if (!activeLabels.size) return reps;

  return reps.filter(rep => activeLabels.has(rep.label));
}

// Surfaced on every board so a growing gap in the source is visible rather
// than reading as a quiet drop in headcount.
export function repStatusSummary(rows, keyOf = row => row.owner) {
  const owners = new Map();
  for (const row of rows) {
    const label = keyOf(row);
    if (!label) continue;
    // An owner counts as active if any of their rows says so; a single stale
    // row should not resurrect someone who has left, but a single missing
    // value should not bury someone who is plainly here either.
    owners.set(label, owners.get(label) || row.ownerActive === true);
  }
  const unclassified = [...owners.entries()].filter(([, active]) => !active).length;
  return {
    total: owners.size,
    active: owners.size - unclassified,
    hidden: unclassified,
    // True when NOTHING is flagged active, which almost always means the field
    // is unmapped rather than that the whole team left.
    likelyUnmapped: owners.size > 0 && owners.size === unclassified,
  };
}

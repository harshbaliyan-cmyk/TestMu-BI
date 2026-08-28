// The chart-type catalogue, encoded as DATA. Every rule about what a chart
// needs lives in these slot declarations — the availability check, the field
// suggester, the builder UI, and the data engine all read them, so adding a
// chart type is one entry here rather than if-statements in four places.
//
// Slot vocabulary:
//   accepts        column types the slot takes ('number' | 'date' | 'boolean' | 'string')
//   required       the chart cannot render without it
//   maxDistinct    upper bound on cardinality (a category axis with 5,000
//                  values is not a chart, it is a scroll of noise)
//   aggregations   how a measure may be folded; first entry is the default
//   multi          the slot takes several columns (table columns)

const MEASURE = { aggregations: ['sum', 'avg', 'count', 'min', 'max'], accepts: ['number'] };

export const CHART_TYPES = [
  {
    key: 'bar', label: 'Bar chart',
    description: 'Compare a measure across categories.',
    slots: [
      { key: 'category', label: 'Category', accepts: ['string', 'boolean'], required: true, maxDistinct: 50 },
      { key: 'value', label: 'Value', required: true, ...MEASURE },
      { key: 'series', label: 'Split by', accepts: ['string', 'boolean'], required: false, maxDistinct: 12 },
    ],
  },
  {
    key: 'line', label: 'Time series',
    description: 'A measure over time, bucketed by day, week, month, or quarter.',
    slots: [
      { key: 'x', label: 'Date', accepts: ['date'], required: true },
      { key: 'value', label: 'Value', required: true, ...MEASURE },
      { key: 'series', label: 'Split by', accepts: ['string', 'boolean'], required: false, maxDistinct: 8 },
    ],
    options: { grains: ['day', 'week', 'month', 'quarter', 'year'], defaultGrain: 'month' },
  },
  {
    key: 'donut', label: 'Donut',
    description: 'Share of a total across a handful of categories.',
    slots: [
      { key: 'category', label: 'Category', accepts: ['string', 'boolean'], required: true, maxDistinct: 12 },
      { key: 'value', label: 'Value', required: true, ...MEASURE },
    ],
  },
  {
    key: 'kpi', label: 'KPI tile',
    description: 'One aggregated number, readable across a room.',
    slots: [
      { key: 'value', label: 'Value', required: true, ...MEASURE },
    ],
  },
  {
    key: 'scatter', label: 'Scatter',
    description: 'Two measures plotted against each other, one point per row.',
    slots: [
      { key: 'x', label: 'X value', accepts: ['number'], required: true },
      { key: 'y', label: 'Y value', accepts: ['number'], required: true },
      { key: 'label', label: 'Point label', accepts: ['string'], required: false },
    ],
  },
  {
    key: 'table', label: 'Table',
    description: 'The raw rows behind a question, a few columns at a time.',
    slots: [
      { key: 'columns', label: 'Columns', accepts: ['string', 'number', 'date', 'boolean'], required: true, multi: true },
    ],
  },
];

export const chartType = key => CHART_TYPES.find(type => type.key === key) || null;

const columnFitsSlot = (column, slot) => {
  if (!slot.accepts.includes(column.type)) return false;
  // A capped distinct count means "at least this many" — treat it as too many
  // for any bounded slot rather than gambling on an unreadable axis.
  if (slot.maxDistinct && (column.distinctCapped || column.distinct > slot.maxDistinct)) return false;
  return true;
};

// Which chart types this dataset can satisfy, with a human reason when it
// cannot — the builder greys the card and says why instead of letting someone
// assemble a chart that can only render broken.
export function chartTypeAvailability(columns) {
  return CHART_TYPES.map(type => {
    const missing = type.slots.filter(slot => slot.required
      && !columns.some(column => columnFitsSlot(column, slot)));
    if (missing.length) {
      const slot = missing[0];
      const wanted = slot.accepts.join(' or ');
      const reason = slot.maxDistinct
        ? `Needs a ${wanted} column with at most ${slot.maxDistinct} distinct values for "${slot.label}"`
        : `Needs a ${wanted} column for "${slot.label}"`;
      return { key: type.key, available: false, reason };
    }
    // Per-slot fit is necessary but not sufficient: slots are exclusive, so a
    // dataset with ONE number column passes the scatter check above and then
    // cannot actually fill both X and Y. Run the real suggester as the final
    // word — if it cannot staff every required slot, neither can a user.
    const suggestion = suggestBindings(type.key, columns);
    if (!suggestion.ok) {
      return { key: type.key, available: false,
        reason: `${suggestion.reason} — each field needs its own column` };
    }
    return { key: type.key, available: true };
  });
}

// Score a column for a slot. Fill rate dominates; mid-range cardinality wins
// for categories (2 values make a dull bar chart, 50 an unreadable one).
function slotScore(column, slot) {
  if (!columnFitsSlot(column, slot)) return -1;
  let score = column.fillRate ?? 0;
  if (slot.maxDistinct) {
    if (column.distinct >= 3 && column.distinct <= 12) score += 25;
    else if (column.distinct === 2) score += 10;
    else if (column.distinct < 2) score -= 30; // a single-valued axis says nothing
  }
  if (slot.accepts.includes('number') && column.type === 'number') {
    // Prefer measures that actually vary.
    if (column.min !== null && column.max !== null && column.min !== column.max) score += 10;
  }
  return score;
}

// Pre-fill every slot of a chart type with the best-fitting columns, never
// reusing a column across slots. Returns null bindings for optional slots
// nothing fits — the user can still bind them by hand.
export function suggestBindings(typeKey, columns) {
  const type = chartType(typeKey);
  if (!type) return { ok: false, reason: `Unknown chart type: ${typeKey}` };
  const taken = new Set();
  const slots = {};
  for (const slot of type.slots) {
    const ranked = columns
      .filter(column => !taken.has(column.name))
      .map(column => ({ column, score: slotScore(column, slot) }))
      .filter(entry => entry.score >= 0)
      .sort((a, b) => b.score - a.score);
    if (slot.multi) {
      const picks = ranked.slice(0, 4).map(entry => entry.column.name);
      picks.forEach(name => taken.add(name));
      slots[slot.key] = picks.length ? { columns: picks } : null;
      if (!picks.length && slot.required) return { ok: false, reason: `No column fits "${slot.label}"` };
      continue;
    }
    const best = ranked[0];
    if (!best) {
      if (slot.required) return { ok: false, reason: `No column fits "${slot.label}"` };
      slots[slot.key] = null;
      continue;
    }
    taken.add(best.column.name);
    slots[slot.key] = {
      column: best.column.name,
      ...(slot.aggregations ? { aggregation: slot.aggregations[0] } : {}),
    };
  }
  if (type.options?.defaultGrain && slots.x) slots.x.grain = type.options.defaultGrain;
  return { ok: true, slots };
}

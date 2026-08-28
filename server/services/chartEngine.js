import { parseNumber, parseDate } from './columnProfile.js';
import { chartType } from './chartCatalog.js';

// Turns (raw rows + saved chart config) into render-ready data. Pure on
// purpose: rendering is a function of config plus current data, which is what
// lets the same saved chart appear on a dashboard, a TV wall, and a preview —
// and what makes auto-refresh just "run it again on newer rows".
//
// The config shape is versioned (CHART_CONFIG_VERSION) because every saved
// chart and dashboard tile stores one. Change it deliberately, with a
// migration path, or old saved charts stop rendering.
//
// Everything here is data lookups over in-memory rows — no SQL, no eval, and
// column names are only ever used as object keys, so a hostile column name
// can misname a series but never execute.

export const CHART_CONFIG_VERSION = 1;

const AGGREGATORS = {
  sum: values => values.reduce((total, v) => total + v, 0),
  avg: values => (values.length ? values.reduce((total, v) => total + v, 0) / values.length : null),
  count: values => values.length,
  min: values => (values.length ? Math.min(...values) : null),
  max: values => (values.length ? Math.max(...values) : null),
};

const label = value => {
  if (value === null || value === undefined || value === '') return '(blank)';
  return String(value).trim() || '(blank)';
};

// ISO week starting Monday, tagged by its Monday's date.
function weekStart(isoDay) {
  const date = new Date(`${isoDay}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export function bucketDate(isoDay, grain) {
  switch (grain) {
    case 'day': return isoDay;
    case 'week': return weekStart(isoDay);
    case 'quarter': return `${isoDay.slice(0, 4)}-Q${Math.floor((+isoDay.slice(5, 7) - 1) / 3) + 1}`;
    case 'year': return isoDay.slice(0, 4);
    case 'month':
    default: return isoDay.slice(0, 7);
  }
}

export function applyChartFilters(rows, filters = []) {
  let out = rows;
  for (const filter of filters) {
    const { column, op } = filter || {};
    if (!column || !op) continue;
    if (op === 'in') {
      const wanted = new Set((filter.values || []).map(v => String(v)));
      if (!wanted.size) continue;
      out = out.filter(row => wanted.has(String(row[column] ?? '')));
    } else if (op === 'range') {
      // Works for numbers and ISO dates alike: dates are compared as parsed
      // ISO days (string order == date order), numbers as numbers.
      const isDate = filter.kind === 'date';
      const parse = isDate ? parseDate : parseNumber;
      const from = filter.from !== undefined && filter.from !== null && filter.from !== '' ? parse(filter.from) : null;
      const to = filter.to !== undefined && filter.to !== null && filter.to !== '' ? parse(filter.to) : null;
      out = out.filter(row => {
        const value = parse(row[column]);
        if (value === null) return false;
        if (from !== null && value < from) return false;
        if (to !== null && value > to) return false;
        return true;
      });
    }
  }
  return out;
}

function aggregate(rows, valueSlot) {
  const aggregation = AGGREGATORS[valueSlot.aggregation] ? valueSlot.aggregation : 'sum';
  if (aggregation === 'count') return rows.length;
  const values = rows.map(row => parseNumber(row[valueSlot.column])).filter(v => v !== null);
  return AGGREGATORS[aggregation](values);
}

const round2 = value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : value);

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// One dataset per series value, aligned to a shared label axis.
function seriesDatasets(rows, labels, labelOf, seriesSlot, valueSlot) {
  if (!seriesSlot?.column) {
    return [{
      label: valueSlot.aggregation === 'count' ? 'Count' : valueSlot.column,
      data: labels.map(l => {
        const bucket = rows.filter(row => labelOf(row) === l);
        return round2(aggregate(bucket, valueSlot));
      }),
    }];
  }
  const seriesGroups = groupBy(rows, row => label(row[seriesSlot.column]));
  return [...seriesGroups.entries()].map(([seriesName, seriesRows]) => ({
    label: seriesName,
    data: labels.map(l => {
      const bucket = seriesRows.filter(row => labelOf(row) === l);
      return bucket.length ? round2(aggregate(bucket, valueSlot)) : null;
    }),
  }));
}

// The rows behind one chart element — a clicked bar, slice, or line point.
// `where` narrows by the labels the chart itself displayed ({category,
// series, bucket}), on top of the config's own filters, so what the modal
// shows is exactly what the element aggregated. Blank cells match '(blank)',
// the same label the chart gave them.
export function rowsBehind(rows, config, where = {}) {
  if (!config || config.version !== CHART_CONFIG_VERSION) {
    throw new Error(`Unsupported chart config version: ${config?.version}`);
  }
  const type = chartType(config.type);
  if (!type) throw new Error(`Unknown chart type: ${config.type}`);
  const slots = config.slots || {};
  let out = applyChartFilters(rows, config.filters);
  if (where.category !== undefined && slots.category?.column) {
    out = out.filter(row => label(row[slots.category.column]) === where.category);
  }
  if (where.series !== undefined && slots.series?.column) {
    out = out.filter(row => label(row[slots.series.column]) === where.series);
  }
  if (where.bucket !== undefined && slots.x?.column) {
    const grain = type.options?.grains?.includes(slots.x.grain) ? slots.x.grain : (type.options?.defaultGrain || 'month');
    out = out.filter(row => {
      const day = parseDate(row[slots.x.column]);
      return day && bucketDate(day, grain) === where.bucket;
    });
  }
  return out;
}

// The single entry point: rows in, chart.js-agnostic data out.
// Throws with a user-readable message on a config the catalogue cannot honour.
export function buildChartData(rows, config) {
  if (!config || config.version !== CHART_CONFIG_VERSION) {
    throw new Error(`Unsupported chart config version: ${config?.version}`);
  }
  const type = chartType(config.type);
  if (!type) throw new Error(`Unknown chart type: ${config.type}`);
  const slots = config.slots || {};
  for (const slot of type.slots) {
    const bound = slots[slot.key];
    if (slot.required && !(slot.multi ? bound?.columns?.length : bound?.column)) {
      throw new Error(`The "${slot.label}" field is not set`);
    }
  }

  const filtered = applyChartFilters(rows, config.filters);
  const limit = Math.min(Math.max(Number(config.limit) || 25, 1), 100);

  switch (config.type) {
    case 'bar':
    case 'donut': {
      const labelOf = row => label(row[slots.category.column]);
      const groups = groupBy(filtered, labelOf);
      // sort: value_desc (default) | value_asc | label. The cut to `limit`
      // always keeps the LARGEST categories — an A–Z sort reorders the top N,
      // it never trades a big category away for an alphabetically early one.
      const byValue = [...groups.entries()]
        .map(([key, groupRows]) => ({ key, total: aggregate(groupRows, slots.value) ?? 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, config.type === 'donut' ? Math.min(limit, 12) : limit);
      if (config.sort === 'value_asc') byValue.reverse();
      else if (config.sort === 'label') byValue.sort((a, b) => a.key.localeCompare(b.key));
      const labels = byValue.map(entry => entry.key);
      return { labels, datasets: seriesDatasets(filtered, labels, labelOf, config.type === 'bar' ? slots.series : null, slots.value) };
    }
    case 'line': {
      const grain = type.options.grains.includes(slots.x?.grain) ? slots.x.grain : type.options.defaultGrain;
      const labelOf = row => {
        const day = parseDate(row[slots.x.column]);
        return day ? bucketDate(day, grain) : null;
      };
      const labels = [...new Set(filtered.map(labelOf).filter(Boolean))].sort();
      return { labels, grain, datasets: seriesDatasets(filtered.filter(row => labelOf(row)), labels, labelOf, slots.series, slots.value) };
    }
    case 'kpi':
      return { value: round2(aggregate(filtered, slots.value)), rowCount: filtered.length };
    case 'scatter': {
      const points = [];
      for (const row of filtered) {
        const x = parseNumber(row[slots.x.column]);
        const y = parseNumber(row[slots.y.column]);
        if (x === null || y === null) continue;
        points.push({ x, y, ...(slots.label?.column ? { label: label(row[slots.label.column]) } : {}) });
        if (points.length >= 1000) break; // a TV cannot read more dots than this
      }
      return { points, truncated: points.length >= 1000 };
    }
    case 'table': {
      const columns = slots.columns.columns.slice(0, 8);
      return {
        columns,
        rows: filtered.slice(0, Math.min(limit * 4, 200)).map(row => columns.map(column => row[column] ?? '')),
        totalRows: filtered.length,
      };
    }
    default:
      throw new Error(`No renderer for chart type: ${config.type}`);
  }
}

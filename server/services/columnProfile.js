// Per-column dataset schema, captured at sync/upload time. This is what the
// chart builder runs on: field suggestion, greying out chart types a dataset
// cannot satisfy, and pre-filling slots all read these profiles rather than
// rescanning rows.
//
// Inference here answers "what IS this column" (for the builder's catalogue);
// datasources.js's coercers answer "convert this value" (for the fixed
// dashboards' mapping pipeline). They are deliberately independent: a column
// that is 90% numbers with a few blanks should still profile as a number
// column, which is a judgement call a per-value coercer never makes.

const NUMBER_RE = /^\(?-?[$€£₹]?\s?[\d,]+(\.\d+)?\)?%?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;
const SLASH_DATE_RE = /^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$/;
const BOOL_SET = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '0', '1', 't', 'f']);

function classifyValue(value) {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'blank';
  if (value instanceof Date) return isNaN(value) ? 'blank' : 'date';
  const s = String(value).trim();
  if (s === '') return 'blank';
  if (ISO_DATE_RE.test(s) || SLASH_DATE_RE.test(s)) return 'date';
  if (NUMBER_RE.test(s)) return 'number';
  if (BOOL_SET.has(s.toLowerCase())) return 'boolean';
  return 'string';
}

export const parseNumber = value => {
  if (typeof value === 'number') return value;
  const s = String(value).replace(/[(),$€£₹%\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (/^\(.*\)$/.test(String(value).trim()) ? -n : n) : null;
};

export const parseDate = value => {
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (ISO_DATE_RE.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

// One profile per header:
//   { name, type, filled, fillRate, distinct, distinctCapped, min, max, samples }
// - type is the DOMINANT non-blank classification (>= 80% of non-blank values),
//   falling back to string: "mostly numbers with three typos" is a number
//   column with dirty rows, not a text column.
// - distinct is capped: the builder only needs to know "low-cardinality enough
//   for a category axis", never the exact count of 17,000 opportunity names.
// - min/max are values for numbers, ISO days for dates — they drive default
//   axis ranges and date-filter bounds.
export function profileColumns(headers, rows, { sampleRows = 5000, distinctCap = 200 } = {}) {
  const scanned = rows.length > sampleRows ? rows.slice(0, sampleRows) : rows;
  return (headers || []).map(name => {
    const counts = { number: 0, date: 0, boolean: 0, string: 0 };
    const distinct = new Set();
    const samples = [];
    let filled = 0;
    let numMin = null, numMax = null;
    let dateMin = null, dateMax = null;

    for (const row of scanned) {
      const value = row?.[name];
      const kind = classifyValue(value);
      if (kind === 'blank') continue;
      filled++;
      counts[kind]++;
      if (distinct.size < distinctCap) distinct.add(typeof value === 'string' ? value.trim() : String(value));
      if (samples.length < 3) {
        const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
        if (!samples.includes(s)) samples.push(s);
      }
      if (kind === 'number') {
        const n = parseNumber(value);
        if (n !== null) {
          if (numMin === null || n < numMin) numMin = n;
          if (numMax === null || n > numMax) numMax = n;
        }
      } else if (kind === 'date') {
        const d = parseDate(value);
        if (d) {
          if (!dateMin || d < dateMin) dateMin = d;
          if (!dateMax || d > dateMax) dateMax = d;
        }
      }
    }

    const dominant = ['number', 'date', 'boolean'].find(kind => counts[kind] >= filled * 0.8 && counts[kind] > 0);
    const type = filled === 0 ? 'string' : (dominant || 'string');
    return {
      name,
      type,
      filled,
      fillRate: scanned.length ? Math.round((filled / scanned.length) * 100) : 0,
      distinct: distinct.size,
      distinctCapped: distinct.size >= distinctCap,
      min: type === 'number' ? numMin : type === 'date' ? dateMin : null,
      max: type === 'number' ? numMax : type === 'date' ? dateMax : null,
      samples,
    };
  });
}

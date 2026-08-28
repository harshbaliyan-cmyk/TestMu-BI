import test from 'node:test';
import assert from 'node:assert/strict';
import { CHART_TYPES, chartTypeAvailability, suggestBindings } from '../services/chartCatalog.js';
import { buildChartData, applyChartFilters, bucketDate, rowsBehind, CHART_CONFIG_VERSION } from '../services/chartEngine.js';

const COLUMNS = [
  { name: 'Region', type: 'string', filled: 100, fillRate: 100, distinct: 3, distinctCapped: false },
  { name: 'Deal Name', type: 'string', filled: 100, fillRate: 100, distinct: 200, distinctCapped: true },
  { name: 'ARR', type: 'number', filled: 95, fillRate: 95, distinct: 90, distinctCapped: false, min: 100, max: 90000 },
  { name: 'Close Date', type: 'date', filled: 80, fillRate: 80, distinct: 60, distinctCapped: false, min: '2026-01-01', max: '2026-08-01' },
  { name: 'Won', type: 'boolean', filled: 100, fillRate: 100, distinct: 2, distinctCapped: false },
];

const ROWS = [
  { Region: 'AMER', ARR: '1000', 'Close Date': '2026-01-10', Won: 'yes', 'Deal Name': 'A' },
  { Region: 'AMER', ARR: '3000', 'Close Date': '2026-02-05', Won: 'no', 'Deal Name': 'B' },
  { Region: 'EMEA', ARR: '2000', 'Close Date': '2026-02-20', Won: 'yes', 'Deal Name': 'C' },
  { Region: 'APAC', ARR: '$4,000', 'Close Date': '2026-03-01', Won: 'yes', 'Deal Name': 'D' },
  { Region: 'EMEA', ARR: 'garbage', 'Close Date': '2026-02-25', Won: 'no', 'Deal Name': 'E' },
];

// ===== CATALOGUE =====

test('every chart type declares its needs as data, with at least one required slot', () => {
  for (const type of CHART_TYPES) {
    assert.ok(type.slots.length, `${type.key} has slots`);
    assert.ok(type.slots.some(slot => slot.required), `${type.key} has a required slot`);
    for (const slot of type.slots) assert.ok(slot.accepts?.length, `${type.key}.${slot.key} declares accepted types`);
  }
});

test('availability greys out chart types the dataset cannot satisfy, with a reason', () => {
  const noDates = COLUMNS.filter(column => column.type !== 'date');
  const availability = Object.fromEntries(chartTypeAvailability(noDates).map(entry => [entry.key, entry]));
  assert.equal(availability.bar.available, true);
  assert.equal(availability.line.available, false);
  assert.match(availability.line.reason, /date/i);
});

test('exclusive slots count: one number column cannot open a two-measure scatter', () => {
  const oneNumber = [
    { name: 'Region', type: 'string', fillRate: 100, distinct: 3, distinctCapped: false },
    { name: 'Revenue', type: 'number', fillRate: 100, distinct: 25, distinctCapped: false, min: 1, max: 900 },
  ];
  const availability = Object.fromEntries(chartTypeAvailability(oneNumber).map(entry => [entry.key, entry]));
  assert.equal(availability.scatter.available, false,
    'X and Y each need their own column — offering scatter here 400s the preview');
  assert.match(availability.scatter.reason, /its own column/);
  assert.equal(availability.bar.available, true, 'bar only needs the one measure');
});

test('a capped distinct count disqualifies a column from bounded category slots', () => {
  const onlyHighCardinality = [
    { name: 'Deal Name', type: 'string', fillRate: 100, distinct: 200, distinctCapped: true },
    { name: 'ARR', type: 'number', fillRate: 100, distinct: 90, min: 1, max: 2 },
  ];
  const availability = Object.fromEntries(chartTypeAvailability(onlyHighCardinality).map(entry => [entry.key, entry]));
  assert.equal(availability.bar.available, false, '200+ distinct values is not a category axis');
});

test('suggestion pre-fills every slot without reusing a column, defaulting the aggregation', () => {
  const suggestion = suggestBindings('bar', COLUMNS);
  assert.equal(suggestion.ok, true);
  assert.equal(suggestion.slots.category.column, 'Region', 'the low-cardinality string wins the category');
  assert.equal(suggestion.slots.value.column, 'ARR');
  assert.equal(suggestion.slots.value.aggregation, 'sum');
  assert.notEqual(suggestion.slots.series?.column, 'Region', 'a column is never bound to two slots');
});

test('suggestion for a time series picks the date and carries the default grain', () => {
  const suggestion = suggestBindings('line', COLUMNS);
  assert.equal(suggestion.slots.x.column, 'Close Date');
  assert.equal(suggestion.slots.x.grain, 'month');
});

// ===== ENGINE =====

const config = overrides => ({ version: CHART_CONFIG_VERSION, ...overrides });

test('bar chart groups, aggregates with dirty-value tolerance, and sorts by value', () => {
  const data = buildChartData(ROWS, config({
    type: 'bar',
    slots: { category: { column: 'Region' }, value: { column: 'ARR', aggregation: 'sum' } },
  }));
  // AMER and APAC tie at 4000; the sort is stable, so first-seen order breaks it.
  assert.deepEqual(data.labels, ['AMER', 'APAC', 'EMEA'], 'sorted descending by total');
  assert.deepEqual(data.datasets[0].data, [4000, 4000, 2000], 'garbage values drop out instead of NaN-ing the chart');
});

test('sort options reorder the kept categories without changing which survive the limit', () => {
  const base = { type: 'bar', slots: { category: { column: 'Region' }, value: { column: 'ARR', aggregation: 'sum' } } };
  const asc = buildChartData(ROWS, config({ ...base, sort: 'value_asc' }));
  assert.deepEqual(asc.labels, ['EMEA', 'APAC', 'AMER'], 'ascending is the descending order reversed');
  const alpha = buildChartData(ROWS, config({ ...base, sort: 'label' }));
  assert.deepEqual(alpha.labels, ['AMER', 'APAC', 'EMEA']);
  const limited = buildChartData(ROWS, config({ ...base, sort: 'label', limit: 2 }));
  assert.deepEqual(limited.labels, ['AMER', 'APAC'], 'the limit keeps the LARGEST two, then sorts them A–Z');
});

test('a series split aligns every series to the shared category axis', () => {
  const data = buildChartData(ROWS, config({
    type: 'bar',
    slots: { category: { column: 'Region' }, value: { column: 'ARR', aggregation: 'count' }, series: { column: 'Won' } },
  }));
  const byLabel = Object.fromEntries(data.datasets.map(dataset => [dataset.label, dataset.data]));
  assert.deepEqual(Object.keys(byLabel).sort(), ['no', 'yes']);
  for (const values of Object.values(byLabel)) assert.equal(values.length, data.labels.length);
});

test('time series buckets by grain and sorts chronologically', () => {
  const data = buildChartData(ROWS, config({
    type: 'line',
    slots: { x: { column: 'Close Date', grain: 'month' }, value: { column: 'ARR', aggregation: 'sum' } },
  }));
  assert.deepEqual(data.labels, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(data.datasets[0].data, [1000, 5000, 4000]);
});

test('date bucketing understands weeks, quarters, and years', () => {
  assert.equal(bucketDate('2026-08-27', 'week'), '2026-08-24', 'a Thursday buckets to its Monday');
  assert.equal(bucketDate('2026-08-27', 'quarter'), '2026-Q3');
  assert.equal(bucketDate('2026-08-27', 'year'), '2026');
});

test('kpi returns one aggregated number over the filtered rows', () => {
  const data = buildChartData(ROWS, config({
    type: 'kpi',
    slots: { value: { column: 'ARR', aggregation: 'avg' } },
    filters: [{ column: 'Region', op: 'in', values: ['AMER'] }],
  }));
  assert.equal(data.value, 2000);
  assert.equal(data.rowCount, 2);
});

test('filters compose: in-lists and ranges over numbers and dates', () => {
  const filtered = applyChartFilters(ROWS, [
    { column: 'Close Date', op: 'range', kind: 'date', from: '2026-02-01', to: '2026-02-28' },
    { column: 'ARR', op: 'range', from: 2500 },
  ]);
  assert.deepEqual(filtered.map(row => row['Deal Name']), ['B']);
});

test('drill-down returns exactly the rows a clicked element aggregated', () => {
  const cfg = config({
    type: 'bar',
    slots: { category: { column: 'Region' }, value: { column: 'ARR', aggregation: 'sum' }, series: { column: 'Won' } },
  });
  const amer = rowsBehind(ROWS, cfg, { category: 'AMER' });
  assert.deepEqual(amer.map(row => row['Deal Name']), ['A', 'B']);
  const amerWon = rowsBehind(ROWS, cfg, { category: 'AMER', series: 'yes' });
  assert.deepEqual(amerWon.map(row => row['Deal Name']), ['A']);
});

test('drill-down on a time series matches the displayed bucket, honouring the grain', () => {
  const cfg = config({
    type: 'line',
    slots: { x: { column: 'Close Date', grain: 'month' }, value: { column: 'ARR', aggregation: 'sum' } },
  });
  const feb = rowsBehind(ROWS, cfg, { bucket: '2026-02' });
  assert.deepEqual(feb.map(row => row['Deal Name']).sort(), ['B', 'C', 'E']);
});

test('drill-down still applies the config filters underneath the element match', () => {
  const cfg = config({
    type: 'bar',
    slots: { category: { column: 'Region' }, value: { column: 'ARR', aggregation: 'sum' } },
    filters: [{ column: 'Won', op: 'in', values: ['yes'] }],
  });
  assert.deepEqual(rowsBehind(ROWS, cfg, { category: 'EMEA' }).map(row => row['Deal Name']), ['C'],
    'the filtered-out EMEA loss never appears in the drill');
});

test('an unsupported config version refuses loudly instead of rendering nonsense', () => {
  assert.throws(() => buildChartData(ROWS, { version: 99, type: 'bar', slots: {} }), /version/);
});

test('a missing required binding names the missing field', () => {
  assert.throws(() => buildChartData(ROWS, config({ type: 'bar', slots: { value: { column: 'ARR' } } })), /Category/);
});

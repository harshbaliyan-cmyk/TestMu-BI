import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeProductRows, orderStages, applyCategoryFilters,
  buildProductPipelineSnapshot, buildProductWonSnapshot,
} from '../services/productViewMetrics.js';

// Product-line row factory: one OPPORTUNITY may produce several of these,
// one per product. `id` is the opportunity id, deliberately repeatable.
const line = (over = {}) => ({
  id: 'OPP-1', stage: 'Negotiation', productArr: 1000, isClosed: false, isWon: false,
  createdDate: '2026-04-10', closeDate: '2026-07-20',
  product: 'Browser Testing', productGroup: 'Testing Cloud',
  opportunityForecast: '', type: 'New Business', orgType: 'SMB', pod: 'AE Corp',
  owner: 'Riya', continentGroup: 'AMER',
  ...over,
});

test('an opportunity split across two product rows counts ONCE but sums both ARR lines', () => {
  const rows = [
    line({ id: 'OPP-9', product: 'Browser Testing', productArr: 600 }),
    line({ id: 'OPP-9', product: 'App Testing', productArr: 400 }),
  ];
  const summary = summarizeProductRows(rows, 'test');
  assert.equal(summary.openPipe, 1000);
  assert.equal(summary.openOppCount, 1);
});

test('open pipe excludes closed rows; commit and best case read the forecast column, not the stage', () => {
  const rows = [
    line({ id: 'A', productArr: 100 }),
    line({ id: 'B', productArr: 200, isClosed: true, isWon: true, stage: 'Closed Won' }),
    line({ id: 'C', productArr: 300, opportunityForecast: 'Commit' }),
    line({ id: 'D', productArr: 400, opportunityForecast: 'best case' }), // case-insensitive
  ];
  const summary = summarizeProductRows(rows, 'test');
  assert.equal(summary.openPipe, 100 + 300 + 400);
  assert.equal(summary.closedWonArr, 200);
  assert.equal(summary.commitArr, 300);
  assert.equal(summary.commitOppCount, 1);
  assert.equal(summary.bestCaseArr, 400);
  assert.equal(summary.bestCaseOppCount, 1);
});

test('forecast merge mirrors the Tableau group: Best Case ← {Best Case, High}, No Projection ← {Low, No Projection}, null in NO bucket', () => {
  // The Tableau side merges these with an ad-hoc GROUP, which does not
  // survive the published-datasource pull — so the raw values arrive and
  // the merge must happen in the service. A blank forecast is deliberately
  // NOT No Projection: that bucket is a rep's explicit call, a blank is the
  // absence of one.
  const rows = [
    line({ id: 'A', productArr: 100, opportunityForecast: 'Best Case' }),
    line({ id: 'B', productArr: 200, opportunityForecast: 'High' }),
    line({ id: 'C', productArr: 400, opportunityForecast: 'Commit' }),
    line({ id: 'D', productArr: 800, opportunityForecast: 'Low' }),
    line({ id: 'E', productArr: 1600, opportunityForecast: 'No Projection' }),
    line({ id: 'F', productArr: 3200, opportunityForecast: '' }),
  ];
  const summary = summarizeProductRows(rows, 'test');
  assert.equal(summary.bestCaseArr, 300);          // Best Case + High
  assert.equal(summary.bestCaseOppCount, 2);
  assert.equal(summary.commitArr, 400);
  assert.equal(summary.commitOppCount, 1);
  assert.equal(summary.noProjectionArr, 2400);     // Low + No Projection, not the blank
  assert.equal(summary.noProjectionOppCount, 2);
});

test('win rates: count-based and ARR-based disagree when deal sizes differ, avg deal size over distinct wins', () => {
  const rows = [
    line({ id: 'W1', productArr: 900, isClosed: true, isWon: true, stage: 'Closed Won' }),
    line({ id: 'W1', productArr: 100, isClosed: true, isWon: true, stage: 'Closed Won', product: 'App Testing' }),
    line({ id: 'L1', productArr: 1000, isClosed: true, isWon: false, stage: 'Closed Lost' }),
    line({ id: 'L2', productArr: 3000, isClosed: true, isWon: false, stage: 'Closed Lost' }),
  ];
  const summary = summarizeProductRows(rows, 'test');
  assert.equal(summary.winRateCount, 1 / 3 * 100);           // 1 won of 3 closed opps
  assert.equal(summary.winRateArr, 1000 / 5000 * 100);       // 1000 won ARR of 5000 closed
  assert.equal(summary.avgDealSize, 1000);                   // 1000 ARR over ONE distinct won opp
});

test('a slice with nothing closed has null win rates and null avg deal size, not zero', () => {
  const summary = summarizeProductRows([line()], 'test');
  assert.equal(summary.winRateCount, null);
  assert.equal(summary.winRateArr, null);
  assert.equal(summary.avgDealSize, null);
});

test('pipeline view scopes by CREATED date; won view scopes by CLOSE date', () => {
  const rows = [
    line({ id: 'IN', createdDate: '2026-04-10', closeDate: '2026-09-01' }),
    line({ id: 'OUT', createdDate: '2026-01-05', closeDate: '2026-04-15' }),
    line({ id: 'WON', createdDate: '2026-01-05', closeDate: '2026-04-15', isClosed: true, isWon: true, stage: 'Closed Won', productArr: 500 }),
  ];
  const pipeline = buildProductPipelineSnapshot(rows, { createdFrom: '2026-04-01', createdTo: '2026-04-30' });
  // Only IN was created in April; the April-CLOSED rows are out of scope.
  assert.equal(pipeline.metrics.overall.openOppCount, 1);
  assert.equal(pipeline.metrics.overall.closedWonCount, 0);

  const won = buildProductWonSnapshot(rows, { closeFrom: '2026-04-01', closeTo: '2026-04-30' });
  // WON closed in April. OUT also closed in April? No — OUT is open, and the
  // won view drops open rows entirely: a tentative close date must not leak
  // open pipeline into an actuals view.
  assert.equal(won.metrics.overall.closedWonCount, 1);
  assert.equal(won.metrics.overall.closedWonArr, 500);
  assert.equal(won.metrics.overall.openOppCount, 0);
});

test('grand total is a true distinct count across product groups, never the sum of group rows', () => {
  const rows = [
    line({ id: 'X', productGroup: 'Testing Cloud', product: 'Browser Testing', productArr: 700 }),
    line({ id: 'X', productGroup: 'HyperExecute', product: 'HyperExecute Core', productArr: 300 }),
  ];
  const { metrics } = buildProductPipelineSnapshot(rows, {});
  // Each group legitimately counts the opp once…
  for (const group of metrics.funnelByGroup) assert.equal(group.openOppCount, 1);
  // …but the whole-table total must not become 2.
  assert.equal(metrics.overall.openOppCount, 1);
  assert.equal(metrics.overall.openPipe, 1000);
});

test('stage stack orders early to late with closed stages absent (open pipe only)', () => {
  const rows = [
    line({ id: 'A', stage: 'Negotiation', productArr: 10 }),
    line({ id: 'B', stage: 'Qualification', productArr: 20 }),
    line({ id: 'C', stage: 'Trial', productArr: 30 }),
    line({ id: 'D', stage: 'Closed Won', productArr: 40, isClosed: true, isWon: true }),
  ];
  const { metrics } = buildProductPipelineSnapshot(rows, {});
  assert.deepEqual(metrics.stages, ['Qualification', 'Trial', 'Negotiation']);
  assert.equal(metrics.stageStack[0].total, 60);
});

test('orderStages puts unknown open stages before the closed pair', () => {
  const ordered = orderStages(['Closed Lost', 'Weird Custom Stage', 'Qualification']);
  assert.deepEqual(ordered, ['Qualification', 'Weird Custom Stage', 'Closed Lost']);
});

test('product mix shares add up to 100 within a quarter that has won ARR', () => {
  const rows = [
    line({ id: 'W1', productGroup: 'Testing Cloud', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-02-10', productArr: 750 }),
    line({ id: 'W2', productGroup: 'HyperExecute', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-03-05', productArr: 250 }),
  ];
  const { metrics } = buildProductWonSnapshot(rows, { closeFrom: '2026-01-01', closeTo: '2026-12-31' });
  const q1Total = metrics.productMix.groups.reduce((total, group) => total + (group.shares[0] || 0), 0);
  assert.equal(Math.round(q1Total), 100);
  // A quarter with nothing won has null shares, not a fabricated 0/0 = 0%.
  assert.equal(metrics.productMix.groups[0].shares[3], null);
});

test('KPI comparison compares equal periods on the view\'s own date field', () => {
  const rows = [
    line({ id: 'CUR', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-07-10', productArr: 300 }),
    line({ id: 'PREV', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-06-10', productArr: 100 }),
  ];
  const { comparison } = buildProductWonSnapshot(rows, { closeFrom: '2026-07-01', closeTo: '2026-07-31' });
  assert.equal(comparison.available, true);
  assert.equal(comparison.current.closedWonArr, 300);
  assert.equal(comparison.previous.closedWonArr, 100);
  assert.equal(comparison.growth.closedWonArr, 200);
});

test('comparison without both boundaries reports unavailable with the view\'s date name', () => {
  const { comparison } = buildProductWonSnapshot([line()], {});
  assert.equal(comparison.available, false);
  assert.match(comparison.reason, /Close Date/);
});

test('category filters narrow every view the same way and ignore empty selections', () => {
  const rows = [
    line({ id: 'A', productGroup: 'Testing Cloud' }),
    line({ id: 'B', productGroup: 'HyperExecute' }),
  ];
  assert.equal(applyCategoryFilters(rows, { productGroup: ['Testing Cloud'] }).length, 1);
  assert.equal(applyCategoryFilters(rows, { productGroup: [] }).length, 2);
  assert.equal(applyCategoryFilters(rows, {}).length, 2);
});

test('won trend series are ordered by full-year won ARR so top-N is a stable client slice', () => {
  const rows = [
    line({ id: 'A', product: 'Small', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-02-01', productArr: 10 }),
    line({ id: 'B', product: 'Big', isClosed: true, isWon: true, stage: 'Closed Won', closeDate: '2026-02-01', productArr: 999 }),
  ];
  const { metrics } = buildProductWonSnapshot(rows, { closeFrom: '2026-01-01', closeTo: '2026-12-31' });
  assert.equal(metrics.trendByProduct.series[0].label, 'Big');
  assert.equal(metrics.trendByProduct.series[0].monthly[1], 999);
});

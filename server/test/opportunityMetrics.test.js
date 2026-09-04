import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpportunityMetrics, buildOpportunityHighlights, buildOpportunitySnapshot, filterOpportunityRows,
  lossFamilyOf, healthOf, DISENGAGEMENT_FAMILY, UNRECORDED_FAMILY, STAGE_ORDER,
} from '../services/opportunityMetrics.js';
import { autoMap, applyMapping } from '../datasources.js';

test('a blank Region, POD or Team in a MAPPED column becomes a named category so "select all" keeps the row', () => {
  const mapped = applyMapping([{ Id: 'A', Region: '', POD: null, 'Team Role': '', 'Acc Continent': '' }],
    { id: 'Id', region: 'Region', pod: 'POD', team: 'Team Role', continentGroup: 'Acc Continent' });
  assert.equal(mapped[0].region, 'No Region');
  assert.equal(mapped[0].pod, 'No POD');
  assert.equal(mapped[0].team, 'No Team');
  assert.equal(mapped[0].continentGroup, 'No Continent');
  // A raw continent still rolls up; only the blank becomes the bucket.
  const rolled = applyMapping([{ Id: 'C', 'Acc Continent': 'Oceania' }], { id: 'Id', continentGroup: 'Acc Continent' });
  assert.equal(rolled[0].continentGroup, 'APAC');
  // Unmapped columns stay empty: no phantom bucket on a source without them.
  const unmapped = applyMapping([{ Id: 'B' }], { id: 'Id' });
  assert.ok(!unmapped[0].region && !unmapped[0].pod && !unmapped[0].team);
});

test('uploaded dates keep the calendar day written in the cell, whatever the machine timezone', () => {
  const mapping = { id: 'Id', createdDate: 'Created', closeDate: 'Closed on' };
  const rows = applyMapping([
    { Id: 'A', Created: new Date(2026, 0, 1), 'Closed on': '1/1/26' },        // local-midnight Date + 2-digit year
    { Id: 'B', Created: '2026-01-01T00:00:00', 'Closed on': '01/02/2026' },   // Tableau datetime + 4-digit year
  ], mapping);
  assert.equal(rows[0].createdDate, '2026-01-01');
  assert.equal(rows[0].closeDate, '2026-01-01');
  assert.equal(rows[1].createdDate, '2026-01-01');
  assert.equal(rows[1].closeDate, '2026-01-02');
});

// One row = one opportunity. ARR is the only money field the board reads.
const opp = (over = {}) => ({
  id: 'O-1', name: 'Deal', account: 'Acme', accountId: 'A-1', owner: 'Riya', pod: 'EMEA AE', team: 'Account Executive',
  stage: 'Qualification', isClosed: false, isWon: false, arr: 1000, amount: 250,
  createdDate: '2026-02-10', closeDate: '2026-05-01', cycleDays: null, daysStuck: 10, staleThreshold: 15, isStalled: false,
  dealHealth: null, orgType: 'SMB', continentGroup: 'EMEA', industry: 'Software', source: 'Inbound', type: 'New Business', lossReason: null,
  ...over,
});
const rows = [
  opp({ id: 'W1', stage: 'Closed Won', isClosed: true, isWon: true, arr: 5000, cycleDays: 30, closeDate: '2026-03-01' }),
  opp({ id: 'W2', stage: 'Closed Won', isClosed: true, isWon: true, arr: 3000, cycleDays: 50, orgType: 'Enterprise', continentGroup: 'APAC', owner: 'Dev', pod: 'APAC AE', closeDate: '2026-04-01' }),
  opp({ id: 'L1', stage: 'Closed Lost', isClosed: true, isWon: false, arr: 2000, cycleDays: 80, lossReason: 'Not Responding', closeDate: '2026-04-15' }),
  opp({ id: 'L2', stage: 'Closed Lost', isClosed: true, isWon: false, arr: 1000, cycleDays: 20, lossReason: 'Price', accountId: 'A-2', account: 'Beta', closeDate: '2026-05-15' }),
  opp({ id: 'L3', stage: 'Closed Lost', isClosed: true, isWon: false, arr: 500, cycleDays: 10, lossReason: 'Something New', accountId: 'A-2', account: 'Beta', type: 'Renewal', closeDate: '2026-06-01' }),
  opp({ id: 'P1', stage: 'Negotiation', arr: 4000, daysStuck: 40, staleThreshold: 15, isStalled: true, dealHealth: 'Red' }),
  opp({ id: 'P2', stage: 'Trial', arr: 1500, daysStuck: 5, dealHealth: 'green' }),
  opp({ id: 'P3', stage: 'Brand New Stage', arr: 800, daysStuck: 3, accountId: 'A-3', account: 'Gamma' }),
  opp({ id: 'P3', stage: 'Duplicate row', arr: 999999 }), // duplicate id: dropped by the filter
];
const metrics = buildOpportunityMetrics(filterOpportunityRows(rows));

test('pulse counts one row per opportunity and every $ figure is ARR, never Amount', () => {
  assert.equal(metrics.pulse.total, 8);
  assert.equal(metrics.pulse.openCount, 3);
  assert.equal(metrics.pulse.closedCount, 5);
  assert.equal(metrics.pulse.wonCount, 2);
  assert.equal(metrics.pulse.winRate, 40);
  assert.equal(metrics.pulse.openArr, 4000 + 1500 + 800);
  assert.equal(metrics.pulse.wonArr, 8000);
  assert.equal(metrics.pulse.lostArr, 3500);
  assert.equal(metrics.pulse.avgCycle, 38); // (30+50+80+20+10)/5
});

test('the funnel follows the probability stage order and keeps a stage the source invents', () => {
  assert.deepEqual(metrics.funnel.map(item => item.stage), ['Trial', 'Negotiation', 'Brand New Stage']);
  assert.equal(STAGE_ORDER.indexOf('Trial') < STAGE_ORDER.indexOf('Negotiation'), true);
  assert.equal(metrics.funnel.find(item => item.stage === 'Negotiation').arr, 4000);
});

test('loss reasons roll up into families; unknown reasons stay visible under the unrecorded family', () => {
  assert.equal(lossFamilyOf('Not Responding'), DISENGAGEMENT_FAMILY);
  assert.equal(lossFamilyOf('no decision / non-responsive'), DISENGAGEMENT_FAMILY);
  assert.equal(lossFamilyOf('Price'), 'Competition or price');
  assert.equal(lossFamilyOf('Something New'), UNRECORDED_FAMILY);
  assert.equal(lossFamilyOf(''), UNRECORDED_FAMILY);
  const families = Object.fromEntries(metrics.lossFamilies.map(item => [item.family, item]));
  assert.equal(families[DISENGAGEMENT_FAMILY].count, 1);
  assert.equal(families[UNRECORDED_FAMILY].reasons[0].reason, 'Something New');
  assert.equal(metrics.diagnostics.disengagedCount, 1);
  assert.equal(metrics.diagnostics.disengagementRate, 20);   // 1 of 5 closed
  assert.equal(metrics.lossFamilies[metrics.lossFamilies.length - 1].cumulativeShare, 100);
});

test('deal health treats a blank as its own "Not rated" state, case-insensitively for the rest', () => {
  assert.equal(healthOf({ dealHealth: 'GREEN' }), 'Green');
  assert.equal(healthOf({ dealHealth: '' }), 'Not rated');
  assert.equal(healthOf({}), 'Not rated');
  const mix = Object.fromEntries(metrics.healthMix.map(item => [item.label, item]));
  assert.equal(mix['Not rated'].count, 1);
  assert.equal(mix.Red.arr, 4000);
  assert.equal(metrics.diagnostics.ratedCount, 2);
  assert.equal(metrics.diagnostics.atRiskShareOfRated, 50);
  assert.equal(metrics.atRisk[0].id, 'P1');
});

test('velocity reads the mapped stalled flag and thresholds; cycle medians come from cycleDays', () => {
  assert.equal(metrics.velocity.stalledCount, 1);
  assert.equal(metrics.velocity.stalledArr, 4000);
  assert.equal(metrics.velocity.wayOverCount, 1);        // 40 >= 15 * 2
  assert.equal(metrics.velocity.medianCycleWon, 50);
  assert.equal(metrics.velocity.medianCycleLost, 20);
  assert.equal(metrics.stalledDeals[0].id, 'P1');
});

test('reps and PODs aggregate distinct opportunities with ARR bookings; the account count survives for the header', () => {
  const riya = metrics.repStats.find(item => item.rep === 'Riya');
  assert.equal(riya.closed, 4);
  assert.equal(riya.wins, 1);
  assert.equal(riya.booked, 5000);
  assert.equal(metrics.repSummary.topByBookings.rep, 'Riya');
  assert.equal(metrics.podPerformance[0].pod, 'EMEA AE');
  assert.equal(metrics.pulse.accounts, 3);
  // The Accounts & Whitespace view was removed (ruling 2026-09-04): no account tables in the payload.
  assert.equal(metrics.accounts, undefined);
  assert.equal(metrics.repeatLossAccounts, undefined);
});

test('the Pulse trend buckets closes and creations by month and by quarter', () => {
  const march = metrics.trend.monthly.find(item => item.key === '2026-03');
  assert.equal(march.wonCount, 1);
  assert.equal(march.bookingsArr, 5000);
  // Q2 closes: W2 (Apr), L1 (Apr), L2 (May), L3 (Jun).
  const q2 = metrics.trend.quarterly.find(item => item.key === '2026-Q2');
  assert.equal(q2.closedCount, 4);
  assert.equal(q2.wonCount, 1);
  assert.equal(q2.bookingsArr, 3000);
});

test('highlights narrate the same numbers; the public variant never prints a currency or a day count', () => {
  const board = buildOpportunityHighlights(metrics, 'pulse');
  assert.match(board[0].text, /40\.0%/);
  for (const view of ['pulse', 'diagnostics', 'velocity', 'wherewewin', 'repperformance']) {
    const wall = buildOpportunityHighlights(metrics, view, { publicSafe: true });
    assert.ok(wall.length >= 1, `${view} produced a public highlight`);
    for (const item of wall) {
      assert.doesNotMatch(item.text, /\$/, `${view}: ${item.text}`);
      assert.doesNotMatch(item.text, /\bdays?\b/, `${view}: ${item.text}`);
    }
  }
});

test('the snapshot applies the query filters and dedupes before computing', () => {
  const snapshot = buildOpportunitySnapshot(rows, { continentGroup: 'EMEA', createdFrom: '2026-01-01', createdTo: '2026-12-31' });
  assert.deepEqual(buildOpportunityMetrics(filterOpportunityRows(rows)).byContinent.map(item => item.label), ['EMEA', 'APAC']);
  assert.equal(snapshot.rowCount, 7);
  assert.equal(snapshot.metrics.pulse.wonCount, 1);
  assert.equal(snapshot.comparison.available, true);
  assert.equal(snapshot.highlights.pulse.length > 0, true);
  assert.equal(snapshot.publicHighlights.velocity.length > 0, true);
});

test('autoMap: a bare "Owner" ID column no longer becomes Team Name, and Team Role does', () => {
  const { fieldMapping } = autoMap(['Opportunity ID', 'Owner', 'Owner Name', 'Team Role', 'Opp Stage', 'ARR']);
  assert.equal(fieldMapping.team, 'Team Role');
  assert.equal(fieldMapping.owner, 'Owner Name');
  assert.equal(fieldMapping.stage, 'Opp Stage');
  assert.equal(fieldMapping.arr, 'ARR');
});

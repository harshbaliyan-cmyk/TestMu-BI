import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBdrFunnelSnapshot, unifyBdrRow, parseAsOf, dayNumber } from '../services/bdrFunnelMetrics.js';

// Rows in the mapped (OPP_SCHEMA) shape the board reads, mirroring the
// stacked union: each helper fills one column family and leaves the rest
// blank, exactly as applyMapping leaves an unmapped string field ('').
const task = ({ id, owner, name, subtype = 'Call', due, created = '', lead, account = '', tlaAccount = '' }) => ({
  bdrTaskId: id, bdrTaskOwnerId: owner, bdrTaskOwnerName: name, bdrTaskSubtype: subtype,
  bdrTaskDueDate: due ?? null, bdrTaskCreatedDate: created || null, bdrLeadId: lead, bdrTaskAccountId: account,
  bdrTaskLeadAccountId: tlaAccount, bdrEventId: '', bdrAccountId: '',
});
const meeting = ({ id, owner, name, start, due = '', contact = '', rating = '' }) => ({
  bdrTaskId: '', bdrEventId: id, bdrEventOwnerId: owner, bdrEventOwnerName: name,
  bdrEventStart: start ?? null, bdrEventDueDate: due || null, bdrEventNameId: contact, bdrEventRating: rating, bdrAccountId: '',
});
const account = ({ id, owner, name, created }) => ({
  bdrTaskId: '', bdrEventId: '', bdrAccountId: id, bdrAccountOwnerId: owner, bdrAccountOwnerName: name, bdrAccountCreatedDate: created,
});

const PRIYA = { owner: 'u-priya', name: 'Priya Agarwal' };
const GAURI = { owner: 'u-gauri', name: 'Gauri M' };
const OTHER = { owner: 'u-someone', name: 'Not A BDR' };
const ROSTER = { userIds: ['u-priya'], names: ['Gauri M', 'Vibhuti Chadha'] };

const FIXTURE = [
  // Priya: floor on 1 Jun. Calls on days 0, 10, 40, 100; one duplicate task row (account join).
  task({ ...PRIYA, id: 't1', due: '2026-06-01', lead: 'L1' }),
  task({ ...PRIYA, id: 't1', due: '2026-06-01', lead: 'L1' }),
  task({ ...PRIYA, id: 't2', due: '2026-06-11', lead: 'L2' }),
  task({ ...PRIYA, id: 't3', due: '2026-07-11', lead: 'L3' }),
  task({ ...PRIYA, id: 't4', due: '2026-09-09', lead: 'L4' }),
  task({ ...PRIYA, id: 't5', due: '2026-09-09', lead: 'L1' }),               // L1 again: still one lead
  task({ ...PRIYA, id: 't6', subtype: 'Email', due: '2026-06-02', lead: 'L9' }), // not a dial
  task({ ...PRIYA, id: 't7', subtype: '', due: '2026-06-02', lead: 'L8' }),      // Unspecified: not a dial
  task({ ...PRIYA, id: 't8', due: null, created: '2026-05-30', lead: 'L7' }),    // before the floor? no: this IS the earliest call
  meeting({ ...PRIYA, id: 'e1', start: '2026-06-05T14:00:00', contact: 'C1', rating: 'Qualified' }),
  meeting({ ...PRIYA, id: 'e2', start: '2026-07-20', contact: 'C2', rating: 'To be Rated' }),
  meeting({ ...PRIYA, id: 'e3', start: '2026-07-21', contact: 'C3', rating: 'Future Qualified' }),
  meeting({ ...PRIYA, id: 'e4', start: null, due: '2026-05-28', contact: 'C4', rating: 'Qualified' }), // before the floor
  account({ ...PRIYA, id: 'A1', created: '2026-05-01' }),
  account({ ...PRIYA, id: 'A2', created: '2026-05-02' }),
  account({ ...PRIYA, id: 'A2', created: '2026-05-02' }),
  // Gauri: meetings but no calls at all (roster by name).
  meeting({ ...GAURI, id: 'e5', start: '2026-06-10', contact: 'C5', rating: 'Disqualified' }),
  meeting({ ...GAURI, id: 'e6', start: '2026-06-12', contact: 'C6', rating: 'Qualified' }),
  // Not on the roster: must not appear.
  task({ ...OTHER, id: 't9', due: '2026-06-01', lead: 'L1' }),
];

test('record type is inferred from which activity id is present, and keys coalesce in stream order', () => {
  assert.equal(unifyBdrRow(task({ ...PRIYA, id: 't', due: '2026-06-01', lead: 'L', account: 'fallback', tlaAccount: 'joined' })).accountKey, 'joined');
  assert.equal(unifyBdrRow(task({ ...PRIYA, id: 't', due: '2026-06-01', lead: 'L', account: 'fallback' })).accountKey, 'fallback');
  const m = unifyBdrRow(meeting({ ...PRIYA, id: 'e', start: '', due: '2026-06-01', contact: 'C', rating: 'To be Rated' }));
  assert.deepEqual([m.recordType, m.activityDate, m.leadKey, m.isRated, m.isQualified, m.subtype], ['Meeting', '2026-06-01', 'C', false, false, 'Meeting']);
  const a = unifyBdrRow(account({ ...PRIYA, id: 'A', created: '2026-05-01' }));
  assert.deepEqual([a.recordType, a.leadKey, a.eventId, a.subtype, a.userId], ['Account', null, null, 'Account', 'u-priya']);
});

test('the thirteen measures, pinned to an as-of date', () => {
  const { rows, asOf, summary } = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-15', roster: ROSTER });
  assert.equal(asOf, '2026-09-15');
  assert.deepEqual(rows.map(r => r.name), ['Gauri M', 'Priya Agarwal'], 'sorted by name, non-roster user excluded');
  const priya = rows[1];
  assert.equal(priya.floorHitDate, '2026-05-30', 'a task with no due date falls back to its created date');
  assert.equal(priya.firstMeetingDate, '2026-05-28');
  assert.equal(priya.firstQualifiedMeetingDate, '2026-05-28');
  assert.equal(priya.weeksMeasured, Math.trunc((dayNumber('2026-09-15') - dayNumber('2026-05-30')) / 7) + 1);
  assert.equal(priya.accountsAssigned, 2, 'distinct account keys, not rows');
  assert.equal(priya.uniqueLeadsCalled, 5, 'L1 (twice, plus a duplicate row), L2, L3, L4, L7; email and unspecified do not count');
  assert.equal(priya.meetingsGenerated, 4);
  assert.equal(priya.meetingsRated, 3, '"To be Rated" is not a rating');
  assert.equal(priya.qualifiedTotal, 2, '"Future Qualified" is not qualified');
  assert.equal(priya.avgLeadsPerWeek, 5 / priya.weeksMeasured);
  // Floor is 30 May. Offsets: L7 0, L1 2, L2 12, L3 42, L4/L1 102.
  assert.deepEqual([priya.leadsByDay30, priya.leadsByDay60, priya.leadsByDay90], [3, 4, 4]);
  // e4 (28 May) is before the floor and excluded; e1 (5 Jun) is offset 6.
  assert.deepEqual([priya.qualifiedByDay30, priya.qualifiedByDay60, priya.qualifiedByDay90], [1, 1, 1]);
  assert.ok(priya.leadsByDay30 <= priya.leadsByDay60 && priya.leadsByDay60 <= priya.leadsByDay90 && priya.leadsByDay90 <= priya.uniqueLeadsCalled, 'windows nest');
  assert.deepEqual(summary.unresolvedNames, ['Vibhuti Chadha']);
  assert.equal(summary.bdrCount, 2);
  assert.equal(summary.totalUniqueLeadsCalled, 5);
});

test('a BDR with meetings but no calls is not measurable, and that is rendered as null rather than zero', () => {
  const gauri = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-15', roster: ROSTER }).rows[0];
  assert.equal(gauri.floorHitDate, null);
  assert.equal(gauri.weeksMeasured, null);
  assert.equal(gauri.avgLeadsPerWeek, null);
  assert.equal(gauri.meetingsGenerated, 2);
  assert.equal(gauri.meetingsRated, 2);
  assert.equal(gauri.qualifiedTotal, 1);
  assert.equal(gauri.firstQualifiedMeetingDate, '2026-06-12');
  assert.deepEqual([gauri.leadsByDay30, gauri.qualifiedByDay90], [0, 0]);
});

test('only Weeks Measured and Avg Leads per Week move with the as-of date', () => {
  const a = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-15', roster: ROSTER }).rows[1];
  const b = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-22', roster: ROSTER }).rows[1];
  assert.equal(b.weeksMeasured, a.weeksMeasured + 1);
  assert.ok(b.avgLeadsPerWeek < a.avgLeadsPerWeek);
  const { weeksMeasured: wa, avgLeadsPerWeek: aa, ...restA } = a;
  const { weeksMeasured: wb, avgLeadsPerWeek: ab, ...restB } = b;
  assert.deepEqual(restA, restB);
});

test('an empty roster means everyone; a roster keeps ids and names both', () => {
  const everyone = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-15', roster: { userIds: [], names: [] } });
  assert.deepEqual(everyone.rows.map(r => r.name), ['Gauri M', 'Not A BDR', 'Priya Agarwal']);
  assert.equal(everyone.summary.rosterSize, null);
  const byIdOnly = buildBdrFunnelSnapshot(FIXTURE, { asOf: '2026-09-15', roster: { userIds: ['u-someone'], names: [] } });
  assert.deepEqual(byIdOnly.rows.map(r => r.name), ['Not A BDR']);
});

test('as-of parsing accepts only a real calendar day and otherwise pins to today', () => {
  const today = parseAsOf(undefined, new Date(2026, 8, 16));
  assert.equal(today, '2026-09-16');
  assert.equal(parseAsOf('2026-02-30', new Date(2026, 8, 16)), '2026-09-16');
  assert.equal(parseAsOf('2026-02-28'), '2026-02-28');
  assert.equal(parseAsOf('16/09/2026', new Date(2026, 8, 16)), '2026-09-16');
});

test('empty input produces an empty board, not an error', () => {
  const snapshot = buildBdrFunnelSnapshot([], { asOf: '2026-09-15', roster: ROSTER });
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.summary.rowsScanned, 0);
  assert.deepEqual(snapshot.summary.unresolvedNames, ['Gauri M', 'Vibhuti Chadha']);
});

test('the shipped roster carries the 31 names exactly as the data spells them', () => {
  const roster = JSON.parse(readFileSync(new URL('../config/bdrRoster.json', import.meta.url), 'utf8'));
  assert.equal(roster.names.length, 31);
  for (const name of ['Saksham Chandhok', 'Gauri M', 'Dushaan Singh', 'Adamya Veer', 'Ayush Kumar BDR']) assert.ok(roster.names.includes(name), name);
  for (const wrong of ['Saksham Chandok', 'Gauri M.', 'Ayush Kumar']) assert.ok(!roster.names.includes(wrong), wrong);
  assert.ok(roster.userIds.includes('005e200000AKwYLAA1'), 'the BDR Ayush Kumar, not the PreSales one');
});

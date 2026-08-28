import test from 'node:test';
import assert from 'node:assert/strict';
import { profileColumns } from '../services/columnProfile.js';

const byName = (profiles, name) => profiles.find(p => p.name === name);

test('types are inferred from the dominant value, tolerating dirty rows', () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => ({ amount: `$${(i + 1) * 1000}`, closed: '2026-08-0' + (i + 1), active: 'yes', region: 'AMER' })),
    { amount: 'n/a', closed: 'pending', active: 'maybe', region: 'EMEA' },
  ];
  const profiles = profileColumns(['amount', 'closed', 'active', 'region'], rows);
  assert.equal(byName(profiles, 'amount').type, 'number', 'nine dollars and one typo is a number column');
  assert.equal(byName(profiles, 'closed').type, 'date');
  assert.equal(byName(profiles, 'active').type, 'boolean');
  assert.equal(byName(profiles, 'region').type, 'string');
});

test('numeric min/max strip currency formatting and honour parentheses negatives', () => {
  const rows = [{ v: '$1,500.50' }, { v: '(200)' }, { v: '3000' }];
  const profile = byName(profileColumns(['v'], rows), 'v');
  assert.equal(profile.type, 'number');
  assert.equal(profile.min, -200);
  assert.equal(profile.max, 3000);
});

test('date min/max come back as ISO days', () => {
  const rows = [{ d: '2026-01-15' }, { d: '2025-12-01' }, { d: '2026-08-27' }];
  const profile = byName(profileColumns(['d'], rows), 'd');
  assert.equal(profile.min, '2025-12-01');
  assert.equal(profile.max, '2026-08-27');
});

test('distinct counts cap instead of enumerating 17k opportunity names', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ name: `Deal ${i}` }));
  const profile = byName(profileColumns(['name'], rows, { distinctCap: 200 }), 'name');
  assert.equal(profile.distinct, 200);
  assert.equal(profile.distinctCapped, true);
});

test('blanks reduce fill rate but never change the type', () => {
  const rows = [{ q: 100 }, { q: '' }, { q: null }, { q: 250 }];
  const profile = byName(profileColumns(['q'], rows), 'q');
  assert.equal(profile.type, 'number');
  assert.equal(profile.filled, 2);
  assert.equal(profile.fillRate, 50);
});

test('an entirely empty column profiles as an empty string column, not a crash', () => {
  const profiles = profileColumns(['ghost'], [{ ghost: '' }, {}]);
  assert.deepEqual(byName(profiles, 'ghost'), {
    name: 'ghost', type: 'string', filled: 0, fillRate: 0, distinct: 0,
    distinctCapped: false, min: null, max: null, samples: [],
  });
});

test('booleans as real true/false and as yes/no both profile as boolean', () => {
  const rows = [{ a: true, b: 'yes' }, { a: false, b: 'no' }];
  const profiles = profileColumns(['a', 'b'], rows);
  assert.equal(byName(profiles, 'a').type, 'boolean');
  assert.equal(byName(profiles, 'b').type, 'boolean');
});

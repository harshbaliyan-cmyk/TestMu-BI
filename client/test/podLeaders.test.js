import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { POD_LEADERS, getPodLeader } from '../src/lib/podLeaders.js';

test('all supplied leader assignments still resolve and their local images exist', async () => {
  for (const [label, leader] of Object.entries(POD_LEADERS)) {
    assert.equal(getPodLeader(label), leader);
    assert.ok((await stat(new URL(`../public${leader.photo}`, import.meta.url))).size > 0);
  }
});

test('the shortened AMER labels from the dashboard retain their supplied leaders', () => {
  assert.equal(getPodLeader('AMER II').name, 'Misbah Farooqi');
  assert.equal(getPodLeader('AMER III').name, 'Mohit Juneja');
  assert.equal(getPodLeader('AMER CORP').name, 'Misbah Farooqi');
  assert.equal(getPodLeader('  amer   ae   corp ').name, 'Misbah Farooqi');
  assert.equal(getPodLeader('AMER\u00a0II').name, 'Misbah Farooqi');
});

test('case, spacing, separators and known role-first labels resolve consistently', () => {
  for (const [alias, canonical] of [['AE EMEA', 'EMEA AE'], ['ae-apac', 'APAC AE'], ['AE AMER III', 'AMER AE III'], ['am_emea', 'EMEA AM'], ['AM AMER', 'AMER AM'], ['AM APAC', 'APAC AM'], ['AE GCC', 'GCC']]) {
    assert.equal(getPodLeader(alias), getPodLeader(canonical));
  }
});

test('AE/AM identities stay separate and unknown PODs are not assigned guessed leaders', () => {
  assert.equal(getPodLeader('EMEA AE').name, 'Saif Rizvi');
  assert.equal(getPodLeader('EMEA AM').name, 'Rishabh Agarwal');
  for (const label of [null, '', 'AMER', 'AMER I', 'AMER AE I', 'AMER AM II', 'New EMEA team', '__proto__']) assert.equal(getPodLeader(label), null);
});

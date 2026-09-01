import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualProductName, productGroupFor, continentGroupFor, productArrFrom, orgTypeFrom,
} from '../services/productDerivations.js';
import { applyMapping } from '../datasources.js';

test('actual product name collapses SKUs to display names, and passes unknown SKUs through visibly', () => {
  assert.equal(actualProductName('HyperExecute MultiOS'), 'HyperExecute');
  assert.equal(actualProductName('Real Device Live'), 'Manual - RD');
  assert.equal(actualProductName('Kane CLI Starter'), 'Kane CLI');
  assert.equal(actualProductName('Virtual & Real Device Plus Automation Cloud'), 'Virtual Cloud');
  // Deviation from the Tableau ELSE "": a brand-new SKU stays visible under
  // its raw name instead of silently vanishing from every per-product split.
  assert.equal(actualProductName('Some Future SKU'), 'Some Future SKU');
});

test('product group buckets by RAW SKU with ELSE → Others, exactly like the Tableau formula', () => {
  assert.equal(productGroupFor('Kane CLI'), 'Agentic AI');
  assert.equal(productGroupFor('Test Manager'), 'Agentic AI');
  assert.equal(productGroupFor('TestMuOne - Lite'), 'Agentic cloud: Hyperexecute');
  assert.equal(productGroupFor('Real Device Live'), 'Browser And App');
  assert.equal(productGroupFor('GDPR'), 'Others');
  assert.equal(productGroupFor('Some Future SKU'), 'Others'); // the ELSE branch
  assert.equal(productGroupFor(''), '');                      // no product, no group
});

test('continent group rolls up raw continents and passes already-grouped values through', () => {
  assert.equal(continentGroupFor('Asia'), 'APAC');
  assert.equal(continentGroupFor('Oceania'), 'APAC');
  assert.equal(continentGroupFor('South America'), 'Americas');
  assert.equal(continentGroupFor('Middle East'), 'EMEA');
  assert.equal(continentGroupFor('APAC'), 'APAC');       // grouped column mapped directly
  assert.equal(continentGroupFor('Atlantis'), '');       // formula's ELSE ""
});

test('product ARR = (TotalPrice / Subscription Duration) * 12, null when it cannot be computed', () => {
  assert.equal(productArrFrom(1200, 12), 1200);
  assert.equal(productArrFrom(600, 6), 1200);
  assert.equal(productArrFrom(1200, 0), null);    // zero-month term is data noise, not ∞ ARR
  assert.equal(productArrFrom(null, 12), null);
  assert.equal(productArrFrom(1200, null), null);
});

test('org type: free domain forces SMB over any headcount, then the employee bands', () => {
  assert.equal(orgTypeFrom(true, 50000), 'SMB');
  assert.equal(orgTypeFrom(false, 2000), 'Enterprise');
  assert.equal(orgTypeFrom(false, 100), 'Mid-Market');
  assert.equal(orgTypeFrom(false, 99), 'SMB');
  assert.equal(orgTypeFrom(false, null), 'SMB');  // the formula's ELSE
});

test('applyMapping derives the whole product row from raw columns — the real source ships no calculated fields', () => {
  const mapping = {
    id: 'OpportunityID', stage: 'Stage', totalPrice: 'TotalPrice', subscriptionDuration: 'SubscriptionDuration',
    product: 'ProductName', continentGroup: 'AccContinent', createdDate: 'CreatedDate', closeDate: 'CloseDate',
  };
  const [row] = applyMapping([{
    OpportunityID: 'OPP-1', Stage: 'Negotiation', TotalPrice: '600', SubscriptionDuration: '6',
    ProductName: 'HyperExecute MultiOS', AccContinent: 'Asia',
    CreatedDate: '2026-07-01', CloseDate: '2026-09-01',
  }], mapping);
  assert.equal(row.productArr, 1200);                          // (600/6)*12
  assert.equal(row.product, 'HyperExecute');                   // display name
  assert.equal(row.productGroup, 'Agentic cloud: Hyperexecute'); // bucketed by RAW SKU
  assert.equal(row.continentGroup, 'APAC');
});

test('applyMapping derivations never override a real mapped column', () => {
  const mapping = {
    id: 'OpportunityID', stage: 'Stage', productArr: 'ProductARR', totalPrice: 'TotalPrice',
    subscriptionDuration: 'SubscriptionDuration', product: 'ProductName', productGroup: 'ProductGroup',
  };
  const [row] = applyMapping([{
    OpportunityID: 'OPP-1', Stage: 'Trial', ProductARR: '999', TotalPrice: '600', SubscriptionDuration: '6',
    ProductName: 'Kane CLI', ProductGroup: 'Hand-Picked Group',
  }], mapping);
  assert.equal(row.productArr, 999);                 // the mapped column wins over (600/6)*12
  assert.equal(row.productGroup, 'Hand-Picked Group'); // mapped group wins over the SKU bucket
  assert.equal(row.product, 'Kane CLI');             // display-name map is an identity here
});

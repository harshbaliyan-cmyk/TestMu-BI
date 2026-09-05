import test from 'node:test';
import assert from 'node:assert/strict';
import {
  productGroupOf, actualProductNameOf, continentGroupOf, orgTypeOf, forecastGroupOf, arrOf, productArrOf,
  quarterOf, quarterRange, quarterLabel, enrichExecutiveRow, filterExecutiveRows, buildExecutiveMetrics,
  buildExecutiveSnapshot, NO_FORECAST, NO_POD, UNMAPPED_GROUP, OTHER_PRODUCT, NO_CONTINENT,
} from '../services/executiveMetrics.js';

const TODAY = '2026-09-05';            // Q3-2026: 1 Jul – 30 Sep
const Q3 = { closeFrom: '2026-07-01', closeTo: '2026-09-30' };
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

// Product-line row factory: an OPPORTUNITY may produce several of these, one
// per product; opportunity-level columns repeat on each. Raw source column
// semantics: Amount + Subscription Duration (opp), Total Price +
// Subscription Duration-1 (line), Product Name = raw SKU.
const line = (over = {}) => ({
  id: 'OPP', name: 'Deal', account: 'Acct', owner: 'Riya', userId: 'U1', ownerActive: true, oppActive: true,
  stage: 'Negotiation', isClosed: false, isWon: false, type: 'New Business', opportunityForecast: '',
  amount: 12000, subscriptionDuration: 12, closeDate: '2026-09-20', createdDate: '2026-06-01', misRequired: false,
  productRaw: 'Kane CLI', product: 'Kane CLI', totalPrice: 12000, lineDuration: 12,
  pod: 'AMER II', salesPod: 'AMER-2', quotaCurrent: 100000, orgType: '', employees: 5000, freeDomain: false,
  continentGroup: 'Europe',
  ...over,
});
const riya = { owner: 'Riya', userId: 'U1', pod: 'AMER II', salesPod: 'AMER-2', quotaCurrent: 100000 };
const dev = { owner: 'Dev', userId: 'U2', pod: 'EMEA AE', salesPod: 'EMEA-Sales', quotaCurrent: 50000 };
const sam = { owner: 'Sam', userId: 'U3', pod: 'AM APAC', salesPod: 'AM-APAC', quotaCurrent: null };
const zed = { owner: 'Zed', userId: 'U4', pod: '', salesPod: '', quotaCurrent: 20000, ownerActive: false };

// W1  won 01 Aug (this quarter)  Amount 12,000 / 12 → ARR 12,000; lines 8,000 + 4,000  Riya  MIS
// W2  won 10 May (last quarter)  Amount 24,000 / 24 → ARR 12,000; one line          Dev
// O1  open Trial 20 Sep          ARR 12,000; lines 6,000 + 7,000 (= 13,000, a +1,000 source gap)  Riya  High → Best Case
// O2  open Negotiation 25 Sep    ARR 5,000; one line (A2A, double space)               Dev   Commit
// O3  open Trial 15 Aug          ARR 2,400; GDPR line → Others / Others              Sam   no forecast, opp INACTIVE
// O4  open 05 Oct (next quarter) ARR 9,000                                              Zed   Low → No Projection, type Renewal
// L1  lost 20 Jul                ARR 3,000                                              Riya
// X1  open, NO close date        ARR 1,000                                              Dev
const rows = [
  line({ id: 'W1', name: 'Acme deal', account: 'Acme', ...riya, stage: 'Closed Won', isClosed: true, isWon: true, closeDate: '2026-08-01',
    amount: 12000, subscriptionDuration: 12, misRequired: true, opportunityForecast: 'Commit',
    productRaw: 'Kane AI (Web)', totalPrice: 8000, lineDuration: 12 }),
  line({ id: 'W1', name: 'Acme deal', account: 'Acme', ...riya, stage: 'Closed Won', isClosed: true, isWon: true, closeDate: '2026-08-01',
    amount: 12000, subscriptionDuration: 12, misRequired: true, opportunityForecast: 'Commit',
    productRaw: 'HyperExecute MultiOS', totalPrice: 4000, lineDuration: 12 }),
  line({ id: 'W2', name: 'Beta renewal', account: 'Beta', ...dev, stage: 'Closed Won', isClosed: true, isWon: true, closeDate: '2026-05-10',
    amount: 24000, subscriptionDuration: 24, productRaw: 'Test Manager', totalPrice: 24000, lineDuration: 24 }),
  line({ id: 'O1', name: 'Gamma trial', account: 'Gamma', ...riya, stage: 'Trial', closeDate: '2026-09-20', amount: 6000, subscriptionDuration: 6,
    opportunityForecast: 'High', productRaw: 'Kane CLI', totalPrice: 3000, lineDuration: 6, continentGroup: 'Asia', employees: 150 }),
  line({ id: 'O1', name: 'Gamma trial', account: 'Gamma', ...riya, stage: 'Trial', closeDate: '2026-09-20', amount: 6000, subscriptionDuration: 6,
    opportunityForecast: 'High', productRaw: 'Real Device Live', totalPrice: 3500, lineDuration: 6, continentGroup: 'Asia', employees: 150 }),
  line({ id: 'O2', name: 'Delta', account: 'Delta', ...dev, stage: 'Negotiation', closeDate: '2026-09-25', amount: 5000, subscriptionDuration: 12,
    opportunityForecast: 'Commit', productRaw: 'Agent to Agent  Testing', totalPrice: 5000, lineDuration: 12 }),
  line({ id: 'O3', name: 'Epsilon', account: 'Epsilon', ...sam, stage: 'Trial', closeDate: '2026-08-15', amount: 2400, subscriptionDuration: 12,
    type: 'New Business AM', productRaw: 'GDPR', totalPrice: 2400, lineDuration: 12, oppActive: false }),
  line({ id: 'O4', name: 'Zeta', account: 'Zeta', ...zed, stage: 'Post Trial Discussion', closeDate: '2026-10-05', amount: 9000, subscriptionDuration: 12,
    type: 'Renewal', opportunityForecast: 'Low', productRaw: 'Kane AI (Web)', totalPrice: 9000, lineDuration: 12 }),
  line({ id: 'L1', name: 'Eta', account: 'Eta', ...riya, stage: 'Closed Lost', isClosed: true, isWon: false, closeDate: '2026-07-20',
    amount: 3000, subscriptionDuration: 12, productRaw: 'Others', totalPrice: 3000, lineDuration: 12 }),
  line({ id: 'X1', name: 'Theta', account: 'Theta', ...dev, stage: 'Qualification', closeDate: null, amount: 1000, subscriptionDuration: 12,
    productRaw: 'Kane CLI', totalPrice: 1000, lineDuration: 12 }),
];
const snapshot = (query = Q3) => buildExecutiveSnapshot(rows, query, TODAY);

// ===== Lookup tables and per-row rules =====
test('product group: TRIM then exact match; the A2A double space is data; unknowns are Unmapped', () => {
  assert.equal(productGroupOf(' Kane CLI '), 'Agentic AI');
  assert.equal(productGroupOf('Agent  to Agent Testing'), 'Agentic AI');   // the source's spelling
  assert.equal(productGroupOf('Agent to Agent  Testing'), 'Agentic AI');   // the spec's transcription
  assert.equal(productGroupOf('Agent to Agent Testing'), 'Agentic AI');    // the sheet's text export
  assert.equal(productGroupOf('HyperExecute - Public Cloud'), 'Agentic cloud: Hyperexecute');
  assert.equal(productGroupOf('SSO Support'), 'Browser And App');
  assert.equal(productGroupOf('IP Whitelisting'), 'Others');
  assert.equal(productGroupOf('GDPR'), 'Others');                          // compliance SKUs are Others per the sheet
  assert.equal(productGroupOf('Brand New SKU'), UNMAPPED_GROUP);
  // The four SKUs the sheet omits, filed with their families by ruling.
  assert.equal(productGroupOf('KaneAI Max'), 'Agentic AI');
  assert.equal(productGroupOf('KaneAI Desktop Essentials'), 'Agentic AI');
  assert.equal(productGroupOf('HyperExecute Private Cloud'), 'Agentic cloud: Hyperexecute');
  assert.equal(productGroupOf('Web and App Automation on Virtual Device'), 'Browser And App');
  assert.equal(productGroupOf(''), UNMAPPED_GROUP);
});

test('actual product name: friendly names, unlisted SKUs become Others', () => {
  assert.equal(actualProductNameOf('KaneAI Max'), 'Kane AI');
  assert.equal(actualProductNameOf('Agent  to Agent Testing'), 'A2A');
  assert.equal(actualProductNameOf('Agent to Agent  Testing'), 'A2A');
  assert.equal(actualProductNameOf('HyperExecute Private Cloud'), 'HyperExecute');
  assert.equal(actualProductNameOf('Real Device Live'), 'Manual - RD');
  assert.equal(actualProductNameOf('GDPR'), OTHER_PRODUCT);
  assert.equal(actualProductNameOf('Brand New SKU'), OTHER_PRODUCT);
});

test('continent group rolls up raw continents, passes rolled values through, and names the blank', () => {
  assert.equal(continentGroupOf('Oceania'), 'APAC');
  assert.equal(continentGroupOf('South America'), 'Americas');
  assert.equal(continentGroupOf('Middle East'), 'EMEA');
  assert.equal(continentGroupOf('EMEA'), 'EMEA');
  assert.equal(continentGroupOf(''), NO_CONTINENT);
  assert.equal(continentGroupOf('Antarctica'), NO_CONTINENT);
});

test('org type: a mapped column wins, otherwise Free Domain then employee bands', () => {
  assert.equal(orgTypeOf({ orgType: 'Mid-Market', employees: 5000 }), 'Mid-Market');
  assert.equal(orgTypeOf({ freeDomain: true, employees: 5000 }), 'SMB');
  assert.equal(orgTypeOf({ employees: 2000 }), 'Enterprise');
  assert.equal(orgTypeOf({ employees: 100 }), 'Mid-Market');
  assert.equal(orgTypeOf({ employees: 99 }), 'SMB');
  assert.equal(orgTypeOf({}), 'SMB');
});

test('forecast group merges Low/No Projection and Best Case/High; blank stays blank', () => {
  assert.equal(forecastGroupOf('High'), 'Best Case');
  assert.equal(forecastGroupOf('low'), 'No Projection');
  assert.equal(forecastGroupOf('commit'), 'Commit');
  assert.equal(forecastGroupOf(''), null);
  assert.equal(forecastGroupOf('Omitted'), 'Omitted');
});

test('ARR and Product ARR follow the formulas, fall back to a mapped column, and stay null when unpriced', () => {
  assert.equal(arrOf({ amount: 12000, subscriptionDuration: 24 }), 6000);
  assert.equal(arrOf({ amount: 100, subscriptionDuration: 0, arr: 55 }), 55);
  assert.equal(arrOf({}), null);
  assert.equal(productArrOf({ totalPrice: 1200, lineDuration: 12 }), 1200);
  assert.equal(productArrOf({ totalPrice: 1200, subscriptionDuration: 6 }), 2400);   // single-duration source
  assert.equal(productArrOf({ totalPrice: 1200, lineDuration: 6, subscriptionDuration: 12 }), 2400); // line column wins
  assert.equal(productArrOf({ totalPrice: null, lineDuration: 12 }), null);
});

test('calendar quarters', () => {
  assert.deepEqual(quarterOf('2026-09-05'), { year: 2026, quarter: 3 });
  assert.equal(quarterLabel(quarterOf('2026-09-05')), 'Q3-2026');
  assert.deepEqual(quarterRange({ year: 2026, quarter: 3 }), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(quarterRange({ year: 2027, quarter: 4 }), { from: '2027-10-01', to: '2027-12-31' });
  assert.equal(quarterOf(''), null);
});

// ===== The grain: one value per opportunity, lines summed =====
test('opportunity-level ARR is read once per opportunity (MIN over its lines); line ARR sums', () => {
  const { metrics } = snapshot();
  // O1: two lines carry the same 12,000 ARR — counted once in gross pipeline.
  const o1 = metrics.openPipelineByPod.find(entry => entry.label === 'AMER II');
  close(o1.arr, 12000, 'AMER II open pipeline');
  assert.equal(o1.opps, 1);
  // …while its product lines (6,000 + 7,000) sum at product grain.
  close(metrics.openPipeProductGrain, 11000 + 7000 + 2400, 'product-grain open pipe');
  close(metrics.openPipeGap, 1000, 'the source gap is reported, never forced away');
});

test('two lines of one opportunity with different opp-level values take the MIN, as {FIXED: MIN()} does', () => {
  const odd = [line({ id: 'M', amount: 1200 }), line({ id: 'M', amount: 1000 })];
  const { metrics } = buildExecutiveSnapshot(odd, {}, TODAY);
  close(metrics.kpis.openPipelineArr, 1000, 'MIN of 1,200 and 1,000');
});

// ===== The KPI tiles =====
test('KPI tiles under the default Q3 close-date scope', () => {
  const { metrics, rowCount } = snapshot();
  assert.equal(rowCount, 7);
  const k = metrics.kpis;
  close(k.targetArr, 150000, 'quota of the users present: Riya 100k + Dev 50k + Sam none');
  close(k.currentQuarterWonArr, 12000, 'W1 only');
  close(k.quotaAttainment, 0.08, 'attainment');
  close(k.gapToQuota, 138000, 'gap');
  close(k.openPipelineArr, 19400, 'O1 + O2 + O3');
  close(k.pipelineCoverage, 19400 / 150000, 'coverage');
  close(k.commitArr, 5000, 'O2 is the only open Commit closing this quarter');
  assert.equal(k.trialOpps, 2);
  close(k.trialArr, 14400, 'O1 + O3');
  close(k.trialCoverage, 14400 / 150000, 'trial coverage');
  assert.deepEqual(metrics.quarter, { label: 'Q3-2026', from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(metrics.counts, { opportunities: 5, openOpportunities: 3, wonOpportunities: 1, users: 3 });
});

test('Target ARR follows user SURVIVAL: a product segment that removes every row of a user removes their quota', () => {
  const { metrics } = snapshot({ ...Q3, segmentBy: 'product', segment: ['Kane AI'] });
  close(metrics.kpis.targetArr, 100000, 'only Riya has a Kane AI line in Q3');
  close(metrics.kpis.currentQuarterWonArr, 12000, 'W1 survives through its Kane AI line and counts its full ARR once');
  close(metrics.kpis.openPipelineArr, 0, 'no open Kane AI line in Q3');
});

test('current-quarter won ARR is pinned to TODAY\'s quarter whatever the date filter says', () => {
  const { metrics } = snapshot({});   // no date filter: W2 (May) is in scope
  close(metrics.kpis.targetArr, 170000, 'all four users present now');
  close(metrics.kpis.currentQuarterWonArr, 12000, 'W2 closed last quarter and stays out of the tile');
  // …but W2 does appear in the closed-won objects, which follow the filter.
  assert.deepEqual(metrics.closedWonDeals.map(deal => deal.id), ['W1', 'W2']);
  const agentic = metrics.wonByProductGroup.find(entry => entry.label === 'Agentic AI');
  close(agentic.wonProductArr, 8000 + 12000, 'Kane AI (Web) + Test Manager');
  assert.equal(agentic.opps, 2);
});

test('Trial-only definitions: Post Trial Discussion is not a trial', () => {
  const { metrics } = snapshot({});
  assert.equal(metrics.kpis.trialOpps, 2);
  close(metrics.kpis.trialArr, 14400, 'O4 (Post Trial Discussion) is excluded');
});

// ===== Filters =====
test('a relative date filter drops rows with no close date, like Tableau', () => {
  const all = snapshot({});
  const q3 = snapshot(Q3);
  assert.equal(all.rowCount, rows.length);
  assert.ok(all.metrics.forecastMix.find(entry => entry.label === NO_FORECAST).opps === 2, 'O3 and X1 have no forecast');
  assert.equal(q3.metrics.forecastMix.find(entry => entry.label === NO_FORECAST).opps, 1);
});

test('MIS Required, POD, Opportunity Type and Rep segment filters restrict survivors', () => {
  close(snapshot({ ...Q3, misRequired: ['Yes'] }).metrics.kpis.targetArr, 100000, 'only W1 (Riya) is MIS');
  close(snapshot({ ...Q3, misRequired: ['Yes'] }).metrics.kpis.openPipelineArr, 0, 'no open MIS deal');
  close(snapshot({ ...Q3, pod: ['EMEA AE'] }).metrics.kpis.targetArr, 50000, 'Dev only');
  assert.equal(snapshot({ ...Q3, type: ['New Business'] }).metrics.kpis.trialOpps, 1);
  const byRep = snapshot({ ...Q3, segmentBy: 'owner', segment: ['Dev'] }).metrics.kpis;
  close(byRep.openPipelineArr, 5000, 'O2');
  close(byRep.commitArr, 5000, 'O2');
  assert.equal(snapshot({ ...Q3, segmentBy: 'orgType', segment: ['Mid-Market'] }).metrics.counts.opportunities, 1);
  assert.equal(snapshot({ ...Q3, segmentBy: 'continentGroup', segment: ['APAC'] }).metrics.counts.opportunities, 1);
  assert.equal(snapshot({ ...Q3, segmentBy: 'nonsense' }).segmentBy, 'product');
});

// ===== The chart objects and the identities that must hold =====
test('per-POD objects: every POD kept, attainment null without quota, sums tie to the tiles', () => {
  const { metrics } = snapshot();
  const attainment = Object.fromEntries(metrics.attainmentByPod.map(entry => [entry.label, entry.attainment]));
  close(attainment['AMER II'], 0.12, 'Riya');
  close(attainment['EMEA AE'], 0, 'Dev, nothing won');
  assert.equal(attainment['AM APAC'], null, 'Sam carries no quota');
  assert.deepEqual(metrics.attainmentByPod.map(entry => entry.label), ['AMER II', 'EMEA AE', 'AM APAC']);

  const openTotal = metrics.openPipelineByPod.reduce((total, entry) => total + entry.arr, 0);
  close(openTotal, metrics.kpis.openPipelineArr, 'Σ Open Pipeline by POD = Open Pipeline tile');

  const commitTotal = metrics.forecastByPod.reduce((total, entry) => total + entry.commit, 0);
  close(commitTotal, metrics.kpis.commitArr, 'Σ Commit bars = Forecast (Commit) tile');
  assert.deepEqual(metrics.forecastByPod.map(entry => entry.label), ['AMER II', 'EMEA AE']);
  close(metrics.forecastByPod[0].bestCase, 12000, 'O1 High → Best Case');
});

test('active trials by POD honours Active and User Active only once the source shows those flags', () => {
  const { metrics } = snapshot();
  assert.deepEqual(metrics.trialFilters, { oppActive: true, ownerActive: true });
  assert.deepEqual(metrics.trialsByPod, [{ label: 'AMER II', trialOpps: 1, trialArr: 12000 }]);
  // The same rows with the opportunity flag never mapped (false everywhere)
  // must not empty the chart.
  const unmapped = rows.map(row => ({ ...row, oppActive: false }));
  const relaxed = buildExecutiveSnapshot(unmapped, Q3, TODAY).metrics;
  assert.equal(relaxed.trialFilters.oppActive, false);
  assert.equal(relaxed.trialsByPod.reduce((total, entry) => total + entry.trialOpps, 0), relaxed.kpis.trialOpps);
});

test('product-grain objects: won product ARR ties to current-quarter won ARR; the two open-pipe splits agree', () => {
  const { metrics } = snapshot();
  const wonTotal = metrics.wonByProductGroup.reduce((total, entry) => total + entry.wonProductArr, 0);
  close(wonTotal, metrics.kpis.currentQuarterWonArr, 'Σ Closed-Won by Product Group = Current Quarter Won ARR');
  assert.deepEqual(metrics.wonByProductGroup.map(entry => [entry.label, entry.opps]), [['Agentic AI', 1], ['Agentic cloud: Hyperexecute', 1]]);

  const byGroup = metrics.openPipeByProductGroup.reduce((total, entry) => total + entry.arr, 0);
  const byProduct = metrics.openPipeByProduct.reduce((total, entry) => total + entry.arr, 0);
  close(byGroup, byProduct, 'Σ Open Pipe by Product = Σ Open Pipe by Product Group');
  close(byGroup, metrics.kpis.openPipelineArr + metrics.openPipeGap, 'both exceed the opp-grain tile by the source gap only');
  assert.deepEqual(metrics.openPipeByProductGroup.map(entry => entry.label), ['Agentic AI', 'Browser And App', 'Others']);
  assert.deepEqual(Object.fromEntries(metrics.openPipeByProduct.map(entry => [entry.label, entry.group])),
    { 'Manual - RD': 'Browser And App', 'Kane CLI': 'Agentic AI', A2A: 'Agentic AI', [OTHER_PRODUCT]: 'Others' });
  assert.deepEqual(metrics.openPipeByProduct.map(entry => [entry.label, entry.arr]),
    [['Manual - RD', 7000], ['Kane CLI', 6000], ['A2A', 5000], [OTHER_PRODUCT, 2400]]);
});

test('closed-won table is one row per opportunity, sorted by Won Deal ARR', () => {
  const { metrics } = snapshot({});
  assert.equal(metrics.closedWonDeals.length, 2);
  assert.deepEqual(metrics.closedWonDeals[0], { id: 'W1', account: 'Acme', name: 'Acme deal', owner: 'Riya', wonDealArr: 12000, pod: 'AMER II', closeDate: '2026-08-01' });
});

test('forecast mix names the blank bucket, keeps the workbook order, and ties to the pipeline tile', () => {
  const { metrics } = snapshot({});
  assert.deepEqual(metrics.forecastMix.map(entry => entry.label), ['Commit', 'Best Case', 'No Projection', NO_FORECAST]);
  const total = metrics.forecastMix.reduce((sum, entry) => sum + entry.arr, 0);
  close(total, metrics.kpis.openPipelineArr, 'Σ Forecast Mix ARR = Open Pipeline tile');
  close(metrics.forecastMix.find(entry => entry.label === 'Commit').arr, metrics.kpis.commitArr, 'Commit slice = Forecast (Commit) tile');
  assert.equal(metrics.forecastMix.find(entry => entry.label === 'No Projection').opps, 1);
});

// ===== Options and blanks =====
test('filter menus describe the whole source; blanks are named buckets', () => {
  const { options } = snapshot();
  assert.deepEqual(options.type, ['New Business', 'New Business AM', 'Renewal']);
  assert.deepEqual(options.pod, ['AM APAC', 'AMER II', 'EMEA AE', NO_POD]);
  assert.deepEqual(options.misRequired, ['No', 'Yes']);
  assert.deepEqual(options.segments.product, ['A2A', 'HyperExecute', 'Kane AI', 'Kane CLI', 'Manual - RD', 'Others', 'Test Manager']);
  assert.deepEqual(options.segments.productGroup, ['Agentic AI', 'Agentic cloud: Hyperexecute', 'Browser And App', 'Others']);
  assert.deepEqual(options.segments.continentGroup, ['APAC', 'EMEA']);
  assert.deepEqual(options.segments.orgType, ['Enterprise', 'Mid-Market']);
  assert.deepEqual(options.segments.salesPod, ['AM-APAC', 'AMER-2', 'EMEA-Sales', 'No Sales POD']);
  assert.deepEqual(options.segments.owner, ['Dev', 'Riya', 'Sam', 'Zed']);
});

test('enrichment reads the raw SKU copy over the renamed product column', () => {
  const enriched = enrichExecutiveRow({ product: 'Kane AI', productRaw: 'Kane AI (Web)' });
  assert.equal(enriched.productGroupValue, 'Agentic AI');
  assert.equal(enriched.productValue, 'Kane AI');
  assert.equal(enrichExecutiveRow({ product: 'Kane AI (Web)' }).productValue, 'Kane AI');
  assert.equal(filterExecutiveRows([enriched], {}).length, 1);
});

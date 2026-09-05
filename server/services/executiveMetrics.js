// Executive Dashboard — a faithful port of the Tableau "Dashboard 11:
// Executive Dashboard" workbook (spec extracted from the published workbook
// on 2026-09-04), computed over the "Opp + Product" source: ONE ROW PER
// OPPORTUNITY × PRODUCT LINE.
//
// Deliberately self-contained (business ruling, 2026-09-05): the product,
// continent, org-type and forecast rules are restated here from the
// executive spec rather than imported from another board's derivations, so
// a change to some other board's mapping can never move an executive number,
// and vice versa.
//
// The grain drives every formula. Opportunity-level values (Amount, ARR,
// quota) repeat on every line of the same opportunity, so they are read ONCE
// per opportunity — MIN over the lines that survive the filters, exactly the
// workbook's {FIXED [Opportunity ID]: MIN(...)} — while product-line values
// (Total Price, Product ARR) are summed row by row. An opportunity, or a
// user's quota, counts iff at least one of its rows survives the active
// filters; that "survival" rule is what makes Target ARR respond to a
// Product segment even though quota is per user.

const trim = value => String(value ?? '').trim();
const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));

// ---- Product Group: TRIM([Product Name]) → family, per the Product Mapping
// sheet (source of truth, 2026-09-05). Anything else → Unmapped.
const GROUP_LISTS = {
  'Agentic AI': [
    'Kane AI (Mobile + Web)', 'Kane AI (Web)', 'Kane AI Web', 'KaneAI Web & App', 'KaneAI Desktop & Mobile Essentials',
    'Kane CLI', 'Kane CLI Pro', 'Kane CLI Starter',
    // Not on the sheet but live in the source; filed with their family by
    // ruling of 2026-09-05 rather than left Unmapped.
    'KaneAI Max', 'KaneAI Desktop Essentials',
    // The source spells this SKU with a DOUBLE space between "Agent" and
    // "to" (verified against the published data, 2026-09-05: it is the only
    // reason the Agentic AI split moved). The spec's transcription put the
    // double space before "Testing"; both spellings are honoured.
    'Agent  to Agent Testing', 'Agent to Agent  Testing', 'Agent to Agent Testing',
    'Test Manager', 'Test Manager Premium', 'Accessibility', 'Accessibility Scheduling', 'Accessibility Automation',
    'Native App Accessibility', 'SmartUI Visual Regression',
  ],
  'Agentic cloud: Hyperexecute': [
    'HyperExecute - Public Cloud', 'HyperExecute - Public Cloud (Linux Only)', 'HyperExecute MultiOS',
    'HyperExecute OnPrem (Including Lums + Oauth)', 'HyperExecute OnPrem (Excluding LUMS + Oauth)', 'HyperExecute On Premise',
    'HyperExecute (Dedicated Account On LT)', 'TestMuOne', 'TestMuOne - Lite', 'LambdaTestOne', 'LambdaTest One Plus', 'LambdaTest One Lite',
    'HyperExecute Private Cloud',   // same ruling as the KaneAI additions above
  ],
  'Browser And App': [
    'Private Real Device Cloud', 'Private Real Device', 'Real Device Live', 'Real Device Plus Live', 'Real Device Automation Cloud',
    'Real Device Plus Automation Cloud', 'Virtual Automation Cloud', 'Virtual Cloud (VMs & Virtual Devices)', 'Virtual Live',
    'Virtual & Real Device Automation Cloud', 'Virtual & Real Device Plus Automation Cloud', 'LambdaTest Virtual Cloud',
    'Native App Automation', 'Native App Automation Plus', 'Native App Automation - Virtual Devices', 'App Automation - Virtual Device',
    'Web Automation on Desktop', 'Web Automation on Desktop - Linux', 'Web & Mobile Browser Automation',
    'Web & Mobile Browser Automation - Real Devices', 'Web & Mobile Browser Automation on Real Devices Plus',
    'Web and Mobile App automation on Virtual Devices', 'Web and App Automation on Virtual Device',
    'Add-on: Real Mobile Device - Automation', 'Add-on: Real Mobile Device - Manual', 'Private Cloud Web Automation Desktop- Dedicated VM',
    'Advanced App Performance Analytics', 'ChromeOS Live', 'Dedicated Proxy', 'Enterprise Plan', 'Enterprise Security', 'SSO Add-On',
    'SSO Support', 'Professional Services',
  ],
  // Per the Product Mapping sheet (2026-09-05): the add-on, infra and
  // compliance SKUs are Others, not Unmapped as the earlier formula had them.
  'Others': ['Others', 'IP Whitelisting', 'Additional Users', 'Test at Scale', 'Test At Scale: Lite',
    'Data Center Region Reservation', 'Data Retention', 'GDPR', 'Unbound', 'Performance Testing - Basic'],
};
export const UNMAPPED_GROUP = 'Unmapped';
export const PRODUCT_GROUP_MAP = Object.fromEntries(
  Object.entries(GROUP_LISTS).flatMap(([group, names]) => names.map(name => [name, group])));
export const productGroupOf = raw => PRODUCT_GROUP_MAP[trim(raw)] ?? UNMAPPED_GROUP;

// ---- Actual Product Name: TRIM([Product Name]) → friendly name. Unlisted → Others
// (sign-off 26 Aug 2026).
const NAME_LISTS = {
  'Kane AI': ['Kane AI (Web)', 'Kane AI (Mobile + Web)', 'Kane AI Web', 'KaneAI Desktop & Mobile Essentials', 'KaneAI Web & App',
    'KaneAI Desktop Essentials', 'KaneAI Max'],
  'Kane CLI': ['Kane CLI', 'Kane CLI Pro', 'Kane CLI Starter'],
  'A2A': ['Agent  to Agent Testing', 'Agent to Agent  Testing', 'Agent to Agent Testing'],
  'HyperExecute': ['HyperExecute MultiOS', 'HyperExecute - Public Cloud', 'HyperExecute - Public Cloud (Linux Only)',
    'HyperExecute (Dedicated Account On LT)', 'HyperExecute On Premise', 'HyperExecute OnPrem (Including Lums + Oauth)',
    'HyperExecute OnPrem (Excluding LUMS + Oauth)', 'HyperExecute Private Cloud', 'TestMuOne', 'TestMuOne - Lite', 'LambdaTestOne',
    'LambdaTest One Plus', 'LambdaTest One Lite'],
  'Automation': ['Web Automation on Desktop', 'Web Automation on Desktop - Linux', 'Web & Mobile Browser Automation',
    'App Automation - Virtual Device', 'Virtual Automation Cloud', 'Native App Automation - Virtual Devices',
    'Web and Mobile App automation on Virtual Devices', 'Private Cloud Web Automation Desktop- Dedicated VM',
    'Web and App Automation on Virtual Device'],
  'Automation - RD': ['Web & Mobile Browser Automation - Real Devices', 'Web & Mobile Browser Automation on Real Devices Plus',
    'Native App Automation', 'Native App Automation Plus', 'Real Device Automation Cloud', 'Real Device Plus Automation Cloud',
    'Virtual & Real Device Automation Cloud', 'Add-on: Real Mobile Device - Automation'],
  'Manual - RD': ['Real Device Live', 'Real Device Plus Live', 'Add-on: Real Mobile Device - Manual'],
  'Virtual Cloud': ['Virtual Cloud (VMs & Virtual Devices)', 'LambdaTest Virtual Cloud', 'Virtual Live',
    'Virtual & Real Device Plus Automation Cloud', 'ChromeOS Live'],
  'Private Devices': ['Private Real Device', 'Private Real Device Cloud'],
  'Accessibility': ['Accessibility', 'Accessibility Scheduling', 'Accessibility Automation', 'Native App Accessibility'],
  'Test Manager': ['Test Manager', 'Test Manager Premium'],
  'Smart UI': ['SmartUI Visual Regression'],
  'PS': ['Professional Services'],
  'Others': ['Others', 'Enterprise Plan', 'Enterprise Security', 'Additional Users', 'IP Whitelisting', 'SSO Support', 'SSO Add-On',
    'Dedicated Proxy', 'Advanced App Performance Analytics', 'Data Center Region Reservation', 'Data Retention', 'GDPR',
    'Performance Testing - Basic', 'Unbound', 'Test at Scale', 'Test At Scale: Lite'],
};
export const OTHER_PRODUCT = 'Others';
export const PRODUCT_NAME_MAP = Object.fromEntries(
  Object.entries(NAME_LISTS).flatMap(([name, skus]) => skus.map(sku => [sku, name])));
export const actualProductNameOf = raw => PRODUCT_NAME_MAP[trim(raw)] ?? OTHER_PRODUCT;

// ---- Continent Group: Acc Continent → APAC / Americas / EMEA. The workbook's
// ELSE branch is the literal string "NULL"; here it is a readable bucket.
export const NO_CONTINENT = 'No Continent';
const CONTINENT_MAP = {
  Asia: 'APAC', Australia: 'APAC', Oceania: 'APAC',
  'North America': 'Americas', 'South America': 'Americas',
  Europe: 'EMEA', Africa: 'EMEA', 'Middle East': 'EMEA',
};
const CONTINENT_BUCKETS = new Set(['APAC', 'Americas', 'EMEA']);
// Accepts a raw continent or an already-rolled-up value: the mapping layer
// may hand over either, and the answer must be the same.
export const continentGroupOf = raw => {
  const value = trim(raw);
  if (CONTINENT_BUCKETS.has(value)) return value;
  return CONTINENT_MAP[value] ?? NO_CONTINENT;
};

// ---- Org Type: IF [Free Domain] THEN SMB ELSEIF [Employees] >= 2000 THEN
// Enterprise ELSEIF >= 100 THEN Mid-Market ELSE SMB. A source that publishes
// the calculated column is the same formula evaluated upstream, so a mapped
// Org Type wins and the raw inputs only fill the gap.
export function orgTypeOf(row) {
  const mapped = trim(row.orgType);
  if (mapped) return mapped;
  if (row.freeDomain === true) return 'SMB';
  const employees = num(row.employees);
  if (Number.isFinite(employees) && employees >= 2000) return 'Enterprise';
  if (Number.isFinite(employees) && employees >= 100) return 'Mid-Market';
  return 'SMB';
}

// ---- Opportunity Forecast (group): Low + No Projection → No Projection,
// Best Case + High → Best Case, Commit stays, blank stays blank (it is the
// absence of a call, shown as its own "No Forecast" bucket, never merged).
export const NO_FORECAST = 'No Forecast';
export const FORECAST_ORDER = ['Commit', 'Best Case', 'No Projection', NO_FORECAST];
export function forecastGroupOf(raw) {
  const value = trim(raw);
  if (!value) return null;
  if (/^(low|no projection)$/i.test(value)) return 'No Projection';
  if (/^(best case|high)$/i.test(value)) return 'Best Case';
  if (/^commit$/i.test(value)) return 'Commit';
  return value;
}

// ---- ARR = [Amount] / [Subscription Duration] * 12 (opportunity level);
// Product ARR = [Total Price] / [Subscription Duration-1] * 12 (line level).
// Null, never 0, when it cannot be computed: a zero would silently deflate a
// total while a null is at least visible as unpriced. A pre-computed mapped
// column is the fallback, not the primary — the formula is the contract.
export function arrOf(row) {
  const amount = num(row.amount), months = num(row.subscriptionDuration);
  if (Number.isFinite(amount) && Number.isFinite(months) && months > 0) return (amount / months) * 12;
  const mapped = num(row.arr);
  return Number.isFinite(mapped) ? mapped : null;
}
export function productArrOf(row) {
  const price = num(row.totalPrice);
  // A source with a single duration column serves both formulas.
  const lineMonths = num(row.lineDuration);
  const months = Number.isFinite(lineMonths) ? lineMonths : num(row.subscriptionDuration);
  if (Number.isFinite(price) && Number.isFinite(months) && months > 0) return (price / months) * 12;
  const mapped = num(row.productArr);
  return Number.isFinite(mapped) ? mapped : null;
}

// ---- Calendar quarters (the KPI tiles are pinned to TODAY's quarter, whatever
// the date filter says — "KPI's data are fixed for this Quarter only").
const pad = value => String(value).padStart(2, '0');
export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export function quarterOf(dateText) {
  const [year, month] = String(dateText ?? '').split('-').map(Number);
  if (!year || !month) return null;
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}
export const quarterLabel = q => (q ? `Q${q.quarter}-${q.year}` : '');
export function quarterRange(q) {
  const firstMonth = (q.quarter - 1) * 3 + 1;
  const lastDay = new Date(q.year, firstMonth + 2, 0).getDate();
  return { from: `${q.year}-${pad(firstMonth)}-01`, to: `${q.year}-${pad(firstMonth + 2)}-${pad(lastDay)}` };
}
const sameQuarter = (a, b) => Boolean(a && b && a.year === b.year && a.quarter === b.quarter);

// ---- Per-row derivations, computed once per snapshot -----------------------
export const NO_POD = 'No POD';
export const NO_SALES_POD = 'No Sales POD';
export const NO_OWNER = 'No Owner';
export const NO_TYPE = 'No Type';
// The mapping layer rewrites `product` to a display name for every source;
// the executive rules key on the RAW SKU, which applyMapping preserves as
// `productRaw` before renaming.
export const rawSkuOf = row => trim(row.productRaw ?? row.product);
export function enrichExecutiveRow(row) {
  const id = trim(row.id);
  const sku = rawSkuOf(row);
  return {
    ...row,
    oppKey: id || null,
    arrValue: arrOf(row),
    productArrValue: productArrOf(row),
    orgTypeValue: orgTypeOf(row),
    continentValue: continentGroupOf(row.continentGroup),
    productGroupValue: productGroupOf(sku),
    productValue: actualProductNameOf(sku),
    forecastGroup: forecastGroupOf(row.opportunityForecast),
    podValue: trim(row.pod) || NO_POD,
    salesPodValue: trim(row.salesPod) || NO_SALES_POD,
    ownerValue: trim(row.owner) || NO_OWNER,
    typeValue: trim(row.type) || NO_TYPE,
    // Quota is one number per USER. User ID is the key the workbook uses; a
    // source without it falls back to the rep's name.
    quotaKey: trim(row.userId) || trim(row.owner) || null,
    // Stage = Trial only — redefined 4 Sep 2026; the old five-stage list is gone.
    isTrial: trim(row.stage) === 'Trial',
  };
}

export const SEGMENT_SELECTORS = [
  { key: 'product', label: 'Product' },
  { key: 'productGroup', label: 'Product Group' },
  { key: 'orgType', label: 'Org Type' },
  { key: 'continentGroup', label: 'Continent Group' },
  { key: 'salesPod', label: 'Sales POD' },
  { key: 'owner', label: 'Rep' },
];
const SEGMENT_FIELD = {
  product: 'productValue', productGroup: 'productGroupValue', orgType: 'orgTypeValue',
  continentGroup: 'continentValue', salesPod: 'salesPodValue', owner: 'ownerValue',
};
export const DEFAULT_SEGMENT_SELECTOR = 'product';
export const segmentSelectorOf = value =>
  (SEGMENT_FIELD[value] ? value : DEFAULT_SEGMENT_SELECTOR);
export const segmentValueOf = (row, selector) => row[SEGMENT_FIELD[segmentSelectorOf(selector)]];

const list = value => (Array.isArray(value) ? value : value ? [value] : []).map(item => trim(item)).filter(Boolean);
const yes = value => /^(true|yes|y|1)$/i.test(trim(value));

// ---- The filter model: exactly the five global controls (plus POD, a
// business ruling of 2026-09-05 in place of the workbook's hard-coded POD
// exclusions). Every measure is then summed over what survives.
export function filterExecutiveRows(rows, query = {}) {
  const from = trim(query.closeFrom) || null, to = trim(query.closeTo) || null;
  const selector = segmentSelectorOf(query.segmentBy);
  const segment = new Set(list(query.segment));
  const types = new Set(list(query.type));
  const pods = new Set(list(query.pod));
  const mis = new Set(list(query.misRequired).map(yes));
  return rows.filter(row => {
    // A relative date filter drops rows with no date, as Tableau does.
    if ((from || to) && !row.closeDate) return false;
    if (from && row.closeDate < from) return false;
    if (to && row.closeDate > to) return false;
    if (types.size && !types.has(row.typeValue)) return false;
    if (pods.size && !pods.has(row.podValue)) return false;
    if (mis.size && !mis.has(Boolean(row.misRequired))) return false;
    if (segment.size && !segment.has(segmentValueOf(row, selector))) return false;
    return true;
  });
}

// ---- Deduped measures ------------------------------------------------------
// MIN(IF cond THEN value END) per opportunity, summed: a line that fails the
// condition contributes NULL, which MIN ignores, so an opportunity counts
// when ANY surviving line satisfies the condition and then counts once.
function sumPerOpportunity(rows, pick) {
  const mins = new Map();
  for (const row of rows) {
    if (!row.oppKey) continue;
    const value = pick(row);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const previous = mins.get(row.oppKey);
    if (previous === undefined || value < previous) mins.set(row.oppKey, value);
  }
  let total = 0;
  for (const value of mins.values()) total += value;
  return total;
}
function countOpportunities(rows, test = () => true) {
  const ids = new Set();
  for (const row of rows) if (row.oppKey && test(row)) ids.add(row.oppKey);
  return ids.size;
}
// SUM({FIXED [User ID]: MIN([Quota])}) over the users present in the rows.
function targetArrOf(rows) {
  const mins = new Map();
  for (const row of rows) {
    if (!row.quotaKey) continue;
    const quota = num(row.quotaCurrent);
    if (!Number.isFinite(quota)) continue;
    const previous = mins.get(row.quotaKey);
    if (previous === undefined || quota < previous) mins.set(row.quotaKey, quota);
  }
  let total = 0;
  for (const value of mins.values()) total += value;
  return total;
}
const sum = (rows, pick) => rows.reduce((total, row) => {
  const value = pick(row);
  return Number.isFinite(value) ? total + value : total;
}, 0);
const ratio = (numerator, denominator) => (denominator ? numerator / denominator : null);
const groupBy = (rows, keyOf) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};
const byValueDesc = key => (a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity) || String(a.label).localeCompare(String(b.label));

// ---- The 18 objects --------------------------------------------------------
export function buildExecutiveMetrics(rows, today = localToday()) {
  const currentQuarter = quarterOf(today);
  const inCurrentQuarter = row => sameQuarter(quarterOf(row.closeDate), currentQuarter);
  const open = rows.filter(row => !row.isClosed);
  const won = rows.filter(row => row.isWon);

  const targetArr = targetArrOf(rows);
  const currentQuarterWonArr = sumPerOpportunity(rows, row => (row.isWon && inCurrentQuarter(row) ? row.arrValue : null));
  // Tiles 2 and 3 carry the sheet-level Closed = false filter.
  const commitArr = sumPerOpportunity(open, row => (row.forecastGroup === 'Commit' && inCurrentQuarter(row) ? row.arrValue : null));
  const openPipelineArr = sumPerOpportunity(open, row => row.arrValue);
  const trialOpps = countOpportunities(rows, row => row.isTrial);
  const trialArr = sumPerOpportunity(rows, row => (row.isTrial ? row.arrValue : null));

  const kpis = {
    quotaAttainment: ratio(currentQuarterWonArr, targetArr),
    currentQuarterWonArr,
    targetArr,
    gapToQuota: targetArr - currentQuarterWonArr,
    commitArr,
    openPipelineArr,
    pipelineCoverage: ratio(openPipelineArr, targetArr),
    trialOpps,
    trialArr,
    trialCoverage: ratio(trialArr, targetArr),
  };

  // 10. Closed-Won by Product Group — product grain, so won product ARR sums
  // lines while the opportunity count is a true COUNTD within each group.
  const wonByProductGroup = [...groupBy(won, row => row.productGroupValue)]
    .map(([label, inGroup]) => ({ label, wonProductArr: sum(inGroup, row => row.productArrValue), opps: countOpportunities(inGroup) }))
    .sort(byValueDesc('wonProductArr'));

  // 11–14. Per POD. Every POD is kept (the global POD filter is the way to
  // hide one); attainment is null, not 0, where a POD carries no quota.
  const pods = groupBy(rows, row => row.podValue);
  const attainmentByPod = [...pods].map(([label, inPod]) => {
    const target = targetArrOf(inPod);
    const wonArr = sumPerOpportunity(inPod, row => (row.isWon && inCurrentQuarter(row) ? row.arrValue : null));
    return { label, targetArr: target, wonArr, attainment: ratio(wonArr, target) };
  }).sort(byValueDesc('attainment'));
  const openPipelineByPod = [...pods].map(([label, inPod]) => {
    const openInPod = inPod.filter(row => !row.isClosed);
    return { label, arr: sumPerOpportunity(openInPod, row => row.arrValue), opps: countOpportunities(openInPod) };
  }).filter(entry => entry.opps > 0).sort(byValueDesc('arr'));
  const forecastByPod = [...pods].map(([label, inPod]) => {
    const openInPod = inPod.filter(row => !row.isClosed);
    const commit = sumPerOpportunity(openInPod, row => (row.forecastGroup === 'Commit' ? row.arrValue : null));
    const bestCase = sumPerOpportunity(openInPod, row => (row.forecastGroup === 'Best Case' ? row.arrValue : null));
    return { label, commit, bestCase, total: commit + bestCase };
  }).filter(entry => entry.total > 0).sort(byValueDesc('total'));
  // Sheet filters Active = true and User Active = true. A source that has
  // not mapped one of those flags coerces it to false on every row, which
  // would empty the chart for a mapping gap rather than a business fact —
  // so each flag is only enforced once the source shows it is really there.
  const oppActiveKnown = rows.some(row => row.oppActive === true);
  const ownerActiveKnown = rows.some(row => row.ownerActive === true);
  const activeRows = rows.filter(row => (!oppActiveKnown || row.oppActive === true) && (!ownerActiveKnown || row.ownerActive === true));
  const trialsByPod = [...groupBy(activeRows, row => row.podValue)].map(([label, inPod]) => ({
    label,
    trialOpps: countOpportunities(inPod, row => row.isTrial),
    trialArr: sumPerOpportunity(inPod, row => (row.isTrial ? row.arrValue : null)),
  })).filter(entry => entry.trialOpps > 0).sort(byValueDesc('trialArr'));

  // 15 / 17. Open pipe at PRODUCT grain — expected to exceed the
  // opportunity-grain tile by the source's own line-vs-amount gap; never
  // forced to match.
  const openPipeByProductGroup = [...groupBy(open, row => row.productGroupValue)]
    .map(([label, inGroup]) => ({ label, arr: sum(inGroup, row => row.productArrValue), opps: countOpportunities(inGroup) }))
    .sort(byValueDesc('arr'));
  // Each product also names its dominant Product Group (by open ARR), so the
  // product list can show where a product sits without a second lookup.
  const openPipeByProduct = [...groupBy(open, row => row.productValue)]
    .map(([label, inGroup]) => {
      const byGroup = new Map();
      for (const row of inGroup) {
        const value = Number.isFinite(row.productArrValue) ? row.productArrValue : 0;
        byGroup.set(row.productGroupValue, (byGroup.get(row.productGroupValue) || 0) + value);
      }
      const group = [...byGroup].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return { label, arr: sum(inGroup, row => row.productArrValue), opps: countOpportunities(inGroup), group };
    })
    .sort(byValueDesc('arr'));
  const openPipeProductGrain = sum(open, row => row.productArrValue);

  // 16. Closed Won deals — one row per opportunity, Won Deal ARR read once.
  const wonDeals = new Map();
  for (const row of won) {
    if (!row.oppKey) continue;
    const existing = wonDeals.get(row.oppKey);
    const arr = Number.isFinite(row.arrValue) ? row.arrValue : null;
    if (!existing) {
      wonDeals.set(row.oppKey, { id: row.oppKey, account: trim(row.account), name: trim(row.name), owner: row.ownerValue,
        wonDealArr: arr, pod: row.podValue, closeDate: row.closeDate || '' });
    } else if (arr !== null && (existing.wonDealArr === null || arr < existing.wonDealArr)) {
      existing.wonDealArr = arr;
    }
  }
  const closedWonDeals = [...wonDeals.values()].sort((a, b) => (b.wonDealArr ?? -Infinity) - (a.wonDealArr ?? -Infinity));

  // 18. Forecast mix over open opportunities; the blank forecast is its own
  // named bucket (205 opps / $2M sat invisibly blank in the workbook).
  const mixGroups = groupBy(open, row => row.forecastGroup ?? NO_FORECAST);
  const forecastMix = [...mixGroups].map(([label, inGroup]) => ({
    label, opps: countOpportunities(inGroup), arr: sumPerOpportunity(inGroup, row => row.arrValue),
  })).sort((a, b) => {
    const ia = FORECAST_ORDER.indexOf(a.label), ib = FORECAST_ORDER.indexOf(b.label);
    return (ia === -1 ? FORECAST_ORDER.length : ia) - (ib === -1 ? FORECAST_ORDER.length : ib) || b.arr - a.arr;
  });

  return {
    quarter: { label: quarterLabel(currentQuarter), ...quarterRange(currentQuarter) },
    counts: {
      opportunities: countOpportunities(rows),
      openOpportunities: countOpportunities(open),
      wonOpportunities: countOpportunities(won),
      users: new Set(rows.map(row => row.quotaKey).filter(Boolean)).size,
    },
    kpis,
    wonByProductGroup,
    attainmentByPod,
    openPipelineByPod,
    forecastByPod,
    trialsByPod,
    trialFilters: { oppActive: oppActiveKnown, ownerActive: ownerActiveKnown },
    openPipeByProductGroup,
    openPipeByProduct,
    openPipeProductGrain,
    openPipeGap: openPipeProductGrain - openPipelineArr,
    closedWonDeals,
    forecastMix,
  };
}

// Filter menus describe the COMPLETE loaded source, so an active filter never
// hides a valid choice from another menu.
export function buildExecutiveOptions(rows) {
  const distinct = pick => [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  return {
    type: distinct(row => row.typeValue),
    pod: distinct(row => row.podValue),
    misRequired: distinct(row => (row.misRequired ? 'Yes' : 'No')),
    segments: Object.fromEntries(SEGMENT_SELECTORS.map(({ key }) => [key, distinct(row => segmentValueOf(row, key))])),
  };
}

export function buildExecutiveSnapshot(allRows, query = {}, today = localToday()) {
  const enriched = (allRows || []).map(enrichExecutiveRow);
  const rows = filterExecutiveRows(enriched, query);
  return {
    today,
    segmentBy: segmentSelectorOf(query.segmentBy),
    sourceRowCount: enriched.length,
    rowCount: rows.length,
    options: buildExecutiveOptions(enriched),
    metrics: buildExecutiveMetrics(rows, today),
  };
}

// The Product View's derived fields, computed IN THE APP from the raw
// columns the product source actually carries. The business rules were
// supplied as Tableau formulas (recorded verbatim in calculated.md at the
// repo root) but live here as code: Tableau ad-hoc groups and worksheet
// calculations do not travel through the published data source, and keeping
// the rules in the app means the source only needs its raw columns.
//
// applyMapping (datasources.js) calls these as gap-fills: a real mapped
// column always wins, derivation only fills what the mapping left empty.

// ---- Actual Product Name: raw [Product Name] SKU → display name ----------
// One deliberate deviation from the Tableau formula: its ELSE branch blanks
// unknown SKUs, which makes a new SKU silently vanish from every per-product
// split. Here an unknown SKU keeps its raw name instead — visible, filterable
// and obviously un-renamed, which is the signal this map needs a new entry.
export const PRODUCT_NAME_MAP = {
  'Virtual Cloud (VMs & Virtual Devices)': 'Virtual Cloud',
  'Private Real Device Cloud': 'Private Devices',
  'Test Manager': 'Test Manager',
  'HyperExecute MultiOS': 'HyperExecute',
  'Private Real Device': 'Private Devices',
  'SmartUI Visual Regression': 'Smart UI',
  'Accessibility': 'Accessibility',
  'Accessibility Scheduling': 'Accessibility',
  'Accessibility Automation': 'Accessibility',
  'Test Manager Premium': 'Test Manager',
  'Kane AI (Web)': 'Kane AI',
  'Others': 'Others',
  'TestMuOne': 'HyperExecute',
  'Web Automation on Desktop': 'Automation',
  'Web & Mobile Browser Automation - Real Devices': 'Automation - RD',
  'App Automation - Virtual Device': 'Automation',
  'Kane AI (Mobile + Web)': 'Kane AI',
  'Enterprise Plan': 'Others',
  'Virtual Automation Cloud': 'Automation',
  'Native App Automation': 'Automation - RD',
  'Web & Mobile Browser Automation': 'Automation',
  'Real Device Live': 'Manual - RD',
  'HyperExecute - Public Cloud': 'HyperExecute',
  'Real Device Plus Automation Cloud': 'Automation - RD',
  'Web & Mobile Browser Automation on Real Devices Plus': 'Automation - RD',
  'Kane AI Web': 'Kane AI',
  'Additional Users': 'Others',
  'LambdaTest Virtual Cloud': 'Virtual Cloud',
  'Real Device Automation Cloud': 'Automation - RD',
  'Real Device Plus Live': 'Manual - RD',
  'Virtual & Real Device Automation Cloud': 'Automation - RD',
  'HyperExecute OnPrem (Including Lums + Oauth)': 'HyperExecute',
  'Virtual Live': 'Virtual Cloud',
  'Kane CLI': 'Kane CLI',
  'Agent to Agent Testing': 'A2A',
  'IP Whitelisting': 'Others',
  'SSO Support': 'Others',
  'Dedicated Proxy': 'Others',
  'HyperExecute OnPrem (Excluding LUMS + Oauth)': 'HyperExecute',
  'LambdaTestOne': 'HyperExecute',
  'HyperExecute (Dedicated Account On LT)': 'HyperExecute',
  'HyperExecute On Premise': 'HyperExecute',
  'LambdaTest One Plus': 'HyperExecute',
  'Native App Automation - Virtual Devices': 'Automation',
  'Professional Services': 'PS',
  'HyperExecute - Public Cloud (Linux Only)': 'HyperExecute',
  'TestMuOne - Lite': 'HyperExecute',
  'Native App Automation Plus': 'Automation - RD',
  'Add-on: Real Mobile Device - Automation': 'Automation - RD',
  'Add-on: Real Mobile Device - Manual': 'Manual - RD',
  'KaneAI Desktop & Mobile Essentials': 'Kane AI',
  'KaneAI Web & App': 'Kane AI',
  'Native App Accessibility': 'Accessibility',
  'SSO Add-On': 'Others',
  'Web and Mobile App automation on Virtual Devices': 'Automation',
  'LambdaTest One Lite': 'HyperExecute',
  'Kane CLI Pro': 'Kane CLI',
  'Web Automation on Desktop - Linux': 'Automation',
  'Advanced App Performance Analytics': 'Others',
  'Private Cloud Web Automation Desktop- Dedicated VM': 'Automation',
  'Enterprise Security': 'Others',
  'Virtual & Real Device Plus Automation Cloud': 'Virtual Cloud',
  'ChromeOS Live': 'Virtual Cloud',
  'Kane CLI Starter': 'Kane CLI',
};
export const actualProductName = raw => PRODUCT_NAME_MAP[raw] ?? raw;

// ---- Product Group: raw [Product Name] SKU → family ----------------------
// ELSE → "Others", exactly as the Tableau formula: an unrecognised SKU lands
// in Others, so Others growing unexpectedly means a new SKU needs sorting.
const GROUP_AGENTIC_AI = [
  'Kane AI (Mobile + Web)', 'Agent to Agent Testing', 'Test Manager', 'Accessibility Scheduling',
  'SmartUI Visual Regression', 'Kane AI (Web)', 'Test Manager Premium', 'Accessibility',
  'Accessibility Automation', 'Kane AI Web', 'Native App Accessibility', 'KaneAI Web & App',
  'KaneAI Desktop & Mobile Essentials', 'Kane CLI', 'Kane CLI Pro', 'Kane CLI Starter',
];
const GROUP_HYPEREXECUTE = [
  'HyperExecute - Public Cloud (Linux Only)', 'HyperExecute MultiOS', 'HyperExecute - Public Cloud',
  'TestMuOne', 'LambdaTestOne', 'LambdaTest One Plus', 'LambdaTest One Lite',
  'HyperExecute OnPrem (Including Lums + Oauth)', 'HyperExecute OnPrem (Excluding LUMS + Oauth)',
  'HyperExecute On Premise', 'TestMuOne - Lite', 'HyperExecute (Dedicated Account On LT)',
];
const GROUP_BROWSER_AND_APP = [
  'Private Real Device Cloud', 'Private Real Device', 'Native App Automation Plus', 'Professional Services',
  'Virtual Automation Cloud', 'Real Device Plus Automation Cloud', 'Web Automation on Desktop',
  'Real Device Plus Live', 'Virtual Cloud (VMs & Virtual Devices)', 'Dedicated Proxy', 'Native App Automation',
  'Real Device Live', 'Virtual Live', 'Web & Mobile Browser Automation - Real Devices', 'SSO Add-On',
  'Enterprise Plan', 'Real Device Automation Cloud', 'Virtual & Real Device Automation Cloud',
  'Web & Mobile Browser Automation', 'SSO Support', 'Advanced App Performance Analytics',
  'Web & Mobile Browser Automation on Real Devices Plus', 'Native App Automation - Virtual Devices',
  'Enterprise Security', 'LambdaTest Virtual Cloud', 'App Automation - Virtual Device',
  'Web Automation on Desktop - Linux', 'ChromeOS Live', 'Add-on: Real Mobile Device - Automation',
  'Add-on: Real Mobile Device - Manual', 'Web and Mobile App automation on Virtual Devices',
  'Virtual & Real Device Plus Automation Cloud', 'Private Cloud Web Automation Desktop- Dedicated VM',
  'Web and App Automation on Virtual Device',
];
export const PRODUCT_GROUP_MAP = Object.fromEntries([
  ...GROUP_AGENTIC_AI.map(name => [name, 'Agentic AI']),
  ...GROUP_HYPEREXECUTE.map(name => [name, 'Agentic cloud: Hyperexecute']),
  ...GROUP_BROWSER_AND_APP.map(name => [name, 'Browser And App']),
  // The formula's explicit Others list — same outcome as its ELSE branch,
  // kept so the named SKUs stay searchable in this file.
  ...['Others', 'IP Whitelisting', 'Additional Users', 'Test at Scale', 'Test At Scale: Lite',
    'Data Center Region Reservation', 'Data Retention', 'GDPR', 'Unbound', 'Performance Testing - Basic',
  ].map(name => [name, 'Others']),
]);
export const productGroupFor = raw => (raw ? (PRODUCT_GROUP_MAP[raw] ?? 'Others') : '');

// ---- Continent Group: raw [Acc Continent] → APAC / Americas / EMEA -------
const CONTINENT_MAP = {
  Asia: 'APAC', Australia: 'APAC', Oceania: 'APAC',
  'North America': 'Americas', 'South America': 'Americas',
  Europe: 'EMEA', Africa: 'EMEA', 'Middle East': 'EMEA',
};
const CONTINENT_BUCKETS = new Set(['APAC', 'Americas', 'EMEA']);
// Accepts either the raw continent or an already-rolled-up value, so a source
// that publishes the grouped column keeps working. Unknowns blank out, per
// the formula's ELSE — geography, unlike products, has a closed value list.
export const continentGroupFor = raw =>
  CONTINENT_BUCKETS.has(raw) ? raw : (CONTINENT_MAP[raw] ?? '');

// ---- Product ARR: (TotalPrice / Subscription Duration) * 12 --------------
// Null, not 0, when it cannot be computed: a zero would silently deflate
// averages while a null row is at least visible as unpriced.
export function productArrFrom(totalPrice, subscriptionDuration) {
  // Number(null) is 0, which would turn a missing price into a real $0 ARR —
  // blanks must stay blanks.
  const num = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const price = num(totalPrice), months = num(subscriptionDuration);
  if (!Number.isFinite(price) || !Number.isFinite(months) || months <= 0) return null;
  return (price / months) * 12;
}

// ---- Org Type: Free Domain / Employees bands -----------------------------
// Same rule the Opportunity source computes in Tableau (see the orgType
// schema formula); recomputed here for sources that ship the raw inputs.
export function orgTypeFrom(freeDomain, employees) {
  if (freeDomain) return 'SMB';
  const count = Number(employees);
  if (Number.isFinite(count) && count >= 2000) return 'Enterprise';
  if (Number.isFinite(count) && count >= 100) return 'Mid-Market';
  return 'SMB';
}

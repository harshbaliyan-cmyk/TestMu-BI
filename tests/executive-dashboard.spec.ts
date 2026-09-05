import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
test.use({ viewport: { width: 1920, height: 1080 } });

// The Executive Dashboard over the "Opp + Product" grain: one CSV row per
// opportunity × product line, RAW columns named exactly as the published
// source. Opportunity values (Amount, quota) repeat per line and must be
// read once; product values (Total Price) sum per line.
//   W1  won this quarter   Amount 12,000 / 12 → ARR 12,000; lines 8,000 + 4,000   Riya (quota 100k, AMER II)  MIS
//   W2  won LAST quarter   ARR 12,000                                             Dev  (quota 50k, EMEA AE)
//   O1  open Trial         ARR 12,000; lines 6,000 + 7,000 (a +1,000 source gap) Riya  High → Best Case
//   O2  open Negotiation   ARR 5,000  (A2A, double space in the SKU)             Dev   Commit
//   O3  open Trial         ARR 2,400  (GDPR → Unmapped / Others), opp INACTIVE   Sam  (no quota, AM APAC)  New Business AM
//   O4  open Proposal      ARR 9,000  type Renewal → out by the default type filter  Zed (quota 20k, blank POD)
//   L1  lost this quarter  ARR 3,000                                              Riya
test('executive dashboard: quota survival, pinned-quarter tiles, product grain, five controls + POD', async ({ page }) => {
  test.setTimeout(240000);
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const now = new Date();
  const year = now.getFullYear();
  const quarterIndex = Math.floor(now.getMonth() / 3);
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstMonth = quarterIndex * 3 + 1;
  const inQuarter = (monthOffset: number, day: number) => `${year}-${pad(firstMonth + monthOffset)}-${pad(day)}`;
  const lastQuarter = quarterIndex === 0 ? `${year - 1}-11-15` : `${year}-${pad(firstMonth - 2)}-15`;
  const quarterLabel = `Q${quarterIndex + 1}-${year}`;
  const quotaHeader = `${quarterLabel} Quota`;

  const header = ['Opportunity ID', 'Name', 'Opportunity Type', 'Stage', 'Closed', 'Won', 'Active', 'Opportunity Forecast', 'Amount',
    'Subscription Duration', 'Opp Close Date', 'Opp Created Date', 'MIS Required', 'Product Name', 'Total Price', 'Subscription Duration-1',
    'Account Name', 'User ID', 'Full Name', 'User Active', 'POD', quotaHeader, 'Sales POD', 'Employees', 'Free Domain', 'Acc Continent'].join(',');
  const riya = 'U1,Riya,true,AMER II,100000,AMER-2,5000,false,Europe';
  const dev = 'U2,Dev,true,EMEA AE,50000,EMEA-Sales,300,false,Europe';
  const rows = [
    `W1,Acme deal,New Business,Closed Won,true,true,true,Commit,12000,12,${inQuarter(0, 10)},${lastQuarter},true,Kane AI (Web),8000,12,Acme,${riya}`,
    `W1,Acme deal,New Business,Closed Won,true,true,true,Commit,12000,12,${inQuarter(0, 10)},${lastQuarter},true,HyperExecute MultiOS,4000,12,Acme,${riya}`,
    `W2,Beta renewal,New Business,Closed Won,true,true,true,,24000,24,${lastQuarter},${lastQuarter},false,Test Manager,24000,24,Beta,${dev}`,
    `O1,Gamma trial,New Business,Trial,false,false,true,High,6000,6,${inQuarter(1, 20)},${inQuarter(0, 1)},false,Kane CLI,3000,6,Gamma,U1,Riya,true,AMER II,100000,AMER-2,150,false,Asia`,
    `O1,Gamma trial,New Business,Trial,false,false,true,High,6000,6,${inQuarter(1, 20)},${inQuarter(0, 1)},false,Real Device Live,3500,6,Gamma,U1,Riya,true,AMER II,100000,AMER-2,150,false,Asia`,
    `O2,Delta,New Business,Negotiation,false,false,true,Commit,5000,12,${inQuarter(1, 25)},${inQuarter(0, 1)},false,Agent to Agent  Testing,5000,12,Delta,${dev}`,
    `O3,Epsilon,New Business AM,Trial,false,false,false,,2400,12,${inQuarter(0, 15)},${inQuarter(0, 1)},false,GDPR,2400,12,Epsilon,U3,Sam,true,AM APAC,,AM-APAC,50,true,Australia`,
    `O4,Zeta,Renewal,Proposal,false,false,true,Low,9000,12,${inQuarter(1, 5)},${inQuarter(0, 1)},false,Kane AI (Web),9000,12,Zeta,U4,Zed,false,,20000,,10,false,North America`,
    `L1,Eta,New Business,Closed Lost,true,false,true,,3000,12,${inQuarter(0, 20)},${lastQuarter},false,Others,3000,12,Eta,${riya}`,
  ];
  const preview = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'executive-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) } },
  })).json();
  // The auto-map must tell the two Active flags, the two durations and the
  // two POD columns apart on this source.
  const auto = preview.fieldMapping || preview.mapping || {};
  expect(auto.ownerActive).toBe('User Active');
  expect(auto.oppActive).toBe('Active');
  expect(auto.subscriptionDuration).toBe('Subscription Duration');
  expect(auto.lineDuration).toBe('Subscription Duration-1');
  expect(auto.pod).toBe('POD');
  expect(auto.salesPod).toBe('Sales POD');
  expect(auto.owner).toBe('Full Name');
  expect(auto.userId).toBe('User ID');
  expect(auto.product).toBe('Product Name');
  expect(auto.misRequired).toBe('MIS Required');
  // Quota is manual-only by design.
  const fieldMapping = { ...auto, quotaCurrent: quotaHeader };
  const commit = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId: preview.stagingId, templateIds: ['executive-dashboard'], fieldMapping },
  })).json();
  expect(commit.ok).toBeTruthy();

  try {
    await page.goto(BASE + '/dashboard/executive-dashboard');
    // The first visit after a dev-server boot compiles the page and Chart.js on demand.
    await expect(page.locator('h1')).toHaveText('Executive Dashboard', { timeout: 30000 });
    await page.getByRole('button', { name: 'Reset' }).click();
    const tile = (label: string) => page.locator('.kpi', { has: page.locator('.lb', { hasText: new RegExp(`^${label.replace(/[$()]/g, '\\$&')}$`) }) });
    const card = (title: string) => page.locator('.card', { has: page.locator('h3', { hasText: title }) });

    // Default: whole current quarter by close date, the new-business trio.
    // Target ARR = quota of the users PRESENT: Riya 100k + Dev 50k (Sam has
    // none; Zed's only deal is a Renewal, filtered out, so his 20k is out).
    await expect(tile('Quota vs Achievement')).toContainText('8.0%', { timeout: 20000 });
    await expect(tile('Quota vs Achievement')).toContainText('$12.0K / $150.0K');
    await expect(tile('Forecast (Commit)')).toContainText('$5.0K');
    await expect(tile('Open Pipeline')).toContainText('$19.4K');
    await expect(tile('Coverage')).toContainText('0.1');
    await expect(tile('Active Trials #')).toContainText('2');
    await expect(tile('ARR in Trials $')).toContainText('$14.4K');
    await expect(tile('Trial Coverage')).toContainText('0.1 X');
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$150.0K');
    await expect(tile('Gap to Quota')).toContainText('$138.0K');
    await expect(page.locator('.exec-note')).toContainText(`fixed to ${quarterLabel}`);

    // Product grain: W1's two lines split across two groups, one opp each.
    await expect(card('Won ARR by product group')).toContainText('Agentic AI');
    await expect(card('Won ARR by product group')).toContainText('$8.0K');
    await expect(card('Won ARR by product group')).toContainText('1 opps');
    await expect(card('Open pipe by product group')).toContainText('$1.0K above');
    await expect(card('Forecast mix')).toContainText('No Forecast');
    await expect(card('Forecast mix')).toContainText('$2.4K');
    await expect(card('Closed-won deals')).toContainText('Acme');
    await expect(card('Closed-won deals')).not.toContainText('Beta');
    await expect(card('Closed-won deals')).toContainText('1 of 1 deals');
    await page.locator('.exec-search').fill('nothing-like-this');
    await expect(card('Closed-won deals')).toContainText('No closed-won opportunity matches that search.');
    await page.locator('.exec-search').fill('');

    // Opportunity Type: adding Renewal alone does NOT bring Zed in — his blank
    // POD sits outside the default POD set — ticking "No POD" as well does.
    await page.locator('.ms-trigger', { hasText: 'Opp type' }).click();
    await page.locator('.ms-menu .ms-option', { hasText: 'Renewal' }).click();
    await page.locator('h1').click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$150.0K', { timeout: 15000 });
    await page.locator('.ms-trigger', { hasText: 'POD' }).first().click();
    await page.locator('.ms-menu .ms-option', { hasText: 'No POD' }).click();
    await page.locator('h1').click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$170.0K', { timeout: 15000 });
    await expect(tile('Open Pipeline')).toContainText('$28.4K');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$150.0K', { timeout: 15000 });

    // Segment selector → Rep → Dev: only Dev's rows survive, so only his quota.
    await page.locator('#exec-segment-by-shelf').selectOption('owner');
    await page.locator('.ms-trigger', { hasText: 'Segment' }).first().click();
    await page.locator('.ms-menu .ms-option', { hasText: 'Dev' }).click();
    await page.locator('h1').click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$50.0K', { timeout: 15000 });
    await expect(tile('Open Pipeline')).toContainText('$5.0K');
    await expect(tile('Forecast (Commit)')).toContainText('$5.0K');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$150.0K', { timeout: 15000 });

    // POD is a global filter (no hard-coded exclusions) — set here through the
    // floating panel, which carries the same controls as the shelf.
    await page.getByRole('button', { name: 'Open Executive Dashboard filters' }).click();
    const panel = page.locator('.floating-filter-panel');
    await expect(panel).toContainText('opportunities in scope');
    await expect(page.locator('.floating-filter-badge')).toHaveCount(0);   // the default POD set is not a narrowing
    await panel.locator('.ms-trigger', { hasText: 'POD' }).click();
    await page.locator('.ms-menu .ms-option', { hasText: 'AMER II' }).click();
    await page.locator('.ms-menu .ms-option', { hasText: 'AM APAC' }).click();
    await panel.locator('.floating-filter-head').click();
    await expect(tile(`${quarterLabel} Quota`)).toContainText('$50.0K', { timeout: 15000 });
    await expect(page.locator('.floating-filter-badge')).toHaveText('1');
    await panel.getByRole('button', { name: 'Reset all filters' }).click();
    await page.getByRole('button', { name: 'Close filters' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('.floating-filter-badge')).toHaveCount(0);

    // Clearing the date filter widens the closed-won table to last quarter's
    // deal, but the tiles stay pinned to TODAY's quarter.
    await page.locator('.advanced-date-trigger').click();
    await page.getByRole('button', { name: 'Clear date filter' }).click();
    await expect(card('Closed-won deals')).toContainText('Beta', { timeout: 15000 });
    await expect(tile('Quota vs Achievement')).toContainText('$12.0K / $150.0K');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(card('Closed-won deals')).not.toContainText('Beta', { timeout: 15000 });
  } finally {
    await page.request.delete(`${BASE}/api/datasources/${commit.sourceId}`);
  }
  console.log('console errors:', consoleErrors);
  expect(consoleErrors).toEqual([]);
});

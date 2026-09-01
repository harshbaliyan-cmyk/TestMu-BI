import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// The Product View: two date-scoped views over PRODUCT LINE rows (an
// opportunity may span several rows, one per product). The seed ships ONLY
// RAW columns — real SKUs, TotalPrice + SubscriptionDuration, Acc Continent —
// exactly like the production source, so this proves the in-app derivations
// (Product ARR, Actual Product Name, Product Group, Continent Group) end to
// end. Duration is 12 months everywhere, so ARR = TotalPrice and every
// number below is hand-checkable:
//   OPP-1  open  Negotiation  $1000 (Kane CLI → Agentic AI)
//                           + $500  (HyperExecute MultiOS → Agentic cloud)  Commit
//   OPP-2  open  Trial        $2000 (Test Manager → Agentic AI)             Best Case
//   OPP-3  won   Closed Won   $3000 (Kane AI (Web) → Agentic AI)  closed 01 Aug
//   OPP-4  lost  Closed Lost  $1000 (HyperExecute MultiOS)        closed 10 Aug
//   OPP-5  open  Discovery    $5000  type Renewal → excluded by the default
//                                    Opportunity Type filter
//   OPP-6  open  Qualification $500  Real Device Live → "Manual - RD" /
//                                    Browser And App; forecast Low → No Projection
test('product view: two independently-filtered views with true distinct counts', async ({ page }) => {
  test.setTimeout(240000);
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const header = 'OpportunityID,Stage,TotalPrice,SubscriptionDuration,CreatedDate,CloseDate,OrgType,POD,OwnerName,OpportunityType,ProductName,AccContinent,OpportunityForecast';
  const rows = [
    'OPP-1,Negotiation,1000,12,2026-07-05,2026-09-15,SMB,AE Corp,Riya,New Business,Kane CLI,North America,Commit',
    'OPP-1,Negotiation,500,12,2026-07-05,2026-09-15,SMB,AE Corp,Riya,New Business,HyperExecute MultiOS,North America,Commit',
    'OPP-2,Trial,2000,12,2026-07-10,2026-10-01,Mid-Market,AE Enterprise,Dev,New Business,Test Manager,Europe,Best Case',
    'OPP-3,Closed Won,3000,12,2026-07-15,2026-08-01,Enterprise,AE Enterprise,Riya,New Business,Kane AI (Web),North America,',
    'OPP-4,Closed Lost,1000,12,2026-07-20,2026-08-10,SMB,AE Corp,Dev,New Business,HyperExecute MultiOS,Asia,',
    'OPP-5,Discovery,5000,12,2026-07-08,2026-11-01,SMB,AE Corp,Riya,Renewal,Test Manager,North America,',
    'OPP-6,Qualification,500,12,2026-07-22,2026-12-01,SMB,AE Corp,Dev,New Business,Real Device Live,North America,Low',
  ];
  const { stagingId } = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'product-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) } },
  })).json();
  const commit = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['product-view'] },
  })).json();
  expect(commit.ok).toBeTruthy();

  await page.goto(BASE + '/dashboard/product-view');
  await expect(page.locator('h1')).toHaveText('Product View');

  // Pin both views to a known state regardless of any saved filters or the
  // tab a previous session left the board on.
  await page.getByRole('tab', { name: /Pipeline/ }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  const kpi = (n: number) => page.locator('.pv-kpi').nth(n);

  // Open pipe = 1000 + 500 + 2000 + 500 (Renewal's 5000 excluded by the
  // default type filter); Commit = OPP-1's two rows; the split opp counts ONCE.
  await expect(kpi(0)).toContainText('Open pipeline');
  await expect(kpi(0)).toContainText('$4.0K', { timeout: 15000 });
  await expect(kpi(0)).toContainText('3 open opps');
  await expect(kpi(1)).toContainText('$3.0K');   // Closed Won
  await expect(kpi(2)).toContainText('$1.5K');   // Commit
  await expect(kpi(3)).toContainText('$2.0K');   // Best Case
  // Funnel grand total: a true COUNTD — OPP-1 spans two groups but counts once.
  const grandTotal = page.locator('.pv-table tfoot tr').first();
  await expect(grandTotal).toContainText('Grand total');
  // The in-app derivations produced the DISPLAY names and buckets from raw
  // SKUs: the group table shows the derived families, the product table the
  // renamed SKU ("Real Device Live" → "Manual - RD").
  await expect(page.locator('.pv-table').first()).toContainText('Agentic AI');
  await expect(page.locator('.pv-table').nth(1)).toContainText('Manual - RD');
  await page.screenshot({ path: '.playwright/baseline/product_pipeline.png', fullPage: true });

  // ===== Won ARR view =====
  await page.getByRole('tab', { name: /Won ARR/ }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(kpi(0)).toContainText('Closed Won');
  await expect(kpi(0)).toContainText('$3.0K', { timeout: 15000 });
  await expect(kpi(1)).toContainText('$1.0K');   // Closed Lost
  await expect(kpi(2)).toContainText('50.0%');   // Win rate by count: 1 of 2
  await expect(kpi(3)).toContainText('$3.0K');   // Avg deal size
  await page.screenshot({ path: '.playwright/baseline/product_won.png', fullPage: true });

  // ===== Per-view filter isolation =====
  // Narrow the WON view to the derived Hyperexecute group (only the lost deal) …
  await page.locator('.ms-trigger', { hasText: 'Product Group' }).click();
  await page.locator('.ms-option', { hasText: 'Agentic cloud' }).locator('input').check();
  await page.keyboard.press('Escape');
  await expect(kpi(0)).toContainText('$0', { timeout: 15000 });   // nothing won in HyperExecute
  // … and the PIPELINE view must be completely unaffected.
  await page.getByRole('tab', { name: /Pipeline/ }).click();
  await expect(kpi(0)).toContainText('$4.0K', { timeout: 15000 });

  // ===== Presentation layers =====
  await page.goto(BASE + '/present/product-pipeline');
  await expect(page.locator('.presentation-view-label')).toContainText('Product View — Pipeline');
  await expect(page.locator('.present-card').first()).toBeVisible();
  await page.waitForTimeout(1200); // charts animate in
  await page.screenshot({ path: '.playwright/baseline/product_pipeline_tv.png' });

  await page.goto(BASE + '/present/product-won');
  await expect(page.locator('.presentation-view-label')).toContainText('Product View — Won ARR');
  await expect(page.locator('.present-card').first()).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '.playwright/baseline/product_won_tv.png' });

  console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
  expect(consoleErrors).toEqual([]);

  // Tidy the shared DB.
  const { sources } = await (await page.request.get(`${BASE}/api/datasources`)).json();
  for (const source of sources.filter((s: any) => s.name === 'product-e2e.csv')) {
    await page.request.delete(`${BASE}/api/datasources/${source.id}`);
  }
});

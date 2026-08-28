import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
test.use({ viewport: { width: 1920, height: 1080 } });

// Exploratory sweep: walk the interactive surfaces the feature suites skip,
// collecting every console error and uncaught exception per step.
test('exploratory: tabs, builder types, controls, themes', async ({ page }) => {
  test.setTimeout(360000);
  const problems: { step: string; message: string }[] = [];
  let step = 'setup';
  page.on('console', m => { if (m.type() === 'error') problems.push({ step, message: m.text().slice(0, 300) }); });
  page.on('pageerror', error => problems.push({ step, message: `PAGEERROR: ${String(error).slice(0, 300)}` }));

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  // Seed all boards.
  const rows = Array.from({ length: 80 }, (_, i) => ({
    id: `HUNT-${i}`, name: `Deal ${i}`, account: `Acct ${i % 20}`, accountId: `A${i % 20}`,
    owner: ['Rep A', 'Rep B', 'Rep C'][i % 3], ownerRole: 'Enterprise Account Executive',
    stage: ['Qualification', 'Trial', 'Proposal', 'Closed Won', 'Closed Lost'][i % 5],
    amount: 5000 + i * 200, arr: 4000 + i * 150,
    closeDate: i % 5 > 2 ? `2026-0${(i % 6) + 1}-15` : '', createdDate: `2026-0${(i % 6) + 1}-01`,
    isClosed: i % 5 > 2, isWon: i % 5 === 3,
    orgType: ['SMB', 'Mid-Market', 'Enterprise'][i % 3], region: ['AMER', 'EMEA', 'APAC'][i % 3],
    pod: ['AE Corp', 'AE Enterprise', 'AM'][i % 3], team: ['Falcon', 'Orion'][i % 2],
    industry: ['SaaS', 'Fintech', 'Retail'][i % 3], product: 'Web;Realtime', source: 'Inbound',
    type: 'New Business', ownerActive: true, daysStuck: i % 60, dealHealth: ['Green', 'Amber', 'Red'][i % 3],
    forecastCategory: ['Pipeline', 'Commit'][i % 2], lossReason: i % 5 === 4 ? 'Price' : '',
    quotaCurrent: 250000, trialStageAt: i % 4 === 0 ? '2026-03-01' : null,
  }));
  for (const key of ['opportunity-analytics', 'win-board', 'loss-board', 'ae-performance', 'am-performance']) {
    expect((await page.request.post(`${BASE}/api/data/${key}/load`, { data: rows })).ok()).toBeTruthy();
  }

  // 1. Every Opportunity Analytics tab.
  step = 'dashboard tabs';
  await page.goto(`${BASE}/dashboard/opportunity-analytics`, { waitUntil: 'networkidle' });
  for (const tab of ['Pulse', 'Diagnostics', 'Velocity', 'Where We Win', 'Rep Performance', 'Accounts']) {
    // Tab buttons carry a numbered prefix ("1 Pulse"), so match loosely.
    await page.getByRole('button', { name: new RegExp(tab) }).first().click({ timeout: 5000 }).catch(() => {
      problems.push({ step, message: `tab button not found: ${tab}` });
    });
    await page.waitForTimeout(700);
  }

  // 2. Theme toggle both ways on the win board.
  step = 'theme toggle';
  await page.goto(`${BASE}/dashboard/win-board`, { waitUntil: 'networkidle' });
  await page.locator('.theme-toggle, [class*=theme]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('.theme-toggle, [class*=theme]').first().click().catch(() => {});
  await page.waitForTimeout(400);

  // 3. Generic presentation controls: next/prev/pause.
  step = 'presentation controls';
  await page.goto(`${BASE}/present/opportunity-analytics`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Next slide' }).click();
  await page.getByRole('button', { name: 'Previous slide' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);

  // 4. Builder: every chart type and display option against a fresh CSV.
  step = 'builder all types';
  const lines = ['Region,Revenue,Signed On,Active,Owner'];
  for (let i = 0; i < 30; i++) lines.push(`${['AMER', 'EMEA', 'APAC'][i % 3]},${1000 + i * 90},2026-0${(i % 6) + 1}-11,${i % 2 ? 'yes' : 'no'},Owner ${i % 6}`);
  const { stagingId } = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'hunt.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) } },
  })).json();
  const { sourceId } = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['opportunity-analytics'] },
  })).json();
  await page.goto(`${BASE}/charts/new?source=${sourceId}`, { waitUntil: 'networkidle' });
  for (const type of ['Bar chart', 'Time series', 'Donut', 'KPI tile', 'Scatter', 'Table']) {
    step = `builder type: ${type}`;
    const card = page.locator('.builder-type', { hasText: type });
    if (await card.evaluate(el => el.classList.contains('is-unavailable')).catch(() => true)) {
      // Greyed out with a reason is correct behaviour for datasets that
      // cannot satisfy the type (e.g. scatter needs two number columns).
      console.log(`${type}: unavailable (${await card.locator('span').innerText().catch(() => '?')})`);
      continue;
    }
    await card.click();
    await page.waitForTimeout(900);
    const previewBroken = await page.locator('.builder-preview .builder-chart-empty[style*="red"], .builder-preview [style*="--red"]').count();
    if (previewBroken) problems.push({ step, message: `preview error: ${await page.locator('.builder-preview .builder-chart-empty').innerText().catch(() => '?')}` });
  }
  step = 'builder display options';
  await page.locator('.builder-type', { hasText: 'Bar chart' }).click();
  await page.waitForTimeout(600);
  await page.locator('.builder-slot', { hasText: 'Split by' }).locator('select').selectOption({ label: 'Active · boolean' });
  await page.waitForTimeout(600);
  for (const box of ['Horizontal bars', 'Stack the series', 'Values on the marks']) {
    const check = page.locator('.builder-check', { hasText: box }).locator('input');
    if (await check.count()) { await check.check(); await page.waitForTimeout(500); }
    else problems.push({ step, message: `missing option: ${box}` });
  }
  for (const fmt of ['currency', 'percent', 'number']) {
    await page.locator('.builder-slot', { hasText: 'Value format' }).locator('select').selectOption(fmt);
    await page.waitForTimeout(400);
  }
  await page.locator('.builder-slot', { hasText: 'Sort' }).locator('select').selectOption('label');
  await page.waitForTimeout(500);

  // 5. Custom dashboard add/remove via edit mode.
  step = 'dashboard edit ops';
  await page.getByPlaceholder('e.g. ARR by region').fill('Hunt chart');
  await page.getByRole('button', { name: /Save chart|Save & place/ }).click();
  await page.waitForURL('**/gallery');
  const dash = await (await page.request.post(`${BASE}/api/custom-dashboards`, { data: { name: 'Hunt board' } })).json();
  await page.goto(`${BASE}/dashboards/custom/${dash.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.locator('.user-pill select').last().selectOption({ label: 'Hunt chart' }).catch(async () => {
    // the add-chart select is the one with the placeholder option
    const selects = page.locator('.user-pill select');
    for (let i = 0; i < await selects.count(); i++) {
      const options = await selects.nth(i).locator('option').allInnerTexts();
      if (options.some(o => o.includes('Hunt chart'))) { await selects.nth(i).selectOption({ label: 'Hunt chart' }); break; }
    }
  });
  await expect(page.locator('.custom-tile')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.tile-actions button', { hasText: '✕' }).click();
  await expect(page.locator('.custom-tile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();

  // 6. Account page cards render (TV links + team).
  step = 'account page';
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Cleanup.
  step = 'cleanup';
  await page.request.delete(`${BASE}/api/custom-dashboards/${dash.id}`);
  const charts = await (await page.request.get(`${BASE}/api/charts`)).json();
  for (const chart of charts.items.filter((c: any) => c.name === 'Hunt chart')) {
    await page.request.delete(`${BASE}/api/charts/${chart.id}`);
  }
  await page.request.delete(`${BASE}/api/datasources/${sourceId}`);

  console.log('problems:', JSON.stringify(problems, null, 1));
  expect(problems, JSON.stringify(problems)).toEqual([]);
});

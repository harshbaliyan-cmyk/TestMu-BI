import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// The multi-chart canvas loop: dashboard → New chart (builder arrives with the
// dashboard preset) → Save & place → back on the canvas → repeat. Plus the
// display options and the jump-anywhere switcher.
test('two charts land on one canvas through the builder loop', async ({ page }) => {
  test.setTimeout(240000);
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const lines = ['Region,Revenue,Signed On'];
  for (let i = 0; i < 40; i++) lines.push(`${['AMER', 'EMEA', 'APAC'][i % 3]},${2000 + i * 150},2026-0${(i % 6) + 1}-1${i % 9}`);
  const { stagingId } = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'canvas-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) } },
  })).json();
  const { sourceId } = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['opportunity-analytics'] },
  })).json();
  const dashboard = await (await page.request.post(`${BASE}/api/custom-dashboards`, { data: { name: 'Canvas E2E' } })).json();

  // Chart 1: horizontal currency bar, built with the dashboard preset.
  await page.goto(`${BASE}/charts/new?source=${sourceId}&dashboard=${dashboard.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.dashboard-switcher').first()).toBeVisible();
  await page.locator('.builder-type', { hasText: 'Bar chart' }).click();
  await expect(page.locator('.builder-chart-canvas canvas')).toBeVisible({ timeout: 20000 });
  await page.locator('.builder-check', { hasText: 'Horizontal bars' }).locator('input').check();
  await page.locator('.builder-slot', { hasText: 'Value format' }).locator('select').selectOption('currency');
  await page.waitForTimeout(900); // let the debounced preview settle
  await page.screenshot({ path: '.playwright/baseline/builder_v2.png' });
  await page.getByPlaceholder('e.g. ARR by region').fill('Canvas · Revenue by region');
  await page.getByRole('button', { name: /Save & place/ }).click();
  await page.waitForURL(`**/dashboards/custom/${dashboard.id}`, { timeout: 20000 });
  await expect(page.locator('.custom-tile')).toHaveCount(1, { timeout: 20000 });

  // Chart 2: KPI, started from the canvas's own New chart button.
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.getByRole('button', { name: 'New chart' }).click();
  await page.waitForURL('**/charts/new?dashboard=*');
  await page.locator('.builder-toolbar select').first().selectOption({ label: `canvas-e2e.csv · 40 rows` });
  await page.locator('.builder-type', { hasText: 'KPI tile' }).click();
  await expect(page.locator('.builder-kpi')).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder('e.g. ARR by region').fill('Canvas · Total revenue');
  await page.getByRole('button', { name: /Save & place/ }).click();
  await page.waitForURL(`**/dashboards/custom/${dashboard.id}`, { timeout: 20000 });
  await expect(page.locator('.custom-tile')).toHaveCount(2, { timeout: 20000 });
  await page.waitForTimeout(1200);
  // Tiles must occupy DISTINCT grid positions. This regressed once: the .card
  // entrance animation (fill: both) overrode react-grid-layout's inline
  // transforms and stacked every tile at the origin.
  const tileYs = await page.evaluate(() =>
    [...document.querySelectorAll('.react-grid-item')].map(el => Math.round(el.getBoundingClientRect().y)));
  expect(new Set(tileYs).size, `tiles overlap: ${tileYs}`).toBe(2);
  await page.screenshot({ path: '.playwright/baseline/canvas_two_charts.png', fullPage: true });

  // The switcher jumps between boards.
  await page.locator('.dashboard-switcher').first().selectOption('/dashboard/win-board');
  await page.waitForURL('**/dashboard/win-board');
  await expect(page.locator('.dashboard-switcher').first()).toBeVisible();

  console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
  expect(consoleErrors).toEqual([]);

  // Tidy the shared DB.
  const charts = await (await page.request.get(`${BASE}/api/charts`)).json();
  await page.request.delete(`${BASE}/api/custom-dashboards/${dashboard.id}`);
  for (const chart of charts.items.filter((c: any) => c.name.startsWith('Canvas ·'))) {
    await page.request.delete(`${BASE}/api/charts/${chart.id}`);
  }
  await page.request.delete(`${BASE}/api/datasources/${sourceId}`);
});

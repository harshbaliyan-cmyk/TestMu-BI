import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// Double-click hides a KPI/chart from the presentation; the hide persists, the
// share-token wall omits it entirely, and clicking the ghost chip restores it.
test('hide a KPI and a chart from the TV, verify the wall, restore', async ({ browser }) => {
  test.setTimeout(240000);
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  // Seed win-board rows so the presentation has content.
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: `HIDE-${i}`, name: `Deal ${i}`, owner: 'Rep', stage: i % 3 ? 'Closed Won' : 'Closed Lost',
    arr: 9000 + i * 300, amount: 9000, isClosed: true, isWon: Boolean(i % 3),
    createdDate: '2026-07-05', closeDate: '2026-08-10', region: 'AMER', orgType: 'SMB',
    pod: 'AE Corp', team: 'Team Falcon', industry: 'SaaS', type: 'New Business', ownerActive: true,
  }));
  expect((await page.request.post(`${BASE}/api/data/win-board/load`, { data: rows })).ok()).toBeTruthy();
  // Start from a clean hidden set.
  const state = await (await page.request.get(`${BASE}/api/dashboards/win-board/state`)).json();
  await page.request.put(`${BASE}/api/dashboards/win-board/state`, {
    data: { ...(state || {}), presentationSettings: { ...(state?.presentationSettings || {}), hiddenTiles: [] } },
  });

  await page.goto(`${BASE}/present/win-board`, { waitUntil: 'networkidle' });
  await expect(page.locator('.win-rate-summary-metric.arr-rate')).toBeVisible({ timeout: 20000 });

  // Hide the ARR win rate KPI and the trend chart, waiting for each persist
  // to land — the write is async by design and a reload aborts it mid-flight.
  const persisted = () => page.waitForResponse(res =>
    res.url().includes('/dashboards/win-board/state') && res.request().method() === 'PUT' && res.ok());
  let saveDone = persisted();
  await page.locator('.win-rate-summary-metric.arr-rate').dblclick();
  await expect(page.locator('.hidden-tile-ghost', { hasText: 'ARR win rate' })).toBeVisible();
  await expect(page.locator('.win-rate-summary-metric.arr-rate')).toHaveCount(0);
  await saveDone;
  saveDone = persisted();
  await page.locator('.present-card', { hasText: 'trend' }).first().dblclick();
  await expect(page.locator('.hidden-tile-ghost')).toHaveCount(2);
  await saveDone;
  await page.screenshot({ path: '.playwright/baseline/tv_hide_ghosts.png' });

  // Persistence: a reload keeps both hidden.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.hidden-tile-ghost')).toHaveCount(2, { timeout: 20000 });

  // The wall shows neither the tiles nor the ghosts.
  const { token, id: tokenId } = await (await page.request.post(`${BASE}/api/share-tokens`, {
    data: { templateId: 'win-board', label: 'hide e2e' } })).json();
  const wall = await browser.newContext();
  const tv = await wall.newPage();
  await tv.goto(`${BASE}/tv/${token}`, { waitUntil: 'networkidle' });
  await expect(tv.locator('.win-rate-summary-metrics')).toBeVisible({ timeout: 30000 });
  await expect(tv.locator('.win-rate-summary-metric.arr-rate')).toHaveCount(0);
  await expect(tv.locator('.hidden-tile-ghost')).toHaveCount(0);
  await expect(tv.getByText('ARR win rate')).toHaveCount(0);
  await tv.screenshot({ path: '.playwright/baseline/tv_hide_wall.png' });
  await wall.close();

  // Restore from the ghost chips.
  await page.locator('.hidden-tile-ghost', { hasText: 'ARR win rate' }).click();
  await expect(page.locator('.win-rate-summary-metric.arr-rate')).toBeVisible();
  await page.locator('.hidden-tile-ghost').first().click();
  await expect(page.locator('.hidden-tile-ghost')).toHaveCount(0);

  await page.request.delete(`${BASE}/api/share-tokens/${tokenId}`);
  await owner.close();
});

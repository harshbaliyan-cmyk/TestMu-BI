import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// One-off visual verification of the drill-down modal: scan click positions
// across the preview canvas until a bar is hit, then assert the rows modal
// opens with matching rows.
test('clicking a bar opens the rows behind it', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const lines = ['Team,Bookings'];
  for (let i = 0; i < 30; i++) lines.push(`Team ${'ABC'[i % 3]},${1000 + i * 100}`);
  const previewRes = await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'drill-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) } },
  });
  const { stagingId } = await previewRes.json();
  const { sourceId } = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['opportunity-analytics'] },
  })).json();

  await page.goto(`${BASE}/charts/new?source=${sourceId}`, { waitUntil: 'networkidle' });
  await page.locator('.builder-type', { hasText: 'Bar chart' }).click();
  const canvas = page.locator('.builder-chart-canvas canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800); // let the animation settle so hit boxes are final

  const box = (await canvas.boundingBox())!;
  const modal = page.locator('.modal-card');
  let hit = false;
  for (const fx of [0.17, 0.3, 0.5, 0.64, 0.83]) {
    if (await modal.isVisible().catch(() => false)) { hit = true; break; }
    await canvas.click({ position: { x: box.width * fx, y: box.height * 0.7 }, timeout: 3000 }).catch(() => {});
    if (await modal.isVisible({ timeout: 1500 }).catch(() => false)) { hit = true; break; }
  }
  expect(hit, 'a scan across the bars must open the drill modal').toBeTruthy();
  await expect(modal.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: '.playwright/baseline/drill_modal.png' });

  // "Filter chart to this" pins the clicked category as a config filter.
  await modal.getByRole('button', { name: 'Filter chart to this' }).click();
  await expect(page.locator('.builder-filter')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: '.playwright/baseline/drill_filtered.png' });

  await page.request.delete(`${BASE}/api/datasources/${sourceId}`);
});

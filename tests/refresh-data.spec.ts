import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// The header Refresh-data button: re-pulls the board's Tableau sources and
// reloads the metrics in place. The audit account has no live Tableau source,
// so the click exercises the whole path (source listing → reload → settled
// state) without triggering a real VDS pull against Tableau.
test('refresh data button reloads the win board in place', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  await page.goto(BASE + '/dashboard/win-board');
  const button = page.locator('.refresh-data-button');
  await expect(button).toBeVisible();

  // The click must trigger a fresh snapshot fetch — that's the whole point.
  const snapshotAgain = page.waitForResponse(r => r.url().includes('/win-board/'), { timeout: 20000 });
  await button.click();
  await snapshotAgain;

  // Settles into a terminal state (✓ with no live source) and never wedges
  // in "Refreshing…"; the board is still standing afterwards.
  await expect(button).toHaveText(/Refreshed ✓|Refresh failed/, { timeout: 30000 });
  await expect(page.locator('h1')).toHaveText('Win Board');
  await page.screenshot({ path: '.playwright/baseline/refresh_button.png' });
  expect(consoleErrors).toEqual([]);
});

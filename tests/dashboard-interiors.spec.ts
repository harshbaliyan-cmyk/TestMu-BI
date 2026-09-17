import { test, expect, Page } from '@playwright/test';
import { mockDashboards, templates } from './fixtures/dashboard-preview';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.playwright/dashboard-refresh/${name}.png`, fullPage: true, animations: 'disabled' });
};
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

test.describe('Dashboard interiors', () => {
  test.use({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' });
  for (const template of templates) {
    test(`${template.name} renders populated charts and remains usable on mobile`, async ({ page }) => {
      const { errors, requests } = await mockDashboards(page);
      await page.goto(`${BASE}/dashboard/${template.id}`);
      await expect(page.locator('.db-page h1')).toBeVisible();
      await expect(page.locator('.db-page canvas, .db-page .ae-leaderboard-row').first()).toBeVisible();
      await expect(page.locator('.db-page .card').first()).toBeVisible();
      await expect(page.locator('.db-page [aria-busy=true]')).toHaveCount(0);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 234)');
      await shot(page, `${template.id}-desktop`);
      await noOverflow(page);
      if (await page.locator('.advanced-date-trigger').count()) {
        const dateText = await page.locator('.advanced-date-trigger > span:nth-child(2)').first().boundingBox();
        expect(dateText!.width).toBeGreaterThan(100);
      }
      const before = requests.filter(path => path.endsWith('/snapshot')).length;
      await page.getByRole('button', { name: /Refresh data/ }).click();
      await expect.poll(() => requests.filter(path => path.endsWith('/snapshot')).length).toBeGreaterThan(before);
      await expect(page.locator('.db-page [aria-busy=true]')).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, `${template.id}-mobile`);
      await noOverflow(page);
      await page.locator('.db-page .ms-trigger').first().click();
      await expect(page.getByRole('listbox')).toBeVisible();
      const popup = await page.getByRole('listbox').boundingBox();
      expect(popup!.x).toBeGreaterThanOrEqual(0);
      expect(popup!.x + popup!.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
    });
  }

  test('Win Board explains metrics on demand and applies region filters', async ({ page }) => {
    await mockDashboards(page);
    await page.goto(BASE + '/dashboard/win-board');
    await expect(page.locator('.count-total b')).not.toHaveText('0');
    const total = Number(await page.locator('.count-total b').innerText());
    await expect(page.locator('.metric-definition')).toBeHidden();
    await page.getByText('How these metrics are calculated', { exact: true }).click();
    await expect(page.locator('.metric-definition')).toBeVisible();
    await page.locator('.ms-trigger').filter({ hasText: 'Region' }).first().click();
    await page.getByRole('option', { name: 'AMER', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => Number(await page.locator('.count-total b').innerText())).toBeLessThan(total);
    await page.locator('.filter-reset-button').click();
    await expect(page.locator('.count-total b')).toHaveText(String(total));
    const cards = page.locator('.db-trend-row > .card');
    expect((await cards.nth(0).boundingBox())!.width).toBeGreaterThan((await cards.nth(1).boundingBox())!.width);
    const bounds = await cards.nth(1).boundingBox();
    for (const value of await page.locator('.team-share-value-wrap').all()) {
      const rect = await value.boundingBox();
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    }
    for (const row of await page.locator('.org-fill-row').all()) {
      const previous = await row.locator('.org-fill-previous em').boundingBox();
      const delta = await row.locator('.bar-comparison-delta').boundingBox();
      if (previous && delta) expect(delta.y).toBeGreaterThanOrEqual(previous.y + previous.height);
    }
  });

  test('Product View keeps independent filters when switching between pipeline and won', async ({ page }) => {
    const { errors } = await mockDashboards(page);
    await page.goto(BASE + '/dashboard/product-view');
    await expect(page.getByRole('heading', { name: 'Pipeline created trend' })).toBeVisible();
    const chip = page.locator('.pv-chip').filter({ hasText: 'KaneAI' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: /Won ARR/ }).click();
    await expect(page.getByRole('heading', { name: 'Won ARR trend by Product Group' })).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'product-won-desktop');
    await page.getByRole('tab', { name: /Pipeline/ }).click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Quarterly', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Quarterly', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });

  test('Opportunity views and small-screen date controls stay accessible', async ({ page }) => {
    const { errors } = await mockDashboards(page);
    await page.goto(BASE + '/dashboard/opportunity-analytics');
    for (const button of await page.getByRole('navigation', { name: 'Dashboard views' }).getByRole('button').all()) {
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.db-page .card').first()).toBeVisible();
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator('.date-range-trigger').click();
    const dialog = page.getByRole('dialog', { name: 'Date range' });
    await expect(dialog).toBeVisible();
    const rect = await dialog.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.locator('.date-range-trigger').click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.date-range-trigger')).toBeFocused();
    await noOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Dark mode retains readable dashboard surfaces', async ({ page }) => {
    const { errors } = await mockDashboards(page, 'dark');
    await page.goto(BASE + '/dashboard/win-board');
    await expect(page.locator('.db-page canvas').first()).toBeVisible();
    await expect(page.locator('.db-page .card').first()).toHaveCSS('background-color', 'rgb(28, 33, 28)');
    await shot(page, 'win-board-dark');
    await noOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Executive deals remain searchable and sortable after the layout refresh', async ({ page }) => {
    const { errors } = await mockDashboards(page);
    await page.goto(BASE + '/dashboard/executive-dashboard');
    const rows = page.locator('.exec-deals tbody tr');
    await expect(rows.first()).toContainText('Meridian');
    await page.getByRole('searchbox', { name: 'Search closed-won deals' }).fill('Aditi');
    await expect(rows.first()).toContainText('Aditi Sharma');
    expect(await rows.count()).toBeGreaterThan(0);
    await page.getByRole('searchbox', { name: 'Search closed-won deals' }).fill('no matching deal');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('No closed-won opportunity matches that search.');
    await page.getByRole('searchbox', { name: 'Search closed-won deals' }).fill('');
    await page.getByRole('combobox', { name: 'Rows to show' }).selectOption('0');
    await page.getByRole('columnheader', { name: /Won Deal ARR/ }).click();
    const amounts = await page.locator('.exec-deal-arr b').allTextContents();
    const values = amounts.map(value => Number(value.replace(/[^\d.]/g, '')) * (value.includes('M') ? 1000000 : value.includes('K') ? 1000 : 1));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(errors).toEqual([]);
  });
});

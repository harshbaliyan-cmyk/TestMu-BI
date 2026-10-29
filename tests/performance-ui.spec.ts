import { test, expect, Page } from '@playwright/test';
import { mockPerformance, performanceSnapshot } from './fixtures/performance-preview.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5191';
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.playwright/performance/${name}.png`, fullPage: true, animations: 'disabled' });
};
const goodPhotos = async (page: Page) => {
  const photos = page.locator('img[src^="/pod-leaders/"]');
  expect(await photos.count()).toBeGreaterThan(0);
  await expect.poll(() => photos.evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
};

test.describe('AE and AM performance refresh', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });

  for (const role of ['AE', 'AM']) {
    const key = role.toLowerCase();
    test(`${role}: known leader photos, true quota values and consistent row heights`, async ({ page }) => {
      const { errors } = await mockPerformance(page);
      await page.goto(`${BASE}/dashboard/${key}-performance`);
      await expect(page.getByRole('region', { name: `${role} quarter performance` })).toBeVisible();
      const pods = page.getByRole('list', { name: 'POD ranking' });
      const reps = page.getByRole('list', { name: 'Rep ranking' });
      await expect(pods.locator('img')).toHaveCount(role === 'AE' ? 5 : 3);
      await goodPhotos(page);
      const expected = performanceSnapshot(role, { repStatus: 'active' }).quotaMetrics;
      await expect(reps.locator('.ae-chart-value > strong').first()).toHaveText(expected.reps[0].attainment.toFixed(1) + '%');
      const heights = await pods.locator('.ae-chart-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
      for (const [pod, leader] of role === 'AE' ? [['AMER II', 'Misbah Farooqi'], ['AMER CORP', 'Misbah Farooqi'], ['AMER III', 'Mohit Juneja']] : [['AMER AM', 'Prakhar Goyal'], ['APAC AM', 'Karan Rana'], ['EMEA AM', 'Rishabh Agarwal']]) {
        const row = pods.getByRole('listitem').filter({ has: page.getByText(pod, { exact: true }) });
        await expect(row.getByRole('img', { name: leader })).toBeVisible();
      }
      await shot(page, `${key}-dashboard-desktop`);
      await noOverflow(page);
      expect(errors).toEqual([]);
    });

    test(`${role}: Top N, rep status, region, refresh and saved state keep working`, async ({ page }) => {
      const { errors, requests, writes } = await mockPerformance(page);
      await page.goto(`${BASE}/dashboard/${key}-performance`);
      const reps = page.getByRole('list', { name: 'Rep ranking' });
      await page.getByRole('combobox', { name: 'Number of reps to display' }).selectOption('10');
      await expect(reps.getByRole('listitem')).toHaveCount(10);
      await expect.poll(() => writes.at(-1)?.body.tableTops?.rep).toBe(10);
      await page.reload();
      await expect(page.getByRole('combobox', { name: 'Number of reps to display' })).toHaveValue('10');
      await page.getByRole('combobox', { name: 'Rep status', exact: true }).selectOption('all');
      await expect.poll(() => requests.filter(request => request.path.endsWith('/snapshot')).at(-1)?.params.repStatus).toBe('all');
      await page.locator('.ms-trigger').first().click();
      await page.getByRole('option', { name: 'EMEA', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect.poll(() => requests.filter(request => request.path.endsWith('/snapshot')).at(-1)?.params.region).toBe('EMEA');
      const before = requests.filter(request => request.path.endsWith('/snapshot')).length;
      await page.getByRole('button', { name: /Refresh data/ }).click();
      await expect.poll(() => requests.filter(request => request.path.endsWith('/snapshot')).length).toBeGreaterThan(before);
      expect(errors).toEqual([]);
    });

    for (const width of [320, 390, 820]) {
      test(`${role}: dashboard remains readable at ${width}px`, async ({ page }) => {
        const { errors } = await mockPerformance(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}/dashboard/${key}-performance`);
        await expect(page.getByRole('list', { name: 'POD ranking' })).toBeVisible();
        await goodPhotos(page);
        await noOverflow(page);
        await shot(page, `${key}-dashboard-${width}`);
        expect(errors).toEqual([]);
      });
    }

    for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
      test(`${role}: presentation fits ${width}x${height} without clipping rows or controls`, async ({ page }) => {
        const { errors } = await mockPerformance(page);
        await page.setViewportSize({ width, height });
        await page.goto(`${BASE}/present/${key}-performance`);
        await expect(page.locator('.ae-ranking-panel')).toHaveCount(2);
        await goodPhotos(page);
        await noOverflow(page);
        const bounds = await page.locator('.ae-ranking-panel, .ae-chart-row, .presentation-controls').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { bottom: box.bottom, top: box.top }; }));
        for (const box of bounds) { expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(height); }
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
        // A visible row is insufficient if its text paints beyond its cell.
        expect(await page.locator('.ae-chart-row').evaluateAll(rows => rows.every(row => row.scrollHeight <= row.clientHeight + 2))).toBe(true);
        await shot(page, `${key}-presentation-${width}`);
        expect(errors).toEqual([]);
      });
    }
  }

  test('long presentation lists page without losing ranks and support keyboard navigation', async ({ page }) => {
    await mockPerformance(page, { tableTops: { rep: 0, pod: 0 } });
    await page.goto(BASE + '/present/ae-performance');
    const panel = page.getByRole('region', { name: 'AE Quota Attainment', exact: true });
    await expect(panel.locator('.ae-chart-row')).toHaveCount(5);
    await panel.getByRole('button', { name: 'Next reps' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('.ae-chart-row').first()).toHaveAttribute('data-rank', '6');
    await expect(panel.locator('footer')).toContainText('6–10 of');
    await panel.getByRole('button', { name: 'Previous reps' }).click();
    await expect(panel.locator('.ae-chart-row').first()).toHaveAttribute('data-rank', '1');
    await page.getByRole('button', { name: 'Next PODs' }).click();
    await expect(page.getByRole('list', { name: 'POD ranking' }).getByText('Leader not assigned')).toBeVisible();
  });

  test('presentation hide/restore retains existing keys and saved Top N', async ({ page }) => {
    const { writes } = await mockPerformance(page, { tableTops: { rep: 10, pod: 5 } });
    await page.goto(BASE + '/present/am-performance');
    const spotlight = page.locator('.ae-tv-rail .ae-leader-spotlight').first();
    await spotlight.dblclick();
    await expect(page.getByRole('button', { name: /Top AM performer.*hidden/ })).toBeVisible();
    await expect.poll(() => writes.at(-1)?.body.presentationSettings.hiddenTiles).toEqual(['kpi:top-rep']);
    expect(writes.at(-1)?.body.tableTops.rep).toBe(10);
    await page.getByRole('button', { name: /Top AM performer.*hidden/ }).click();
    await expect(spotlight).toBeVisible();
    await page.getByRole('heading', { name: 'AM POD Quota Attainment' }).dblclick();
    await expect.poll(() => writes.at(-1)?.body.presentationSettings.hiddenTiles).toEqual(['card:pod-leaderboard']);
  });

  test('signed-out TV paginates automatically and respects hidden tiles', async ({ page }) => {
    const { errors, writes } = await mockPerformance(page, { signedOut: true, tableTops: { rep: 10 }, hiddenTiles: ['kpi:top-rep'] });
    await page.clock.install();
    await page.goto(BASE + '/tv/synthetic-performance');
    await expect(page.getByRole('heading', { name: 'AE Quota Attainment' })).toBeVisible();
    await expect(page.locator('.ae-tv-rail .ae-leader-spotlight')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Copy TV link' })).toHaveCount(0);
    await expect(page.locator('.hidden-tile-ghost')).toHaveCount(0);
    await page.clock.runFor(15100);
    await expect(page.getByRole('list', { name: 'Rep ranking' }).locator('.ae-chart-row').first()).toHaveAttribute('data-rank', '6');
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('AM signed-out TV retains AM data, pagination and leader photos', async ({ page }) => {
    const { errors, requests, writes } = await mockPerformance(page, {
      signedOut: true, shareTemplate: 'am-performance', tableTops: { rep: 10 }, hiddenTiles: ['kpi:top-rep'],
    });
    await page.clock.install();
    await page.goto(BASE + '/tv/synthetic-am-performance');
    await expect(page.getByRole('heading', { name: 'AM Quota Attainment', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'AM quarter performance' })).toBeVisible();
    await expect(page.locator('.ae-tv-rail .ae-leader-spotlight')).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'POD ranking' }).locator('img')).toHaveCount(3);
    await goodPhotos(page);
    await expect(page.getByRole('button', { name: 'Copy TV link' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exit', exact: true })).toHaveCount(0);
    await page.clock.runFor(15100);
    await expect(page.getByRole('list', { name: 'Rep ranking' }).locator('.ae-chart-row').first()).toHaveAttribute('data-rank', '6');
    expect(requests.filter(request => request.path.endsWith('/snapshot')).every(request => request.path.startsWith('/am-performance/'))).toBe(true);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('missing or failed portraits retain names and usable rows', async ({ page }) => {
    const { errors } = await mockPerformance(page, { tableTops: { pod: 0 } });
    await page.route('**/pod-leaders/misbah-farooqi.webp', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(BASE + '/dashboard/ae-performance');
    const pods = page.getByRole('list', { name: 'POD ranking' });
    await expect(pods.getByRole('img', { name: 'Misbah Farooqi' }).first()).toHaveText('MF');
    await expect(pods.getByText('Leader not assigned')).toHaveCount(1);
    await expect(pods.getByText('AMER I', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('missing quota and prior targets stay explicit, with no invented percentages', async ({ page }) => {
    await mockPerformance(page, { tableTops: { rep: 0 }, transform: snapshot => {
      snapshot.quota.priorMapped = false;
      snapshot.quotaMetrics.reps.forEach(rep => { rep.priorAttainment = null; rep.priorQuota = null; });
      return snapshot;
    } });
    await page.goto(BASE + '/dashboard/ae-performance');
    await expect(page.getByText('Prior quarter quota not mapped')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Rep ranking' }).getByText('No quota', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Rep ranking' }).locator('.bar-comparison-delta')).toHaveCount(0);
  });

  test('dark dashboards and mobile presentation keep legible surfaces', async ({ page }) => {
    const { errors } = await mockPerformance(page, { theme: 'dark' });
    await page.goto(BASE + '/dashboard/am-performance');
    await expect(page.locator('.ae-quarter-panel')).toHaveCSS('background-color', 'rgb(32, 62, 53)');
    await shot(page, 'am-dashboard-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/present/am-performance');
    await expect(page.getByRole('heading', { name: 'AM Performance', exact: true })).toBeVisible();
    await noOverflow(page);
    await shot(page, 'am-presentation-mobile-dark');
    expect(errors).toEqual([]);
  });
});

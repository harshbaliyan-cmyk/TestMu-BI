/**
 * Gallery (signed-in home), rendered against a mocked API.
 *
 * Every /api/* request is answered at the network layer, so this runs with
 * no session, no credentials and no server writes. It checks the page's
 * shape and takes screenshots; the real gallery over real data is covered
 * by tests/baseline.spec.ts.
 *
 *   npx playwright test tests/gallery.spec.ts --reporter=list
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = '.playwright/baseline';

const USER = { id: 1, name: 'Synthetic Admin', email: 'synthetic@example.com', role: 'admin', mustChangePassword: false };
const TEMPLATES = [
  { id: 'opportunity-analytics', name: 'Opportunity Analytics', description: 'Revenue funnel, win rates, rep performance', tags: ['Salesforce', '6 views'] },
  { id: 'event-analytics', name: 'Event Analytics', description: 'Feature adoption, churn signals', tags: ['orgType', '4 views'] },
  { id: 'tenant-health', name: 'Tenant Health', description: 'Account whitespace, expansion candidates', tags: ['HubSpot', '5 views'] },
  { id: 'win-board', name: 'Win Board', description: 'Won ARR, ARR win rate, and contribution performance', tags: ['Tableau', 'Won ARR'] },
  { id: 'loss-board', name: 'Loss Board', description: 'Where business is being lost', tags: ['Tableau', 'Lost ARR'] },
  { id: 'product-view', name: 'Product View', description: 'Pipeline by created date and Won ARR by close date, split by product', tags: ['Tableau', '2 views'] },
  { id: 'executive-dashboard', name: 'Executive Dashboard', description: 'Quota attainment, pipeline coverage, forecast and trials', tags: ['Tableau', 'Exec'] },
  { id: 'am-performance', name: 'AM Performance', description: 'AM rep ranking by % of quota achieved, with POD attainment', tags: ['Tableau', 'Quota'] },
  { id: 'ae-performance', name: 'AE Performance', description: 'AE rep ranking by share of closed ARR, with period comparison', tags: ['Tableau', 'ARR Contribution'] },
];
const CUSTOM = [
  { id: 11, name: 'AMER weekly review', updatedAt: '2026-09-01T10:00:00Z', layout: [
    { chartId: 'a', x: 0, y: 0, w: 6, h: 6 }, { chartId: 'b', x: 6, y: 0, w: 6, h: 6 },
    { chartId: 'c', x: 0, y: 6, w: 4, h: 5 }, { chartId: 'd', x: 4, y: 6, w: 8, h: 5 }, { chartId: 'e', x: 0, y: 11, w: 12, h: 4 },
  ] },
  { id: 12, name: 'Trials watch', updatedAt: '2026-08-28T10:00:00Z', layout: [] },
];

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/api/auth/me')) return json(USER);
    if (url.includes('/api/templates')) return json(TEMPLATES);
    if (url.includes('/api/custom-dashboards')) return json({ items: CUSTOM });
    if (url.includes('/api/datasources')) return json({ sources: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    if (url.includes('/api/auth/config')) return json({ googleClientId: null, selfSignupEnabled: false });
    return json({ items: [] });
  });
}

test.describe('Gallery', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('greets the person, counts their workspace, and draws every board', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await mockApi(page);
    await page.goto(BASE + '/gallery');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Synthetic\./);
    const stats = page.getByRole('group', { name: 'Your workspace' }).or(page.locator('.gl-stats'));
    await expect(stats.locator('.gl-stat')).toHaveCount(3);
    await expect(stats).toContainText('Custom dashboards');
    await expect(stats).toContainText('Sources connected');
    await expect(stats.locator('dd').nth(0)).toHaveText('2');
    await expect(stats.locator('dd').nth(1)).toHaveText('9');
    await expect(stats.locator('dd').nth(2)).toHaveText('3');

    // The headings and buttons the rest of the app links to are unchanged.
    await expect(page.getByRole('heading', { name: 'My Dashboards' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard Templates' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build a chart' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect data' })).toBeVisible();

    // Custom dashboards draw their saved layout; an empty one shows placeholders.
    const amer = page.getByRole('link', { name: 'Open AMER weekly review' });
    await expect(amer.locator('.gl-layout i')).toHaveCount(5);
    await expect(amer).toContainText('5 charts');
    await expect(page.getByRole('link', { name: 'Open Trials watch' }).locator('.gl-layout.is-empty')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New dashboard' })).toContainText('Assemble your own');

    // Nine templates, each with its own shape, and the shapes animate in.
    const templates = page.locator('.gl-grid').nth(1);
    await expect(templates.locator('.template-card')).toHaveCount(9);
    await expect(templates.locator('.viz')).toHaveCount(9);
    await expect(templates).toHaveClass(/is-in/);
    for (const kind of ['funnel', 'line', 'heat', 'bars', 'reasons', 'stack', 'tiles', 'donut']) {
      await expect(templates.locator(`.viz-${kind}`)).toHaveCount(1);
    }
    // "reasons" is drawn with the rank rows, so it carries both classes.
    await expect(templates.locator('.viz-rank:not(.viz-reasons)')).toHaveCount(1);
    await expect(templates.locator('.viz-funnel i').last()).toHaveCSS('transform', 'none', { timeout: 8000 });
    await expect(templates.locator('.viz-heat i').last()).not.toHaveCSS('opacity', '0', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/gallery_dark.png`, fullPage: true });

    // Keyboard: a card is a link you can tab to and press.
    await page.getByRole('link', { name: 'Open Win Board' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\/win-board$/);
    expect(errors).toEqual([]);
  });

  test('light theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('testmu-theme', 'light'));
    await mockApi(page);
    await page.goto(BASE + '/gallery');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.gl-grid').nth(1).locator('.template-card')).toHaveCount(9);
    await expect(page.locator('.viz-funnel i').last()).toHaveCSS('transform', 'none', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/gallery_light.png`, fullPage: true });
  });

  test('a registry with only ids and names still renders', async ({ page }) => {
    await page.route('**/api/**', route => {
      const url = route.request().url();
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/api/auth/me')) return json(USER);
      if (url.includes('/api/templates')) return json([{ id: 'win-board', name: 'Win Board' }, { id: 'mystery', name: 'Mystery Board' }]);
      if (url.includes('/api/custom-dashboards')) return json({ items: [] });
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    });
    await page.goto(BASE + '/gallery');
    await expect(page.getByRole('link', { name: 'Open Mystery Board' })).toBeVisible();
    // Unknown ids fall back to bars; a failed sources request hides that stat rather than showing zero.
    await expect(page.getByRole('link', { name: 'Open Mystery Board' }).locator('.viz-bars')).toBeVisible();
    await expect(page.locator('.gl-stat')).toHaveCount(2);
  });
});

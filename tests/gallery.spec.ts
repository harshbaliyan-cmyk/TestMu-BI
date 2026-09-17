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

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/api/auth/me')) return json(USER);
    if (url.includes('/api/templates')) return json(TEMPLATES);
    if (url.includes('/api/datasources')) return json({ sources: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    if (url.includes('/api/auth/config')) return json({ googleClientId: null, selfSignupEnabled: false });
    return json({ items: [] });
  });
}

test.describe('Gallery', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('lists every existing board with native links and dashboard previews', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await mockApi(page);
    await page.goto(BASE + '/gallery');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboards');
    await expect(page.getByRole('group', { name: 'Filter dashboards' }).getByRole('button', { name: /All boards/ })).toHaveText('All boards9');

    // The headings and buttons the rest of the app links to are unchanged.
    await expect(page.getByRole('heading', { name: 'My dashboards' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Dashboard templates' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Build a chart', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /New dashboard|Create.*dashboard/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Connect data' })).toBeVisible();

    // Nine templates, each with its own shape, and the shapes animate in.
    const templates = page.getByRole('region', { name: 'Dashboard templates' }).locator('.gl-grid');
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
    await expect(page.getByRole('region', { name: 'Dashboard templates' }).locator('.template-card')).toHaveCount(9);
    await expect(page.locator('.viz-funnel i').last()).toHaveCSS('transform', 'none', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/gallery_light.png`, fullPage: true });
  });

  test('a registry with only ids and names still renders', async ({ page }) => {
    await page.route('**/api/**', route => {
      const url = route.request().url();
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/api/auth/me')) return json(USER);
      if (url.includes('/api/templates')) return json([{ id: 'win-board', name: 'Win Board' }, { id: 'mystery', name: 'Mystery Board' }]);
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    });
    await page.goto(BASE + '/gallery');
    await expect(page.getByRole('link', { name: 'Open Mystery Board' })).toBeVisible();
    // Unknown ids retain a useful preview and a direct link.
    await expect(page.getByRole('link', { name: 'Open Mystery Board' }).locator('.viz-bars')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Mystery Board' })).toHaveAttribute('href', '/dashboard/mystery');
  });
});

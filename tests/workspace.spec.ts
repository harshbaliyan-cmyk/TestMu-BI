import { test, expect, Page } from '@playwright/test';
import { mockDashboards } from './fixtures/dashboard-preview';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SHOTS = '.playwright/workspace';
const USER = { id: 91, name: 'Harsh Baliyan', email: 'workspace@example.com', role: 'admin', mustChangePassword: false };
const TEMPLATES = [
  { id: 'opportunity-analytics', name: 'Opportunity Analytics', description: 'Revenue funnel, win rates and rep performance', tags: ['Revenue', '6 views'] },
  { id: 'event-analytics', name: 'Event Analytics', description: 'Feature adoption and engagement', tags: ['Product', '4 views'] },
  { id: 'tenant-health', name: 'Tenant Health', description: 'Account health and expansion opportunities', tags: ['Accounts'] },
  { id: 'win-board', name: 'Win Board', description: 'Won ARR and contribution performance', tags: ['Tableau', 'Won ARR'] },
  { id: 'loss-board', name: 'Loss Board', description: 'Understand where business is being lost', tags: ['Tableau', 'Lost ARR'] },
  { id: 'product-view', name: 'Product View', description: 'Pipeline and won ARR across products', tags: ['Tableau', '2 views'] },
  { id: 'executive-dashboard', name: 'Executive Dashboard', description: 'Quota, pipeline, forecast and trials', tags: ['Tableau', 'Executive'] },
  { id: 'am-performance', name: 'AM Performance', description: 'Account manager performance against quota', tags: ['Tableau', 'Quota'] },
  { id: 'ae-performance', name: 'AE Performance', description: 'Rep performance and revenue contribution', tags: ['Tableau', 'Contribution'] },
];

async function mockWorkspace(page: Page, user: typeof USER | null = USER) {
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('testmu-theme', 'light'));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    const method = route.request().method();
    if (!['GET', 'HEAD'].includes(method)) writes.push(`${method} ${path}: ${route.request().postData()}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/auth/me') return user ? json(user) : json({ error: 'signed out' }, 401);
    if (path === '/auth/config') return json({ googleClientId: null, selfSignupEnabled: false });
    if (path === '/templates') return json(TEMPLATES);
    if (path === '/datasources') return json({ sources: [{ id: 1, name: 'Revenue', status: 'loaded' }, { id: 2, name: 'Product', status: 'loaded' }] });
    if (path === '/share/resolve') return json({ error: 'This share link is unavailable.' }, 404);
    if (path.endsWith('/snapshot')) return json({ error: 'No source connected' }, 400);
    return json({ items: [], sources: [], runs: [] });
  });
  return writes;
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

test.describe('Workspace navigation', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });

  test('direct links, gallery filtering and cream canvas', async ({ page }) => {
    const writes = await mockWorkspace(page);
    await page.goto(BASE + '/gallery');
    const nav = page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
    for (const t of TEMPLATES) await expect(nav.getByRole('link', { name: t.name, exact: true })).toHaveAttribute('href', `/dashboard/${t.id}`);
    await expect(nav.getByRole('link', { name: 'All dashboards', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 234)');
    await expect(page.locator('.ws-gallery .gl-card')).toHaveCount(9);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/gallery-desktop.png`, fullPage: true });
    await page.getByRole('textbox', { name: 'Filter dashboard list' }).or(page.getByRole('searchbox', { name: 'Filter dashboard list' })).fill('quota');
    await expect(page.locator('.ws-gallery .gl-card')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Filter dashboard list' }).fill('no matching board');
    await expect(page.getByRole('heading', { name: 'No dashboards found' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all dashboards' }).click();
    await page.getByRole('group', { name: 'Filter dashboards' }).getByRole('button', { name: /Starred/ }).click();
    await expect(page.getByRole('heading', { name: 'Keep your go-to dashboards here' })).toBeVisible();
    await noOverflow(page);
    expect(writes).toEqual([]);
  });

  test('sidebar opens a built-in board and preserves charts when collapsed', async ({ page }) => {
    const { errors, requests, writes } = await mockDashboards(page);
    await page.goto(BASE + '/gallery');
    await page.locator('.ws-sidebar').getByRole('link', { name: 'Win Board', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/win-board$/);
    await expect(page.locator('.ws-breadcrumb')).toContainText('Win Board');
    await expect(page.locator('.ws-sidebar').getByRole('link', { name: 'Win Board', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.db-page canvas').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Present/ })).toBeVisible();
    const before = await page.locator('.db-page').boundingBox();
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(page.locator('.workspace-shell')).toHaveClass(/ws-collapsed/);
    await expect.poll(async () => (await page.locator('.db-page').boundingBox())!.width).toBeGreaterThan(before!.width);
    await expect(page.locator('.db-page canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 234)');
    await page.reload();
    await expect(page.locator('.workspace-shell')).toHaveClass(/ws-collapsed/);
    await expect(page.locator('.db-page canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await noOverflow(page);
    expect(requests.some(path => /custom-dashboards|^\/charts/.test(path))).toBe(false);
    expect(writes.every(write => write.path.endsWith('/state'))).toBe(true);
    expect(errors).toEqual([]);
  });

  for (const [name, width, height] of [['tablet', 820, 1180], ['mobile', 390, 844], ['small', 320, 740]] as const) {
    test(`${name}: mobile drawer, keyboard dismissal and direct navigation`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await mockDashboards(page);
      await page.goto(BASE + '/gallery');
      await expect(page.locator('.ws-sidebar')).not.toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${SHOTS}/gallery-${name}.png`, fullPage: true });
      await noOverflow(page);
      const trigger = page.getByRole('button', { name: 'Open workspace navigation' });
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
      await expect(drawer).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/drawer-${name}.png` });
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await drawer.getByRole('link', { name: 'Win Board', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/win-board$/);
      await expect(drawer).not.toBeVisible();
      await expect(page.locator('.db-page canvas').first()).toBeVisible();
      await noOverflow(page);
      await trigger.click();
      await expect(drawer.getByRole('link', { name: 'Win Board' })).toHaveAttribute('aria-current', 'page');
    });
  }

  test('search works with keyboard, no results, Escape and built-in boards', async ({ page }) => {
    await mockWorkspace(page);
    await page.goto(BASE + '/gallery');
    await expect(page.locator('.ws-sidebar .ws-find')).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Where would you like to go?' });
    const input = page.getByRole('textbox', { name: 'Search dashboards and pages' });
    await expect(input).toBeFocused();
    await input.fill('no such board');
    await expect(dialog.getByRole('status')).toContainText('No matches');
    await input.fill('win');
    await expect(dialog.getByRole('link', { name: /Win Board/ })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('link', { name: /Win Board/ })).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/dashboard-search.png` });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\/win-board$/);
    await expect(dialog).not.toBeVisible();
    await page.locator('.ws-sidebar .ws-find').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ws-sidebar .ws-find')).toBeFocused();
  });

  test('starred shortcuts and display preferences persist without creating dashboards', async ({ page }) => {
    const writes = await mockWorkspace(page);
    await page.goto(BASE + '/gallery');
    await expect(page.getByRole('button', { name: /New dashboard|Create.*dashboard/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Star Win Board', exact: true }).click();
    await expect(page.locator('.ws-sidebar').getByRole('link', { name: 'Win Board', exact: true })).toHaveCount(2);
    await page.getByRole('group', { name: 'Filter dashboards' }).getByRole('button', { name: /Starred/ }).click();
    await expect(page.locator('.gl-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.screenshot({ path: `${SHOTS}/starred-list.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Unstar Win Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Unstar Win Board', exact: true }).click();
    await page.getByRole('group', { name: 'Filter dashboards' }).getByRole('button', { name: /Starred/ }).click();
    await expect(page.getByRole('heading', { name: 'Keep your go-to dashboards here' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Build a chart|Chart builder/ })).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('registry fallback remains navigable', async ({ page }) => {
    await mockWorkspace(page);
    await page.route('**/api/templates', route => route.fulfill({ status: 400, json: { error: 'Unavailable' } }));
    await page.goto(BASE + '/gallery');
    await expect(page.locator('.ws-sidebar').getByRole('link', { name: 'Win Board', exact: true })).toBeVisible();
    await expect(page.locator('.gl-card')).toHaveCount(9);
    await page.getByRole('link', { name: 'Open Win Board', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/win-board$/);
  });

  test('utility routes inherit cream, and admin navigation respects the role', async ({ page }) => {
    await mockWorkspace(page, { ...USER, role: 'user' });
    await page.goto(BASE + '/gallery');
    await expect(page.locator('.ws-sidebar').getByRole('link', { name: 'Activity logs' })).toHaveCount(0);
    for (const [name, path] of [['Data sources', '/data-sources'], ['Account', '/account']]) {
      const link = name === 'Account' ? page.locator('.ws-sidebar .ws-profile') : page.locator('.ws-sidebar').getByRole('link', { name, exact: true });
      await link.click();
      await expect(page).toHaveURL(BASE + path);
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 234)');
      if (name !== 'Account') await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.ws-breadcrumb')).toContainText(name);
    }
    await page.screenshot({ path: `${SHOTS}/account.png` });
  });

  test('signed-out and forced-password routes keep their guards', async ({ page }) => {
    await mockWorkspace(page, null);
    await page.goto(BASE + '/gallery');
    await expect(page).toHaveURL(BASE + '/');
    await expect(page.locator('.workspace-shell')).toHaveCount(0);
    await page.route('**/api/auth/me', route => route.fulfill({ json: { ...USER, mustChangePassword: true } }));
    await page.goto(BASE + '/gallery');
    await expect(page.locator('.workspace-shell')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 242, 234)');
  });

  test('presentation and TV routes stay full-screen', async ({ page }) => {
    await mockWorkspace(page);
    for (const path of ['/present/win-board', '/tv/invalid-preview-token']) {
      await page.goto(BASE + path);
      await expect(page.locator('.workspace-shell')).toHaveCount(0);
      await expect(page.locator('.ws-sidebar')).toHaveCount(0);
    }
  });
});

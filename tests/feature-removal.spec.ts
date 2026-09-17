import { test, expect } from '@playwright/test';
import { mockDashboards, templates } from './fixtures/dashboard-preview';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';

test.describe('Retired features and surviving TV flows', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });

  test('old bookmarks recover to the gallery without requesting retired APIs', async ({ page }) => {
    const { errors, requests } = await mockDashboards(page);
    for (const path of ['/charts/new', '/charts/old-chart/edit', '/dashboards/custom/old-board']) {
      await page.goto(BASE + path);
      await expect(page).toHaveURL(BASE + '/gallery');
      await expect(page.locator('.gl-card')).toHaveCount(templates.length);
      await expect(page.getByText('My dashboards', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Chart builder|Build a chart/ })).toHaveCount(0);
    }
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Where would you like to go?' });
    await page.getByRole('textbox', { name: 'Search dashboards and pages' }).fill('chart builder');
    await expect(dialog.getByRole('status')).toContainText('No matches');
    expect(requests.some(path => /custom-dashboards|^\/charts/.test(path))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('old custom favorites disappear while built-in favorites persist', async ({ page }) => {
    await mockDashboards(page);
    await page.addInitScript(() => localStorage.setItem('testmu-workspace-favorites-71', JSON.stringify([
      '/dashboards/custom/old-board', '/dashboard/event-analytics',
    ])));
    await page.goto(BASE + '/gallery');
    const starred = page.getByRole('group', { name: 'Filter dashboards' }).getByRole('button', { name: /Starred/ });
    await expect(starred).toHaveText('Starred1');
    await starred.click();
    await expect(page.locator('.gl-card')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Open Event Analytics', exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/dashboards/custom/"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Unstar Event Analytics', exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('testmu-workspace-favorites-71')!))).toEqual([]);
  });

  test('built-in TV links can still be copied and revoked from Account', async ({ page }) => {
    const { errors } = await mockDashboards(page);
    const requests: { method: string; body: unknown }[] = [];
    let created = false, revoked = false;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/share-tokens', async route => {
      const method = route.request().method();
      if (method === 'POST') {
        requests.push({ method, body: route.request().postDataJSON() });
        created = true;
        return route.fulfill({ status: 201, json: { id: 'tv-preview', token: 'synthetic-tv-link', templateKey: 'win-board' } });
      }
      return route.fulfill({ json: { items: created ? [{ id: 'tv-preview', templateKey: 'win-board', dashboardName: 'Win Board', createdAt: '2026-09-14T00:00:00Z', revokedAt: revoked ? '2026-09-14T01:00:00Z' : null }] : [] } });
    });
    await page.route('**/api/share-tokens/tv-preview', route => {
      requests.push({ method: route.request().method(), body: null });
      revoked = true;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto(BASE + '/present/win-board');
    await page.getByRole('button', { name: 'Copy TV link', exact: true }).click();
    await expect(page.getByRole('button', { name: /TV link copied/ })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(BASE + '/tv/synthetic-tv-link');
    expect(requests).toEqual([{ method: 'POST', body: { templateId: 'win-board' } }]);
    await page.goto(BASE + '/account?section=tv');
    await expect(page.locator('.account-table:visible')).toContainText('Win Board');
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('dialog', { name: 'Revoke this TV link?' }).getByRole('button', { name: 'Revoke link', exact: true }).click();
    await expect(page.locator('.account-table:visible')).toContainText('revoked');
    expect(requests.at(-1)?.method).toBe('DELETE');
    expect(errors).toEqual([]);
  });

  test('a TV shows its template without login and removes it when the token is revoked', async ({ page }) => {
    const { errors } = await mockDashboards(page);
    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Signed out' } }));
    let revoked = false;
    await page.route('**/api/share/resolve', route => {
      expect(route.request().headers()['x-share-token']).toBe('synthetic-tv-link');
      return revoked ? route.fulfill({ status: 401, json: { error: 'This share link is invalid, revoked, or expired.' } }) : route.fulfill({ json: { templateKey: 'win-board' } });
    });
    await page.clock.install();
    await page.goto(BASE + '/tv/synthetic-tv-link');
    await expect(page.locator('.presentation-shell')).toBeVisible();
    await expect(page.locator('.presentation-shell canvas').first()).toBeVisible();
    await expect(page.locator('.workspace-shell')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy TV link', exact: true })).toHaveCount(0);
    revoked = true;
    await page.clock.runFor(60_100);
    await expect(page.getByRole('heading', { name: 'This display link is not active' })).toBeVisible();
    await expect(page.locator('.presentation-shell')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  for (const view of ['product-pipeline', 'product-won']) {
    test(`Product TV preserves the saved ${view} view`, async ({ page }) => {
      const { errors } = await mockDashboards(page);
      await page.route('**/api/share/resolve', route => route.fulfill({ json: { templateKey: 'product-view' } }));
      await page.route('**/api/dashboards/product-view/state', route => route.fulfill({ json: { presentationSettings: { view } } }));
      await page.goto(BASE + '/tv/synthetic-product-link');
      await expect(page.locator('.presentation-shell')).toBeVisible();
      await expect(page.locator('.presentation-view-label')).toContainText(view === 'product-won' ? 'Won' : 'Pipeline');
      await expect(page.locator('.workspace-shell')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});

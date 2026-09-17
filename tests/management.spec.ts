import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SHOTS = '.playwright/management';
const USER = { id: 91, name: 'Harsh Baliyan', email: 'workspace@example.com', role: 'admin', mustChangePassword: false };
const SOURCES = [
  { id: 1, name: 'Revenue operations', sourceType: 'tableau_datasource', status: 'loaded', rowCount: 18420, dashboards: ['win-board', 'opportunity-analytics'], lastSync: '2026-09-09T04:10:00Z' },
  { id: 2, name: 'Customer success.csv', sourceType: 'csv', status: 'loaded', rowCount: 1250, dashboards: ['tenant-health'], lastSync: '2026-09-08T14:00:00Z' },
  { id: 3, name: 'Quarterly forecast', sourceType: 'tableau_view', status: 'error', rowCount: 300, dashboards: [], lastSync: null },
];
const USERS = [
  { ...USER, displayName: USER.name, status: 'active', lastLoginAt: '2026-09-09T04:10:00Z' },
  { id: 92, displayName: 'Aditi Sharma', email: 'aditi@example.com', role: 'user', status: 'active', lastLoginAt: '2026-09-08T04:10:00Z' },
  { id: 93, displayName: 'Morgan Lee', email: 'morgan@example.com', role: 'user', status: 'disabled', lastLoginAt: null },
];
const PREVIEW = { stagingId: 'preview-1', filename: 'revenue.csv', rowCount: 2, headers: ['Region', 'Revenue'], fields: [{ key: 'region', label: 'Region', group: 'essential' }, { key: 'arr', label: 'ARR', group: 'essential' }], previewRows: [{ Region: 'AMER', Revenue: 1200 }, { Region: 'EMEA', Revenue: 900 }], samples: { Region: ['AMER', 'EMEA'], Revenue: [1200, 900] }, fieldMapping: { region: 'Region', arr: 'Revenue' }, sourceType: 'upload', groups: [{ key: 'essential', label: 'Essential fields' }] };
const LOGS = Array.from({ length: 43 }, (_, i) => ({ id: i + 1, createdAt: new Date(Date.UTC(2026, 8, 9, 4, i)).toISOString(), email: i % 2 ? 'aditi@example.com' : USER.email, action: i % 2 ? 'source.refresh' : 'auth.login', entityType: i % 2 ? 'Revenue operations' : 'Session' }));

async function mockManagement(page: Page, options: { sources?: typeof SOURCES; role?: string } = {}) {
  const writes: { method: string; path: string; body: any }[] = [];
  let sources = [...(options.sources || SOURCES)];
  let users = [...USERS];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('testmu-theme', 'light'));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    const method = request.method();
    let body: any = null;
    try { body = request.postDataJSON(); } catch { /* multipart */ }
    if (method !== 'GET') writes.push({ method, path, body });
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === '/auth/me') return json({ ...USER, role: options.role || 'admin' });
    if (path === '/auth/config') return json({ googleClientId: null, selfSignupEnabled: false });
    if (path === '/templates') return json([{ id: 'win-board', name: 'Win Board', tags: [] }, { id: 'opportunity-analytics', name: 'Opportunity Analytics', tags: [], fields: ['region', 'arr'] }]);
    if (path === '/datasources') return json({ sources });
    if (path === '/datasources/1' && method === 'DELETE') { sources = sources.filter(source => source.id !== 1); return json({ ok: true }); }
    if (path === '/datasources/1/remap') return json({ ...PREVIEW, sourceId: 1, dashboards: ['win-board', 'opportunity-analytics'] });
    if (path === '/datasources/staged') return json({ staged: false });
    if (path === '/datasources/sync-history') return json({ runs: [{ id: 1, sourceName: SOURCES[0].name, status: 'success', rowsRead: 18420, startedAt: '2026-09-09T04:10:00Z' }] });
    if (path === '/datasources/upload/batch-preview') return json({ items: [PREVIEW] });
    if (path === '/datasources/tableau/status') return json({ connected: false });
    if (path === '/datasources/tableau/connect') return json({ server: body.server, site: body.siteId });
    if (path === '/datasources/tableau/datasources') return json({ datasources: [] });
    if (path === '/admin/users' && method === 'GET') return json({ items: users });
    if (path === '/admin/users' && method === 'POST') { users.push({ ...USERS[1], id: 94, displayName: body.name, email: body.email }); return json({ user: { email: body.email }, temporaryPassword: 'Synthetic-test-password-only' }); }
    if (path === '/admin/users/92' && method === 'DELETE') { users = users.filter(user => user.id !== 92); return json({ ok: true }); }
    if (path === '/auth/change-password') return json({ otherSessionsSignedOut: 2 });
    if (path === '/share-tokens') return json({ items: [] });
    if (path === '/admin/logs') return json({ items: url.searchParams.get('type') === 'errors' ? [{ id: 100, createdAt: '2026-09-09T04:10:00Z', route: '/datasources/3/refresh', errorCode: 'source_unavailable', message: 'Quarterly forecast could not be refreshed.' }] : LOGS });
    return json({ items: [], sources: [], runs: [] });
  });
  return { writes, errors };
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
const shot = async (page: Page, name: string) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test.describe('Workspace management', () => {
  test.use({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });

  test('source search, status filters, contextual actions and confirmation', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/data-sources');
    await expect(page.locator('.ux-sources-card tbody tr')).toHaveCount(3);
    await shot(page, 'sources-desktop');
    await page.getByRole('searchbox', { name: 'Search connected sources' }).fill('quarterly');
    await expect(page.locator('.ux-sources-card tbody tr')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Filter source status' }).selectOption('loaded');
    await expect(page.getByText('No sources match these filters.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search connected sources' }).fill('');
    await page.getByRole('combobox', { name: 'Filter source status' }).selectOption('all');
    const actions = page.getByRole('button', { name: 'Actions for Revenue operations' });
    await actions.click();
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Edit mapping', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    await expect(actions).toBeFocused();
    await actions.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Revenue operations?' });
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await shot(page, 'source-confirmation');
    await page.keyboard.press('Escape');
    expect(writes).toEqual([]);
    await actions.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete source', exact: true }).click();
    await expect(page.locator('.ux-sources-card tbody tr')).toHaveCount(2);
    expect(writes.map(write => `${write.method} ${write.path}`)).toEqual(['DELETE /datasources/1']);
    await noOverflow(page);
    expect(errors).toEqual([]);
  });

  test('upload validates files before preview and mapping', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/data-sources?view=add');
    await expect(page.getByRole('button', { name: /Drop a file here/ })).toBeVisible();
    await shot(page, 'source-upload');
    await page.locator('input[type=file]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('invalid file') });
    await expect(page.getByRole('alert')).toContainText('Choose a CSV');
    expect(writes).toEqual([]);
    await page.locator('input[type=file]').setInputFiles({ name: 'revenue.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue\nAMER,1200\nEMEA,900') });
    await expect(page.getByRole('region', { name: 'Uploaded source preview' })).toContainText('AMER');
    await page.getByRole('button', { name: /Map fields/ }).first().click();
    await expect(page.locator('.mapping-card')).toBeVisible();
    await shot(page, 'source-mapping');
    expect(writes[0].path).toBe('/datasources/upload/batch-preview');
    expect(writes.every(write => ['/datasources/upload/batch-preview', '/datasources/preview/rows'].includes(write.path))).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('Tableau fields have labels and submit with Enter', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/data-sources?view=add');
    await page.getByRole('button', { name: /Connect Tableau Published/ }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
    await page.getByLabel('Server URL', { exact: true }).fill('https://example.tableau.com');
    await page.getByLabel('Site ID', { exact: true }).fill('analytics');
    await page.getByLabel('Token name', { exact: true }).fill('test-token');
    await page.getByLabel('Token secret', { exact: true }).fill('synthetic-only');
    await shot(page, 'tableau-connect');
    await page.getByLabel('Token secret', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Connected', exact: true })).toBeVisible();
    expect(writes).toContainEqual({ method: 'POST', path: '/datasources/tableau/connect', body: { server: 'https://example.tableau.com', siteId: 'analytics', patName: 'test-token', patSecret: 'synthetic-only' } });
    expect(errors).toEqual([]);
  });

  test('source failures can retry and empty views link to a connection flow', async ({ page }) => {
    await mockManagement(page, { sources: [] });
    let failing = true;
    await page.route('**/api/datasources', route => failing ? route.fulfill({ status: 500, json: { error: 'Unavailable' } }) : route.fallback());
    await page.goto(BASE + '/data-sources');
    await expect(page.getByRole('alert')).toContainText('couldn’t be loaded');
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Bring your data into the workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Add data source', exact: true }).first().click();
    await expect(page).toHaveURL(/view=add/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Upload files' })).toBeVisible();
  });

  test('account sections retain forms, validate passwords and persist navigation', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/account');
    await expect(page.getByRole('heading', { name: USER.name })).toBeVisible();
    await page.getByLabel('Current password', { exact: true }).fill('current-synthetic-password');
    await page.getByRole('button', { name: 'TV share links', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No TV links yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Profile & security', exact: true }).click();
    await expect(page.getByLabel('Current password', { exact: true })).toHaveValue('current-synthetic-password');
    await page.getByLabel('New password', { exact: true }).fill('new-synthetic-password');
    await page.getByLabel('Confirm new password', { exact: true }).fill('different-synthetic-password');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('alert')).toContainText('do not match');
    expect(writes).toEqual([]);
    await page.getByLabel('Confirm new password', { exact: true }).fill('new-synthetic-password');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('status')).toContainText('2 other sessions');
    await shot(page, 'account-profile');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.locator('.ux-appearance').getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await shot(page, 'account-dark');
    await noOverflow(page);
    expect(errors).toEqual([]);
  });

  test('team search, invitation and removal use existing account APIs', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/account?section=team');
    await expect(page.locator('.account-table:visible tbody tr')).toHaveCount(3);
    await shot(page, 'account-team');
    await page.getByRole('searchbox', { name: 'Search team' }).fill('aditi');
    await expect(page.locator('.account-table:visible tbody tr')).toHaveCount(1);
    const actions = page.getByRole('button', { name: 'Actions for aditi@example.com' });
    await actions.click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(writes).toEqual([]);
    await actions.click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove person' }).click();
    await expect(page.getByText('No people match your search.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search team' }).fill('');
    await page.getByRole('button', { name: 'Add person' }).click();
    await page.getByLabel('Full name', { exact: true }).fill('Alex Chen');
    await page.getByLabel('Work email', { exact: true }).fill('alex@example.com');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary password for alex@example.com');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText('Synthetic-test-password-only')).toHaveCount(0);
    expect(writes.map(write => `${write.method} ${write.path}`)).toEqual(['DELETE /admin/users/92', 'POST /admin/users']);
    expect(errors).toEqual([]);
  });

  test('member account excludes team access', async ({ page }) => {
    const { writes } = await mockManagement(page, { role: 'user' });
    await page.goto(BASE + '/account?section=team');
    await expect(page.getByRole('button', { name: 'Team members' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
    expect(writes).toEqual([]);
  });

  test('activity logs paginate, search, sort and retry without changing data', async ({ page }) => {
    const { writes, errors } = await mockManagement(page);
    await page.goto(BASE + '/admin/logs');
    await expect(page.locator('.ux-log-table tbody tr')).toHaveCount(20);
    await expect(page.locator('.ux-log-table time').first()).toHaveAttribute('datetime', LOGS[42].createdAt);
    await shot(page, 'logs-desktop');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.ux-pagination')).toContainText('21–40');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.ux-log-table tbody tr')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Log order' }).selectOption('oldest');
    await expect(page.locator('.ux-log-table time').first()).toHaveAttribute('datetime', LOGS[0].createdAt);
    await page.getByRole('searchbox', { name: 'Search logs' }).fill('no such record');
    await expect(page.getByRole('heading', { name: 'No matching records' })).toBeVisible();
    await page.getByRole('button', { name: 'Errors', exact: true }).click();
    await expect(page.locator('.ux-log-table')).toContainText('source_unavailable');
    await page.getByRole('button', { name: 'Clear older records', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(writes).toEqual([]);
    let failing = true;
    await page.route('**/api/admin/logs?*', route => failing ? route.fulfill({ status: 500, json: { error: 'Temporary log failure' } }) : route.fallback());
    await page.getByRole('button', { name: 'Refresh logs', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary log failure');
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  for (const width of [320, 390, 820]) {
    test(`management at ${width}px stays within the viewport and menus remain reachable`, async ({ page }) => {
      const { errors } = await mockManagement(page);
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [['sources', '/data-sources'], ['team', '/account?section=team'], ['profile', '/account'], ['upload', '/data-sources?view=add'], ['logs', '/admin/logs']]) {
        await page.goto(BASE + path);
        await expect(page.locator('.ux-page h1')).toBeVisible();
        await noOverflow(page);
        await shot(page, `${name}-${width}`);
        if (name === 'sources' || name === 'team') {
          const trigger = page.getByRole('button', { name: name === 'sources' ? 'Actions for Revenue operations' : 'Actions for aditi@example.com' });
          await trigger.click();
          const popover = page.locator('.ux-action-popover:popover-open');
          await expect(popover).toBeVisible();
          const box = await popover.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          await page.keyboard.press('Escape');
        }
      }
      expect(errors).toEqual([]);
    });
  }
});

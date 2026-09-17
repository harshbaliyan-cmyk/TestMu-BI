/**
 * BDR Funnel board, rendered against a mocked API: no session, no server
 * writes. Checks the crosstab's shape, null rendering, sorting and that the
 * as-of control drives the request.
 *
 *   BASE_URL=http://localhost:5173 npx playwright test tests/bdr-funnel.spec.ts --reporter=list
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = '.playwright/baseline';
const USER = { id: 1, name: 'Synthetic Admin', email: 'synthetic@example.com', role: 'admin', mustChangePassword: false };

const row = (over: Record<string, unknown>) => ({
  userId: 'u', name: 'X', floorHitDate: '2026-06-02', firstMeetingDate: '2026-07-01', firstQualifiedMeetingDate: '2026-07-01',
  weeksMeasured: 16, accountsAssigned: 0, uniqueLeadsCalled: 315, meetingsGenerated: 6, meetingsRated: 2, qualifiedTotal: 2,
  avgLeadsPerWeek: 19.6875, leadsByDay30: 286, leadsByDay60: 315, leadsByDay90: 315, qualifiedByDay30: 1, qualifiedByDay60: 2, qualifiedByDay90: 2,
  ...over,
});
const SNAPSHOT = (asOf: string) => ({
  asOf,
  rows: [
    row({ userId: 'u-adamya', name: 'Adamya Veer' }),
    row({ userId: 'u-gauri', name: 'Gauri M', floorHitDate: null, firstMeetingDate: '2026-06-10', firstQualifiedMeetingDate: '2026-06-12',
      weeksMeasured: null, uniqueLeadsCalled: 0, meetingsGenerated: 11, meetingsRated: 4, qualifiedTotal: 1, avgLeadsPerWeek: null,
      leadsByDay30: 0, leadsByDay60: 0, leadsByDay90: 0, qualifiedByDay30: 0, qualifiedByDay60: 0, qualifiedByDay90: 0 }),
    row({ userId: 'u-saksham', name: 'Saksham Chandhok', accountsAssigned: 91, uniqueLeadsCalled: 3177, weeksMeasured: 29, avgLeadsPerWeek: 109.55 }),
  ],
  summary: { rowsScanned: 507000, bdrCount: 3, rosterSize: 31, unresolvedNames: ['Vibhuti Chadha'], totalUniqueLeadsCalled: 3492 },
});

async function mockApi(page: Page, requests: string[]) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/api/auth/me')) return json(USER);
    if (url.pathname.endsWith('/api/auth/config')) return json({ googleClientId: null, selfSignupEnabled: false });
    if (url.pathname.endsWith('/api/templates')) return json([{ id: 'bdr-funnel', name: 'BDR Funnel' }, { id: 'win-board', name: 'Win Board' }]);
    if (url.pathname.endsWith('/api/datasources')) return json({ sources: [] });
    if (url.pathname.endsWith('/api/bdr-funnel/snapshot')) {
      requests.push(url.search);
      return json(SNAPSHOT(url.searchParams.get('asOf') || '2026-09-16'));
    }
    return json({ items: [] });
  });
}

test.describe('BDR Funnel', () => {
  test.use({ viewport: { width: 1700, height: 1000 } });

  test('renders the seventeen-column crosstab with dashes for unmeasurable cells', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const requests: string[] = [];
    await mockApi(page, requests);
    await page.goto(BASE + '/dashboard/bdr-funnel');

    await expect(page.getByRole('heading', { level: 1, name: 'BDR Funnel' })).toBeVisible();
    const table = page.locator('.bdr-table');
    await expect(table.locator('thead th')).toHaveCount(17);
    await expect(table.locator('thead th').first()).toContainText('BDR Name');
    await expect(table.locator('thead th').nth(4)).toContainText('Weeks Measured');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    // Sorted by name A–Z by default.
    await expect(table.locator('tbody tr td:first-child')).toHaveText(['Adamya Veer', 'Gauri M', 'Saksham Chandhok']);

    const gauri = table.locator('tbody tr').nth(1);
    await expect(gauri.locator('td').nth(1)).toHaveText('—');   // no floor date
    await expect(gauri.locator('td').nth(4)).toHaveText('—');   // no weeks
    await expect(gauri.locator('td').nth(10)).toHaveText('—');  // no average
    await expect(gauri.locator('td').nth(7)).toHaveText('11');  // meetings still count
    const saksham = table.locator('tbody tr').nth(2);
    await expect(saksham.locator('td').nth(6)).toHaveText('3,177');
    await expect(saksham.locator('td').nth(10)).toHaveText('109.6');
    await expect(saksham.locator('td').nth(1)).toHaveText('6/2/2026');

    await expect(page.getByTestId('bdr-summary')).toContainText('3 of 31 rostered BDRs');
    await expect(page.getByTestId('bdr-summary')).toContainText('no data for Vibhuti Chadha');
    await page.screenshot({ path: `${SHOTS}/bdr_funnel.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test('the as-of date drives the request and sorting works on numbers and dates', async ({ page }) => {
    const requests: string[] = [];
    await mockApi(page, requests);
    await page.goto(BASE + '/dashboard/bdr-funnel');
    await expect(page.locator('.bdr-table tbody tr')).toHaveCount(3);
    expect(requests[0]).toMatch(/asOf=\d{4}-\d{2}-\d{2}/);

    // Dev-mode React runs the first effect twice, so count from the end, not the start.
    await page.locator('.bdr-asof input[type="date"]').fill('2026-09-01');
    await expect.poll(() => requests[requests.length - 1]).toContain('asOf=2026-09-01');
    await expect(page.getByTestId('bdr-summary')).toContainText('as of 9/1/2026');
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();

    await page.getByRole('columnheader', { name: /Unique Leads Called/ }).click();
    await expect(page.locator('.bdr-table tbody tr td:first-child')).toHaveText(['Saksham Chandhok', 'Adamya Veer', 'Gauri M']);
    await page.getByRole('columnheader', { name: /Floor Hit Date/ }).click();
    await page.getByRole('columnheader', { name: /Floor Hit Date/ }).click();
    // Ascending: the missing date sorts first.
    await expect(page.locator('.bdr-table tbody tr td:first-child').first()).toHaveText('Gauri M');
  });

  test('with nothing loaded it points at Data Sources', async ({ page }) => {
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.endsWith('/api/auth/me')) return json(USER);
      if (url.pathname.endsWith('/api/bdr-funnel/snapshot')) return json({ asOf: '2026-09-16', rows: [], summary: { rowsScanned: 0, bdrCount: 0, rosterSize: 31, unresolvedNames: [], totalUniqueLeadsCalled: 0 } });
      return json({ items: [], sources: [] });
    });
    await page.goto(BASE + '/dashboard/bdr-funnel');
    await expect(page.getByRole('heading', { name: 'No BDR Funnel data is loaded' })).toBeVisible();
    await page.getByRole('button', { name: 'Open data sources' }).click();
    await expect(page).toHaveURL(/\/data-sources$/);
  });
});

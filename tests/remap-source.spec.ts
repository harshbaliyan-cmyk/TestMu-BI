import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1600, height: 1000 } });

// "Edit mapping" on a connected source: the mapping panel opens on the
// source's own rows, a changed field is re-applied on commit, and the source
// keeps its identity (same id, same dashboards) instead of being replaced.
test('a connected source can be re-mapped in place from the Data Sources table', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const year = new Date().getFullYear();
  // Account ID is included because the mapping panel refuses to load while
  // either identity field is unmapped.
  const header = 'Opportunity ID,Account ID,Opportunity Name,Owner Name,Owner Alias,Opp Stage,Closed,Won,ARR,Opportunity Created Date,Opp Close Date,Region,Org Type';
  const rows = [
    `R1,A-1,Deal one,Riya,Alias-One,Closed Won,true,true,5000,${year}-01-01,${year}-01-20,EMEA,SMB`,
    `R2,A-2,Deal two,Dev,Alias-Two,Closed Lost,true,false,2000,${year}-01-01,${year}-01-25,APAC,SMB`,
    `R3,A-1,Deal three,Riya,Alias-One,Trial,false,false,1500,${year}-01-01,${year}-12-01,EMEA,SMB`,
  ];
  const { stagingId } = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'remap-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) } },
  })).json();
  const commit = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['opportunity-analytics'] },
  })).json();
  expect(commit.ok).toBeTruthy();
  const originalSourceId = commit.sourceId;

  // The board reads the auto-mapped Owner Name column first.
  await page.goto(BASE + '/dashboard/opportunity-analytics');
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await page.locator('nav.tabs button', { hasText: 'Rep Performance' }).click();
  await expect(page.locator('.card', { hasText: 'Owner scorecard' })).toContainText('Riya', { timeout: 15000 });

  // Open the mapping from the connected-sources table and point Owner at the alias column.
  await page.goto(BASE + '/data-sources');
  const row = page.locator('tr', { hasText: 'remap-e2e.csv' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit mapping' }).click();
  // Right after a boot the API is still re-pulling every saved Tableau
  // source, so a small request can queue behind a 50k-row parse.
  await expect(page.locator('.mapping-card')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.workflow-steps .active')).toContainText('Map fields');
  const ownerRow = page.locator('.mapping-field-row', { hasText: 'Owner Name' }).first();
  await expect(ownerRow).toContainText('Owner Name');
  await ownerRow.getByRole('button').click();
  await ownerRow.getByPlaceholder('Type to search columns…').fill('Owner Alias');
  await page.keyboard.press('Enter');
  await expect(ownerRow.getByRole('button')).toContainText('Owner Alias');
  await page.getByRole('button', { name: /Load \d+ rows/ }).click();
  await expect(page.locator('text=Loaded 3 rows')).toBeVisible({ timeout: 15000 });

  // Same source, same binding — re-mapped, not replaced.
  const { sources } = await (await page.request.get(`${BASE}/api/datasources`)).json();
  const mine = sources.filter((s: any) => s.name === 'remap-e2e.csv');
  expect(mine).toHaveLength(1);
  expect(mine[0].id).toBe(originalSourceId);
  expect(mine[0].dashboards).toEqual(['opportunity-analytics']);

  await page.goto(BASE + '/dashboard/opportunity-analytics');
  await page.locator('nav.tabs button', { hasText: 'Rep Performance' }).click();
  const scorecard = page.locator('.card', { hasText: 'Owner scorecard' });
  await expect(scorecard).toContainText('Alias-One', { timeout: 15000 });
  await expect(scorecard).not.toContainText('Riya');

  console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
  expect(consoleErrors).toEqual([]);

  // Tidy the shared DB.
  for (const source of mine) await page.request.delete(`${BASE}/api/datasources/${source.id}`);
});

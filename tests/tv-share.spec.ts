import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

test('a share token opens the board with no session, and revocation kills it', async ({ browser }) => {
  test.setTimeout(240000);

  // Owner session: sign in, seed data, mint a link.
  const owner = await browser.newContext();
  const page = await owner.newPage();
  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `TVSYN-${i}`, name: `TV Deal ${i}`, owner: 'Synthetic Rep', stage: i % 3 ? 'Closed Won' : 'Closed Lost',
    arr: 10000 + i * 500, amount: 12000, isClosed: true, isWon: Boolean(i % 3),
    createdDate: '2026-07-10', closeDate: '2026-08-01', region: 'AMER', orgType: 'SMB',
    pod: 'AE Corp', team: 'Team Falcon', industry: 'SaaS', type: 'New Business', ownerActive: true,
  }));
  const seed = await page.request.post(`${BASE}/api/data/win-board/load`, { data: rows });
  expect(seed.ok()).toBeTruthy();

  const created = await page.request.post(`${BASE}/api/share-tokens`, { data: { templateId: 'win-board', label: 'e2e test' } });
  expect(created.status()).toBe(201);
  const { token, id } = await created.json();
  expect(token).toBeTruthy();

  // Fresh context = the wall display: no cookies, no session.
  const wall = await browser.newContext();
  const tv = await wall.newPage();
  const consoleErrors: string[] = [];
  tv.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await tv.goto(`${BASE}/tv/${token}`, { waitUntil: 'networkidle' });
  await expect(tv.locator('.presentation-shell')).toBeVisible({ timeout: 30000 });
  await expect(tv.locator('.presentation-data-stamp')).toContainText('Data updated');
  await tv.screenshot({ path: '.playwright/baseline/tv_share_winboard.png' });
  console.log('TV console errors:', JSON.stringify(consoleErrors));

  // The token must not open any OTHER dashboard's data.
  const cross = await wall.request.get(`${BASE}/api/loss-board/snapshot`, { headers: { 'X-Share-Token': token } });
  expect(cross.status()).toBe(401);
  // ...and must not manage tokens.
  const manage = await wall.request.get(`${BASE}/api/share-tokens`, { headers: { 'X-Share-Token': token } });
  expect(manage.status()).toBe(401);

  // Revoke from the owner session; the wall's next load must be refused.
  const revoked = await page.request.delete(`${BASE}/api/share-tokens/${id}`);
  expect(revoked.ok()).toBeTruthy();
  await tv.reload({ waitUntil: 'networkidle' });
  await expect(tv.locator('.tv-share-error')).toBeVisible({ timeout: 20000 });
  await tv.screenshot({ path: '.playwright/baseline/tv_share_revoked.png' });

  await owner.close(); await wall.close();
});

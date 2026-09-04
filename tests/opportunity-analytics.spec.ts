import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';

test.use({ viewport: { width: 1920, height: 1080 } });

// Opportunity Analytics on the server snapshot. The seed uses the REAL
// source's column names ("Opp Stage", "Opp Amount", "ARR", "Team Role",
// "Days In Stage", "Stale Threshold", ...) so the auto-mapper path that the
// production source takes is the one exercised. Every $ must be ARR (never
// Opp Amount), the board must open on THIS YEAR by created date, and the
// wall must never print a currency figure or a day count.
//
//   W1  Closed Won   ARR 5000 (Amount 1250)  Riya  EMEA  SMB
//   W2  Closed Won   ARR 3000               Dev   APAC  Enterprise
//   L1  Closed Lost  ARR 2000  Not Responding          -> Disengaged family
//   L2  Closed Lost  ARR 1000  Price                   -> Competition or price
//   P1  Negotiation  ARR 4000  40 days vs 15 threshold, Deal Health Red -> stalled, at risk
//   P2  Trial        ARR 1500  5 days, no health       -> Not rated
//   OLD Closed Won   ARR 9999  created LAST year        -> outside the default scope
test('opportunity analytics: snapshot board, loss families, ARR-only money, amount-free wall', async ({ page }) => {
  test.setTimeout(240000);
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(process.env.AUDIT_EMAIL || '');
  await page.getByPlaceholder(/Password/).fill(process.env.AUDIT_PASSWORD || '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery');

  const year = new Date().getFullYear();
  const created = `${year}-01-01`, closeDate = `${year}-01-20`;
  // Geography comes from the raw Acc Continent (rolled up in-app); a blank
  // one must still count, as "No Continent".
  const header = 'Opportunity ID,Opportunity Name,Account Name,Account ID,Owner Name,Team Role,POD,Opp Stage,Closed,Won,Opp Amount,ARR,Opportunity Created Date,Opp Close Date,Cycle Days,Days In Stage,Stale Threshold,Deal Health,Org Type,Acc Continent,Industry,Deal Source,Opportunity Type,Loss Reason,Active';
  const rows = [
    `W1,Acme renewal,Acme,A-1,Riya,Account Executive,EMEA AE,Closed Won,true,true,1250,5000,${created},${closeDate},19,19,15,,SMB,Europe,Software,Inbound,New Business,,true`,
    `W2,Beta expansion,Beta,A-2,Dev,Account Manager,APAC AE,Closed Won,true,true,750,3000,${created},${closeDate},19,19,90,,Enterprise,Asia,Software,Outbound,New Business,,true`,
    `L1,Gamma pilot,Gamma,A-3,Riya,Account Executive,EMEA AE,Closed Lost,true,false,500,2000,${created},${closeDate},19,19,15,,SMB,Europe,Retail,Inbound,New Business,Not Responding,true`,
    `L2,Gamma second try,Gamma,A-3,Dev,Account Manager,APAC AE,Closed Lost,true,false,250,1000,${created},${closeDate},19,19,15,,SMB,,Retail,Inbound,New Business,Price,true`,
    `P1,Delta platform,Delta,A-4,Riya,Account Executive,EMEA AE,Negotiation,false,false,1000,4000,${created},${year}-12-01,,40,15,Red,SMB,Europe,Software,Inbound,New Business,,true`,
    `P2,Acme add-on,Acme,A-1,Dev,Account Manager,APAC AE,Trial,false,false,375,1500,${created},${year}-12-15,,5,15,,SMB,Oceania,Software,Inbound,New Business,,true`,
    `OLD,Last year deal,Omega,A-9,Riya,Account Executive,EMEA AE,Closed Won,true,true,2500,9999,${year - 1}-03-01,${year - 1}-04-01,31,31,15,,SMB,Europe,Software,Inbound,New Business,,true`,
  ];
  const { stagingId } = await (await page.request.post(`${BASE}/api/datasources/upload/preview`, {
    multipart: { file: { name: 'opportunity-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) } },
  })).json();
  const commit = await (await page.request.post(`${BASE}/api/datasources/upload/commit`, {
    data: { stagingId, templateIds: ['opportunity-analytics'] },
  })).json();
  expect(commit.ok).toBeTruthy();

  await page.goto(BASE + '/dashboard/opportunity-analytics');
  await expect(page.locator('h1')).toHaveText('Opportunity Analytics');
  await page.getByRole('button', { name: 'Reset all', exact: true }).click();
  await page.locator('nav.tabs button', { hasText: 'Pulse' }).click();

  // Default scope = this year by created date: OLD is out, six opps are in.
  // Match the tile LABEL exactly: "Win Rate" also appears in the Won ARR tile's footnote.
  const kpi = (label: string) => page.locator('.kpi', { has: page.locator('.lb', { hasText: new RegExp(`^${label}$`) }) });
  await expect(kpi('Total Opportunities')).toContainText('6', { timeout: 15000 });
  await expect(kpi('Open Opportunities')).toContainText('2');
  await expect(kpi('Win Rate')).toContainText('50.0%');
  // ARR, never Opp Amount: open 4000 + 1500, won 5000 + 3000, lost 2000 + 1000.
  await expect(kpi('Open ARR')).toContainText('$5.5K');
  await expect(kpi('Won ARR')).toContainText('$8.0K');
  await expect(kpi('Lost ARR')).toContainText('$3.0K');
  // Distinct won / lost opportunity counts ride along on the ARR tiles
  // (countd of Opportunity ID where the stage is Closed Won / Closed Lost).
  await expect(kpi('Won ARR')).toContainText('2 won');
  await expect(kpi('Lost ARR')).toContainText('2 lost');
  await expect(page.locator('.pv-highlight').first()).toContainText('50.0%');
  await expect(page.locator('.pv-scope strong')).toContainText(`Created 01 Jan ${String(year).slice(2)}`);

  // The date picker is portalled: a preset click must survive the
  // outside-click handler and re-scope the board. "Last 30 days" by created
  // date excludes every seed row (all created 1 Jan); "This year" brings
  // them back.
  await page.getByRole('button', { name: /Date range|Created .* –/ }).first().click();
  const picker = page.getByRole('dialog', { name: 'Date range' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Last 30 days' }).click();
  await expect(picker).toBeVisible();   // still open after the click
  await expect(kpi('Total Opportunities')).toContainText('0', { timeout: 15000 });
  await picker.getByRole('button', { name: 'This year' }).click();
  await expect(kpi('Total Opportunities')).toContainText('6', { timeout: 15000 });
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toBeHidden();

  // Diagnostics: the raw reason table carries the family, Red counts as at risk.
  await page.locator('nav.tabs button', { hasText: 'Diagnostics' }).click();
  await expect(kpi('At Risk — Red')).toContainText('1');
  await expect(page.locator('.pv-highlight').first()).toContainText('Disengaged / no decision');
  const reasonTable = page.locator('.card', { hasText: 'Loss reasons in full' });
  await expect(reasonTable).toContainText('Not Responding');
  await expect(reasonTable).toContainText('Competition or price');

  // Velocity: P1 is 40 days into a 15-day threshold.
  await page.locator('nav.tabs button', { hasText: 'Velocity' }).click();
  await expect(kpi('Stalled')).toContainText('1');
  await expect(page.locator('.card', { hasText: 'Stalled open deals' })).toContainText('Delta platform');

  // Rep performance: every owner is in; there is no Team role filter (removed by ruling).
  await page.locator('nav.tabs button', { hasText: 'Rep Performance' }).click();
  await expect(page.locator('.card', { hasText: 'Owner scorecard' })).toContainText('Riya');
  await expect(page.locator('.ms-trigger', { hasText: 'Team role' })).toHaveCount(0);

  // Geography is Continent Group: Europe → EMEA, Asia/Oceania → APAC, and
  // the blank on L2 is a selectable "No Continent" that keeps the row in.
  await page.locator('.ms-trigger', { hasText: 'Continent' }).click();
  for (const option of ['EMEA', 'APAC', 'No Continent']) await expect(page.locator('.ms-option', { hasText: option })).toBeVisible();
  await page.locator('.ms-option', { hasText: 'No Continent' }).locator('input').check();
  await page.keyboard.press('Escape');
  await page.locator('nav.tabs button', { hasText: 'Pulse' }).click();
  await expect(kpi('Total Opportunities')).toContainText('1', { timeout: 15000 });   // only L2
  await page.locator('.ms-trigger', { hasText: 'Continent' }).click();
  await page.locator('.ms-option', { hasText: 'No Continent' }).locator('input').uncheck();
  await page.keyboard.press('Escape');
  await expect(kpi('Total Opportunities')).toContainText('6', { timeout: 15000 });
  await page.screenshot({ path: '.playwright/baseline/opportunity_board.png', fullPage: true });

  // ===== The wall: counts, rates and names only =====
  await page.goto(BASE + '/present/opportunity-analytics');
  await expect(page.locator('.present-card').first()).toBeVisible({ timeout: 20000 });
  let sawOwnerName = false;
  for (let i = 0; i < 8; i++) {
    const text = await page.locator('main.presentation-shell').innerText();
    expect(text, `slide ${i + 1} carries a currency figure`).not.toMatch(/\$/);
    expect(text, `slide ${i + 1} carries a day count`).not.toMatch(/\b\d+\s?d(ays?)?\b/);
    expect(text).not.toContain('Delta platform');   // opportunity names stay off the wall
    if (text.includes('Riya')) sawOwnerName = true;  // owner names are allowed
    await page.getByRole('button', { name: 'Next slide' }).click();
  }
  expect(sawOwnerName, 'the rep slides should name owners').toBe(true);
  await page.screenshot({ path: '.playwright/baseline/opportunity_wall.png' });

  console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
  expect(consoleErrors).toEqual([]);

  // Tidy the shared DB.
  const { sources } = await (await page.request.get(`${BASE}/api/datasources`)).json();
  for (const source of sources.filter((s: any) => s.name === 'opportunity-e2e.csv')) {
    await page.request.delete(`${BASE}/api/datasources/${source.id}`);
  }
});

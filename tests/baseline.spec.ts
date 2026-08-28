/**
 * Route walkthrough + dead-code baseline.
 *
 * Logs in with the audit account, seeds a deterministic synthetic dataset into
 * that account's OWN in-memory scope (admin-only /api/data/:id/load dev
 * helper — nobody else's data is touched, and it vanishes on server restart),
 * then visits every route recording console errors, failed requests and a
 * screenshot per route.
 *
 * Output goes to .playwright/baseline/ (gitignored). Run it BEFORE a deletion
 * slice to capture the baseline, and again after to diff:
 *
 *   $env:AUDIT_EMAIL='...'; $env:AUDIT_PASSWORD='...'
 *   npx playwright test tests/baseline.spec.ts --reporter=list
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const EMAIL = process.env.AUDIT_EMAIL || '';
const PASSWORD = process.env.AUDIT_PASSWORD || '';
const OUT_DIR = path.resolve(__dirname, '..', '.playwright', 'baseline');

// ---- deterministic synthetic dataset (clearly labelled, never real) ----
const STAGES = ['Qualification', 'Demo', 'Trial', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const ORG_TYPES = ['SMB', 'Mid-Market', 'Enterprise'];
const PODS = ['AE Corp', 'AE Enterprise', 'AM', 'Others'];
const TEAMS = ['Team Falcon', 'Team Orion', 'Team Nova'];
const INDUSTRIES = ['SaaS', 'Fintech', 'Healthcare', 'Retail', 'No Industry'];
const PRODUCTS = ['Realtime', 'Web', 'Real Devices', 'HyperExecute'];
const SOURCES = ['Inbound', 'Outbound', 'Partner', 'Referral'];
const TYPES = ['New Business', 'Existing Business', 'Renewal'];
const OWNERS = ['Synthetic Rep A', 'Synthetic Rep B', 'Synthetic Rep C', 'Synthetic Rep D', 'Synthetic Rep E'];
const LOSS_REASONS = ['Price', 'Missing Feature', 'Competitor', 'No Budget', 'Disengaged'];
const HEALTH = ['Green', 'Amber', 'Red'];

function syntheticRows(n = 150) {
  const rows = [] as Record<string, unknown>[];
  for (let i = 0; i < n; i++) {
    const stage = STAGES[i % STAGES.length];
    const isClosed = stage.startsWith('Closed');
    const isWon = stage === 'Closed Won';
    const created = new Date(Date.UTC(2026, (i % 12), 1 + (i % 27)));
    const closed = new Date(created.getTime() + ((i % 90) + 5) * 86400000);
    const amount = 5000 + (i % 40) * 2500;
    const months = [12, 24, 36][i % 3];
    rows.push({
      id: `SYN-${1000 + i}`,
      name: `Synthetic Deal ${1000 + i}`,
      account: `Synthetic Account ${i % 30}`,
      accountId: `SYNACC-${i % 30}`,
      owner: OWNERS[i % OWNERS.length],
      ownerRole: PODS[i % PODS.length] === 'AM' ? 'Account Manager' : 'Enterprise Account Executive',
      stage,
      amount,
      arr: Math.round((amount / months) * 12),
      closeDate: isClosed ? closed.toISOString().slice(0, 10) : '',
      createdDate: created.toISOString().slice(0, 10),
      isClosed,
      isWon,
      orgType: ORG_TYPES[i % ORG_TYPES.length],
      region: REGIONS[i % REGIONS.length],
      regionDetail: REGIONS[i % REGIONS.length] === 'AMER' ? `AMER ${['I', 'II', 'III'][i % 3]}` : REGIONS[i % REGIONS.length],
      pod: PODS[i % PODS.length],
      team: TEAMS[i % TEAMS.length],
      industry: INDUSTRIES[i % INDUSTRIES.length],
      product: PRODUCTS[i % PRODUCTS.length],
      source: SOURCES[i % SOURCES.length],
      type: TYPES[i % TYPES.length],
      bdrName: i % 4 === 0 ? 'Synthetic BDR' : '',
      ownerActive: i % 7 !== 0,
      quotaCurrent: 250000,
      quotaPrior: 220000,
      trialArr: i % 5 === 0 ? Math.round(amount / 2) : null,
      trialStageAt: i % 5 === 0 ? created.toISOString().slice(0, 10) : null,
      subscriptionDuration: months,
      employees: [40, 500, 5000][i % 3],
      daysStuck: i % 100,
      cycleDays: isClosed ? (i % 90) + 5 : null,
      staleThreshold: { SMB: 15, 'Mid-Market': 30, Enterprise: 90 }[ORG_TYPES[i % ORG_TYPES.length]],
      isStalled: !isClosed && (i % 100) > 45,
      dealHealth: HEALTH[i % HEALTH.length],
      forecastCategory: ['Pipeline', 'Best Case', 'Commit', 'Closed'][i % 4],
      expectedRevenue: Math.round(amount * 0.5),
      lossReason: stage === 'Closed Lost' ? LOSS_REASONS[i % LOSS_REASONS.length] : '',
    });
  }
  return rows;
}

const ROUTES = [
  '/gallery',
  '/dashboard/opportunity-analytics',
  '/dashboard/event-analytics',
  '/dashboard/tenant-health',
  '/dashboard/win-board',
  '/dashboard/loss-board',
  '/dashboard/ae-performance',
  '/dashboard/am-performance',
  '/present/opportunity-analytics',
  '/present/win-board',
  '/present/loss-board',
  '/present/ae-performance',
  '/present/am-performance',
  '/data-sources',
  '/account',
  '/admin/logs',
];

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: 'serial' });

test('walk every route and record a baseline', async ({ page }) => {
  test.setTimeout(300000);
  expect(EMAIL, 'Set AUDIT_EMAIL / AUDIT_PASSWORD env vars').toBeTruthy();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Sign in through the real form.
  await page.goto(BASE + '/');
  await page.getByPlaceholder('Work email').fill(EMAIL);
  await page.getByPlaceholder(/Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/gallery', { timeout: 30000 });

  // Seed synthetic rows into this account's own in-memory scope.
  const rows = syntheticRows();
  for (const key of ['opportunity-analytics', 'event-analytics', 'tenant-health', 'win-board', 'loss-board', 'ae-performance', 'am-performance']) {
    const res = await page.request.post(`${BASE}/api/data/${key}/load`, { data: rows });
    expect(res.ok(), `seed ${key}: ${res.status()}`).toBeTruthy();
  }

  const report: Record<string, { finalUrl: string; consoleErrors: string[]; failedRequests: string[] }> = {};
  for (const route of ROUTES) {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const onConsole = (m: any) => { if (m.type() === 'error') consoleErrors.push(m.text()); };
    const onFailed = (req: any) => failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`);
    const onResponse = (res: any) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`); };
    page.on('console', onConsole); page.on('requestfailed', onFailed); page.on('response', onResponse);

    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const name = route.replace(/^\//, '').replace(/\//g, '_') || 'root';
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    report[route] = { finalUrl: page.url(), consoleErrors: [...consoleErrors], failedRequests: [...failedRequests] };
    console.log(`[${route}] url=${page.url()} consoleErrors=${consoleErrors.length} failed=${failedRequests.length}`);
    if (consoleErrors.length) console.log(`  errors: ${JSON.stringify(consoleErrors.slice(0, 5))}`);
    if (failedRequests.length) console.log(`  failed: ${JSON.stringify(failedRequests.slice(0, 5))}`);

    page.off('console', onConsole); page.off('requestfailed', onFailed); page.off('response', onResponse);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
});

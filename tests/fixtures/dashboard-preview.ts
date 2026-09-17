import type { Page } from '@playwright/test';
import { buildWinBoardSnapshot } from '../../server/services/winBoardMetrics.js';
import { buildLossBoardSnapshot } from '../../server/services/lossBoardMetrics.js';
import { buildAePerformanceSnapshot, isAmRow } from '../../server/services/aePerformanceMetrics.js';
import { buildProductPipelineSnapshot, buildProductWonSnapshot } from '../../server/services/productViewMetrics.js';
import { buildExecutiveSnapshot } from '../../server/services/executiveMetrics.js';
import { buildOpportunitySnapshot } from '../../server/services/opportunityMetrics.js';

export const templates = [
  ['win-board', 'Win Board'], ['loss-board', 'Loss Board'], ['ae-performance', 'AE Performance'],
  ['am-performance', 'AM Performance'], ['product-view', 'Product View'], ['executive-dashboard', 'Executive Dashboard'],
  ['opportunity-analytics', 'Opportunity Analytics'], ['event-analytics', 'Event Analytics'], ['tenant-health', 'Tenant Health'],
].map(([id, name]) => ({ id, name, tags: [] }));
const owners = ['Aditi Sharma', 'Daniel Kim', 'Morgan Lee', 'Riya Patel', 'Sam Rivera', 'Taylor Chen', 'Alex Morgan', 'Jordan Evans'];
const products = ['Kane AI (Web)', 'HyperExecute MultiOS', 'Real Device Live', 'Test Manager'];
const groups = ['KaneAI', 'HyperExecute', 'Real Device', 'Test Manager'];
const stages = ['Closed Won', 'Closed Lost', 'Trial', 'Negotiation', 'Demo', 'Closed Won', 'Closed Lost', 'Qualification'];
const year = new Date().getFullYear();
const month = new Date().getMonth();
const quarterStart = Math.floor(month / 3) * 3;
const date = (m: number, d = 4, y = year) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Synthetic rows exercise the real, pure snapshot builders. No API data is read or changed.
export const previewRows = Array.from({ length: 144 }, (_, i) => {
  const rep = i % 8, kind = Math.floor(i / 8) % stages.length;
  const stage = stages[kind], arr = (rep + 3) * 8200 + Math.floor(i / 8) * 350;
  const m = i < 80 ? quarterStart + i % (month - quarterStart + 1) : i % 12;
  const pod = rep < 4 ? ['AE AMER I', 'AE EMEA', 'AE APAC', 'AE AMER II'][rep] : ['AM AMER', 'AM EMEA', 'AM APAC', 'AM Saahil'][rep - 4];
  return {
    id: `preview-${i}`, name: `${['Acme', 'Atlas', 'Northstar', 'Meridian'][i % 4]} expansion ${i + 1}`,
    account: ['Acme', 'Atlas', 'Northstar', 'Meridian'][i % 4], accountId: `account-${i % 24}`,
    owner: owners[rep], userId: `rep-${rep}`, ownerRole: rep < 4 ? 'AE' : 'AM', ownerActive: true, oppActive: true,
    stage, isClosed: /Closed/.test(stage), isWon: stage === 'Closed Won', arr, amount: arr,
    subscriptionDuration: 12, totalPrice: arr, lineDuration: 12, productArr: arr,
    product: products[i % 4], productRaw: products[i % 4], productGroup: groups[i % 4],
    createdDate: date(m, 2), closeDate: date(m, 4), trialStageAt: date(m, 3),
    type: rep < 4 ? 'New Business' : 'New Business AM', region: ['AMER', 'EMEA', 'APAC'][i % 3],
    continentGroup: ['North America', 'Europe', 'Asia'][i % 3], orgType: i % 3 ? 'Enterprise' : 'SMB',
    pod, salesPod: pod, team: rep < 4 ? 'AE' : 'AM', industry: ['Technology', 'Finance', 'Retail', 'Healthcare'][i % 4],
    opportunityForecast: ['Commit', 'High', 'Low'][i % 3], quotaCurrent: 180000, quotaPrior: 150000,
    employees: i % 3 ? 5000 : 200, freeDomain: false, misRequired: i % 2 === 0,
    lossReason: ['Budget', 'Timing', 'Competition', 'No response'][i % 4], daysStuck: 5 + i % 32,
    dealHealth: ['Healthy', 'At Risk'][i % 2], cycleDays: 22 + i % 40, ageDays: 30 + i % 60,
  };
});
const fields = ['region', 'orgType', 'industry', 'type', 'productGroup', 'product', 'pod', 'stage', 'owner', 'continentGroup', 'team', 'opportunityForecast'];
const options = Object.fromEntries(fields.map(field => [field, [...new Set(previewRows.map(row => row[field]))]]));
export async function mockDashboards(page: Page, theme = 'light') {
  const errors: string[] = [], requests: string[] = [], writes: { method: string; path: string; body: any }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => localStorage.setItem('testmu-theme', theme), theme);
  const states: Record<string, any> = {};
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api', ''), method = request.method();
    requests.push(path);
    const body = request.postData() ? request.postDataJSON() : null;
    if (method !== 'GET') writes.push({ method, path, body });
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    const query = Object.fromEntries([...new Set(url.searchParams.keys())].map(key => [key, fields.includes(key) || key === 'segment' ? url.searchParams.getAll(key) : url.searchParams.get(key)]));
    if (path === '/auth/me') return json({ id: 71, name: 'Harsh Baliyan', email: 'preview@example.com', role: 'admin' });
    if (path === '/auth/config') return json({ googleClientId: null, selfSignupEnabled: false });
    if (path === '/templates') return json(templates);
    if (path === '/datasources') return json({ sources: [{ id: 1, name: 'Preview revenue', sourceType: 'csv', status: 'loaded', rowCount: previewRows.length, dashboards: templates.map(t => t.id) }] });
    if (path.startsWith('/options/')) return json(options);
    if (path.endsWith('/state')) { if (method === 'PUT') states[path] = body; return json(states[path] || {}); }
    if (path === '/win-board/snapshot') return json(buildWinBoardSnapshot(previewRows, query));
    if (path === '/loss-board/snapshot') return json(buildLossBoardSnapshot(previewRows, query));
    if (path === '/ae-performance/snapshot') return json(buildAePerformanceSnapshot(previewRows, query));
    if (path === '/am-performance/snapshot') return json(buildAePerformanceSnapshot(previewRows, query, { scope: isAmRow }));
    if (path === '/product-view/pipeline/snapshot') return json(buildProductPipelineSnapshot(previewRows, query));
    if (path === '/product-view/won/snapshot') return json(buildProductWonSnapshot(previewRows, query));
    if (path === '/executive-dashboard/snapshot') return json(buildExecutiveSnapshot(previewRows, query));
    if (path.endsWith('/snapshot')) return json(buildOpportunitySnapshot(previewRows, query));
    return json({ items: [] });
  });
  return { errors, requests, writes };
}

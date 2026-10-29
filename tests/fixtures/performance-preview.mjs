import { buildAePerformanceSnapshot, isAmRow } from '../../server/services/aePerformanceMetrics.js';

const today = new Date(), year = today.getFullYear(), quarter = Math.floor(today.getMonth() / 3) * 3;
const date = offset => new Date(year, quarter + offset, 5, 12).toISOString().slice(0, 10);
const aePods = ['AMER II', 'EMEA AE', 'AMER CORP', 'APAC AE', 'AMER III', 'GCC', 'AMER I'];
const amPods = ['AMER AM', 'APAC AM', 'EMEA AM'];
const names = ['HeeSan Lee', 'Soham Chakraborty', 'Madhusudan Laxmanrao', 'Prabhat Singh Bhadauriya', 'Ankit Bhaskar', 'Taylor Chen', 'Jordan Evans'];
export const performanceRows = ['AE', 'AM'].flatMap(role => Array.from({ length: role === 'AE' ? 24 : 12 }, (_, i) => {
  const pods = role === 'AE' ? aePods : amPods;
  const pod = pods[i % pods.length];
  return [0, -3].map(offset => ({
    id: `${role}-${i}-${offset}`, owner: i < names.length ? `${role === 'AM' ? 'AM ' : ''}${names[i]}` : `${role} Account Manager ${i + 1}`,
    ownerRole: role, pod, ownerActive: i !== 22,
    quotaCurrent: i === 23 ? null : 100000, quotaPrior: i === 23 ? null : 100000,
    arr: Math.max(0, (offset ? 112 - i * 6 : 241.2 - i * 12) * 1000),
    isWon: true, isClosed: true, stage: 'Closed Won',
    closeDate: date(offset), createdDate: date(offset),
    region: i % 2 ? 'EMEA' : 'AMER', orgType: 'Enterprise', type: 'New Business',
  }));
}).flat());

export function performanceSnapshot(role = 'AE', filters = {}) {
  return buildAePerformanceSnapshot(performanceRows, filters, role === 'AM' ? { scope: isAmRow } : {});
}

export async function mockPerformance(page, { theme = 'light', tableTops = {}, transform = snapshot => snapshot, signedOut = false, hiddenTiles = [], shareTemplate = 'ae-performance' } = {}) {
  const errors = [], requests = [], writes = [];
  const states = {};
  await page.addInitScript(theme => localStorage.setItem('testmu-theme', theme), theme);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api', '');
    requests.push({ path, method: request.method(), params: Object.fromEntries(url.searchParams) });
    const json = (value, status = 200) => route.fulfill({ status, json: value });
    if (path === '/auth/me') return signedOut ? json(null) : json({ id: 71, name: 'Workspace preview', email: 'preview@example.com', role: 'admin' });
    if (path === '/templates') return json([{ id: 'ae-performance', name: 'AE Performance' }, { id: 'am-performance', name: 'AM Performance' }]);
    if (path === '/auth/config') return json({ googleClientId: null, selfSignupEnabled: false });
    if (path.startsWith('/options/')) return json({ region: ['AMER', 'EMEA'], orgType: ['Enterprise'], type: ['New Business'] });
    if (path.endsWith('/state')) {
      if (request.method() === 'PUT') { states[path] = request.postDataJSON(); writes.push({ path, body: states[path] }); }
      return json(states[path] || { tableTops: { rep: 5, pod: 5, ...tableTops }, presentationSettings: { hiddenTiles } });
    }
    if (path.endsWith('/snapshot')) {
      const role = path.startsWith('/am-') ? 'AM' : 'AE';
      const filters = Object.fromEntries([...new Set(url.searchParams.keys())].map(key => [key, ['region', 'orgType', 'type'].includes(key) ? url.searchParams.getAll(key) : url.searchParams.get(key)]));
      return json(transform(performanceSnapshot(role, filters), role));
    }
    if (path === '/datasources') return json({ sources: [] });
    if (path === '/share/resolve') return json({ templateKey: shareTemplate });
    return json({ items: [] });
  });
  return { errors, requests, writes };
}

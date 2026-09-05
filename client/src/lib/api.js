import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

/* ---- Cold-start recovery -------------------------------------------------
 *
 * The API runs on Render's free plan, which stops the service after ~15
 * minutes idle. The next request has to boot it, which measured at 38.8s, and
 * Vercel's proxy gives up long before that and answers 502 with an HTML body.
 *
 * That HTML carries no `error` field, so every caller's
 * `error.response?.data?.error` fallback fired. On the login form the fallback
 * reads "Sign in failed." - which looks exactly like a rejected password. It
 * never was one: the server's audit log holds no login attempt at all for
 * those failures, because the request never reached the server.
 *
 * Retrying is the honest answer, since the request that failed is the one that
 * started the boot. Only gateway-level failures qualify - a 401, 403 or 429
 * from the application is an answer, not an outage, and replaying one would
 * spend another of the five login attempts allowed per 15 minutes.
 */
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 8;
const RETRY_DELAY_MS = 5000;

// Render's free tier sits behind Cloudflare, and Cloudflare sometimes serves
// a bot challenge ("Just a moment…", Cf-Mitigated: challenge, HTTP 429) to
// requests arriving via Vercel's shared proxy IPs — a challenge the
// server-to-server proxy can never solve. That 429 is infrastructure noise,
// not an application answer, and a retry usually sails through. It is
// distinguishable from OUR 429s (the auth throttle), which always carry a
// JSON {error} body: the challenge is an HTML page with no error field.
const isInfrastructure429 = response =>
  response?.status === 429 && !response?.data?.error;

// Replaying is only safe where running twice is harmless. GETs always are. The
// auth endpoints are listed because a gateway failure means no session was
// established, so signing in "again" costs nothing. Every other write stays
// off the list: a lost response is not proof the server did not act on it.
const REPLAY_SAFE_PATHS = new Set(['/auth/login', '/auth/verify', '/auth/config']);
const canReplay = config =>
  String(config?.method || 'get').toLowerCase() === 'get'
  || REPLAY_SAFE_PATHS.has(String(config?.url || ''));

// So the UI can say what is actually happening rather than show a spinner for
// the better part of a minute. Listeners get true when a wake starts and false
// once it finishes, either way.
const wakeListeners = new Set();
export function onApiWaking(listener) {
  wakeListeners.add(listener);
  return () => wakeListeners.delete(listener);
}
const announceWaking = waking => { for (const listener of wakeListeners) listener(waking); };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

api.interceptors.response.use(undefined, async error => {
  const config = error?.config;
  // No response at all is a dropped connection, which the same boot produces.
  const isGatewayFailure = !error?.response
    || GATEWAY_STATUSES.has(error.response.status)
    || isInfrastructure429(error.response);
  if (!config || !isGatewayFailure || !canReplay(config)) throw error;

  const attempt = (config.__retryCount || 0) + 1;
  config.__retryCount = attempt;
  if (attempt > MAX_RETRIES) { announceWaking(false); throw error; }

  announceWaking(true);
  await sleep(RETRY_DELAY_MS);
  try {
    const response = await api(config);
    announceWaking(false);
    return response;
  } catch (retryError) {
    // Only the attempt that gives up clears the flag. The ones in between are
    // still the same wake, still in progress.
    if (attempt >= MAX_RETRIES) announceWaking(false);
    throw retryError;
  }
});

export default api;

// ===== TV share links =====
// The /tv/:token wall route has no login session. Setting the token here makes
// every API call carry it in a header (never the query string — URLs end up in
// proxy logs), and the server scopes what it can read to one dashboard.
export function setShareToken(token) {
  if (token) api.defaults.headers.common['X-Share-Token'] = token;
  else delete api.defaults.headers.common['X-Share-Token'];
}

export const resolveShareToken = () => api.get('/share/resolve').then(r => r.data);

// ===== Chart builder =====
export const listDataSources = () => api.get('/datasources').then(r => r.data.sources);
// A full VDS re-pull, so this can run for tens of seconds on a big source.
export const refreshDataSource = sourceId => api.post(`/datasources/${sourceId}/refresh`).then(r => r.data);
export const getChartOptions = sourceId => api.get(`/charts/options/${sourceId}`).then(r => r.data);
export const previewChart = (sourceId, config) => api.post('/charts/preview', { sourceId, config }).then(r => r.data);
export const createChart = body => api.post('/charts', body).then(r => r.data);
export const inspectChart = body => api.post('/charts/inspect', body).then(r => r.data);
export const listCharts = () => api.get('/charts').then(r => r.data.items);
export const getChart = id => api.get(`/charts/${id}`).then(r => r.data);
export const getChartData = id => api.get(`/charts/${id}/data`).then(r => r.data);
export const updateChart = (id, body) => api.put(`/charts/${id}`, body).then(r => r.data);
export const deleteChart = id => api.delete(`/charts/${id}`).then(r => r.data);
export const createCustomDashboard = name => api.post('/custom-dashboards', { name }).then(r => r.data);
export const listCustomDashboards = () => api.get('/custom-dashboards').then(r => r.data.items);
export const getCustomDashboard = id => api.get(`/custom-dashboards/${id}`).then(r => r.data);
export const updateCustomDashboard = (id, body) => api.put(`/custom-dashboards/${id}`, body).then(r => r.data);
export const deleteCustomDashboard = id => api.delete(`/custom-dashboards/${id}`).then(r => r.data);
// target: a template key string, or { customDashboardId } for a custom board.
export const createTvLink = (target, options = {}) => api.post('/share-tokens',
  { ...(typeof target === 'string' ? { templateId: target } : target), ...options }).then(r => r.data);
export const listTvLinks = () => api.get('/share-tokens').then(r => r.data.items);
export const revokeTvLink = id => api.delete(`/share-tokens/${id}`).then(r => r.data);

export async function verifyGoogleToken(credential, intent = 'login') {
  const { data } = await api.post('/auth/verify', { credential, intent });
  return data;
}

export async function loginWithPassword(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function signupWithPassword(name, email, password) {
  const { data } = await api.post('/auth/signup', { name, email, password });
  return data;
}

export async function getAuthConfig() {
  const { data } = await api.get('/auth/config');
  return data;
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function logout() {
  await api.post('/auth/logout');
}

export async function getTemplates() {
  const { data } = await api.get('/templates');
  return data;
}

export async function getDashboardState(templateId) {
  const { data } = await api.get(`/dashboards/${templateId}/state`);
  return data;
}

export async function saveDashboardState(templateId, state) {
  const { data } = await api.put(`/dashboards/${templateId}/state`, state);
  return data;
}

export const listSavedViews = templateId => api.get(`/dashboards/${templateId}/saved-views`).then(r=>r.data.items);
export const createSavedView = (templateId, body) => api.post(`/dashboards/${templateId}/saved-views`,body).then(r=>r.data);
export const createSavedReport = (templateId, body) => api.post(`/dashboards/${templateId}/saved-reports`,body).then(r=>r.data);
export const getWinBoardMetrics = filters => api.get('/win-board/metrics', { params: filters, paramsSerializer: serializer }).then(r=>r.data);
export async function getWinBoardSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  try {
    return (await api.get('/win-board/snapshot',config)).data;
  } catch (error) {
    if(error.response?.status!==404)throw error;
    // Compatibility with a server process started before the snapshot route existed.
    // The page still commits the two responses together and discards stale requests.
    const [metrics,comparison]=await Promise.all([
      api.get('/win-board/metrics',config).then(response=>response.data),
      api.get('/comparison/win-board',config).then(response=>response.data),
    ]);
    return {metrics,comparison};
  }
}
export const getPeriodComparison = (templateId,filters) => api.get(`/comparison/${templateId}`, {params:filters,paramsSerializer:serializer}).then(r=>r.data);
// The generic six-tab board: one computed snapshot per filter state.
export const getOpportunitySnapshot = (templateId, filters) => api.get(`/dashboards/${templateId}/snapshot`, {params:filters,paramsSerializer:serializer}).then(r=>r.data);
// Product View: one template, two independently-filtered views.
export const getProductPipelineSnapshot = filters => api.get('/product-view/pipeline/snapshot', {params:filters,paramsSerializer:serializer}).then(r=>r.data);
export const getProductWonSnapshot = filters => api.get('/product-view/won/snapshot', {params:filters,paramsSerializer:serializer}).then(r=>r.data);
export const getExecutiveSnapshot = filters => api.get('/executive-dashboard/snapshot', {params:filters,paramsSerializer:serializer}).then(r=>r.data);
export async function getLossBoardSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  return (await api.get('/loss-board/snapshot',config)).data;
}
export async function getAePerformanceSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  return (await api.get('/ae-performance/snapshot',config)).data;
}
// AM Performance is the same board scoped to AM PODs; it shares the snapshot
// shape exactly, so both pages read the identical payload.
export async function getAmPerformanceSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  return (await api.get('/am-performance/snapshot',config)).data;
}


const serializer = {
  serialize: (params) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(x => x && sp.append(k, x));
      else if (v) sp.append(k, v);
    });
    return sp.toString();
  },
};

export const getData = (templateId, filters = {}) =>
  api.get(`/data/${templateId}`, { params: filters, paramsSerializer: serializer })
     .then(r => r.data);

export const getOptions = (templateId, filters = {}) =>
  api.get(`/options/${templateId}`, { params: filters, paramsSerializer: serializer })
     .then(r => r.data);

// ===== Account and user administration =====
export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
  return data;
}
export async function listUsers() {
  const { data } = await api.get('/admin/users');
  return data.items;
}
export async function inviteUser(payload) {
  const { data } = await api.post('/admin/users', payload);
  return data;
}
export async function updateUserAccess(id, patch) {
  const { data } = await api.patch(`/admin/users/${id}`, patch);
  return data;
}
export async function resetUserPassword(id) {
  const { data } = await api.post(`/admin/users/${id}/reset-password`);
  return data;
}
export async function deleteMyAccount(confirmEmail, currentPassword) {
  const { data } = await api.delete('/auth/account', { data: { confirmEmail, currentPassword } });
  return data;
}
export async function deleteUser(id) {
  const { data } = await api.delete(`/admin/users/${id}`);
  return data;
}

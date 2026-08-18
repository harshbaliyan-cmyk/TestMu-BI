import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export default api;

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
export async function getLossBoardSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  return (await api.get('/loss-board/snapshot',config)).data;
}
export async function getAePerformanceSnapshot(filters) {
  const config={params:filters,paramsSerializer:serializer};
  return (await api.get('/ae-performance/snapshot',config)).data;
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

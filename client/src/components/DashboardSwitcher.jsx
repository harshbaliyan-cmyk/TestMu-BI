import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTemplates } from '../hooks/useTemplates';
import { listCustomDashboards } from '../lib/api';

// One jump-anywhere control for every board's top nav: the five template
// boards, the user's custom dashboards, and the utility pages. Value tracks
// the current route so the select doubles as "where am I".
export default function DashboardSwitcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { templates } = useTemplates();
  const [custom, setCustom] = useState([]);

  useEffect(() => { listCustomDashboards().then(setCustom).catch(() => {}); }, []);

  const known = new Set([
    ...templates.map(t => `/dashboard/${t.id}`),
    ...custom.map(d => `/dashboards/custom/${d.id}`),
    '/gallery', '/data-sources', '/charts/new',
  ]);

  return <select className="dashboard-switcher" aria-label="Go to dashboard"
    value={known.has(pathname) ? pathname : ''}
    onChange={e => { if (e.target.value) navigate(e.target.value); }}>
    <option value="" disabled>Go to…</option>
    <optgroup label="Boards">
      {templates.map(t => <option key={t.id} value={`/dashboard/${t.id}`}>{t.name}</option>)}
    </optgroup>
    {custom.length > 0 && <optgroup label="My dashboards">
      {custom.map(d => <option key={d.id} value={`/dashboards/custom/${d.id}`}>{d.name}</option>)}
    </optgroup>}
    <optgroup label="More">
      <option value="/gallery">Gallery</option>
      <option value="/charts/new">Chart builder</option>
      <option value="/data-sources">Data sources</option>
    </optgroup>
  </select>;
}

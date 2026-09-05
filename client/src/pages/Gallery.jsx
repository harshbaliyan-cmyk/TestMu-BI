import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher, { hueFor } from '../components/DashboardSwitcher';
import MiniViz, { VIZ_BY_TEMPLATE } from '../components/MiniViz';
import { useTemplates } from '../hooks/useTemplates';
import { listCustomDashboards, createCustomDashboard, listDataSources } from '../lib/api';

// The gallery renders whatever the server registers. It used to keep its own
// copy of this list, which meant a new dashboard had to be added in two places
// and silently went missing from one of them.

const greetingFor = hour => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

// A custom dashboard's saved layout, drawn as it is: twelve columns, one
// block per tile at its real x/y/w/h. Nothing to invent, nothing to keep in
// sync with the grid page.
function LayoutPreview({ layout }) {
  const tiles = Array.isArray(layout) ? layout.filter(t => Number.isFinite(+t.w) && Number.isFinite(+t.h)) : [];
  if (!tiles.length) {
    return (
      <div className="gl-layout is-empty" aria-hidden="true">
        <i style={{ gridColumn: '1 / span 6', gridRow: '1 / span 6' }} />
        <i style={{ gridColumn: '7 / span 6', gridRow: '1 / span 6' }} />
        <i style={{ gridColumn: '1 / span 12', gridRow: '7 / span 5' }} />
      </div>
    );
  }
  return (
    <div className="gl-layout" aria-hidden="true">
      {tiles.map((t, i) => (
        <i key={t.chartId ?? i} style={{ gridColumn: `${+t.x + 1} / span ${+t.w}`, gridRow: `${+t.y + 1} / span ${+t.h}`, '--i': i }} />
      ))}
    </div>
  );
}

function pressable(go) {
  return {
    role: 'link', tabIndex: 0, onClick: go,
    onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } },
  };
}

export default function Gallery({ user }) {
  const { templates: TEMPLATES } = useTemplates();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [custom, setCustom] = useState([]);
  // null = not known yet; the stat stays hidden rather than showing a zero
  // that may be a failed request.
  const [sourceCount, setSourceCount] = useState(null);
  // Shape animations run from a mount-time class switch, not from first
  // paint, so the bars visibly grow rather than appearing already grown.
  const [live, setLive] = useState(false);

  useEffect(() => { listCustomDashboards().then(setCustom).catch(() => {}); }, []);
  useEffect(() => { listDataSources().then(list => setSourceCount(Array.isArray(list) ? list.length : null)).catch(() => {}); }, []);
  useEffect(() => { const id = requestAnimationFrame(() => setLive(true)); return () => cancelAnimationFrame(id); }, []);

  const newDashboard = async () => {
    const name = window.prompt('Name the new dashboard');
    if (!name?.trim()) return;
    try {
      const created = await createCustomDashboard(name.trim());
      navigate(`/dashboards/custom/${created.id}`);
    } catch { /* the gallery stays; nothing was created */ }
  };

  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="wrap gallery">
      <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
        <div className="brand">
          <img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" />
          <span>TestMu BI</span>
        </div>
        <div className="user-pill">
          <ThemeToggle />
          <DashboardSwitcher />
          {user?.role === 'admin' && <button className="btn-secondary" onClick={() => navigate('/admin/logs')}>Logs</button>}
          <button className="btn-secondary" onClick={() => navigate('/account')}>Account</button>
          <span>{user?.name || 'User'}</span>
          <button className="btn-secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <header className="gl-hero">
        <div>
          <p className="gl-hero-eyebrow">{today}</p>
          <h1>{greetingFor(new Date().getHours())}, {firstName}.</h1>
          <p>Your boards read the sources you connected. Nobody else's.</p>
        </div>
        <dl className="gl-stats" aria-label="Your workspace">
          <div className="gl-stat"><dt>Custom dashboards</dt><dd>{custom.length}</dd></div>
          <div className="gl-stat"><dt>Templates</dt><dd>{TEMPLATES.length}</dd></div>
          {sourceCount !== null && <div className="gl-stat"><dt>Sources connected</dt><dd>{sourceCount}</dd></div>}
        </dl>
      </header>

      <div className="gallery-header">
        <h2>My Dashboards</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-secondary" onClick={() => navigate('/charts/new')}>Build a chart</button>
          <button className="btn-primary" onClick={newDashboard}>New dashboard</button>
        </div>
      </div>

      <div className={`template-grid gl-grid${live ? ' is-in' : ''}`}>
        {custom.map((dashboard, i) => {
          const hue = hueFor(dashboard.name);
          const count = (dashboard.layout || []).length;
          return (
            <div key={dashboard.id} className="template-card gl-card" style={{ '--accent': `hsl(${hue} 84% 58%)`, '--i': i }}
              {...pressable(() => navigate(`/dashboards/custom/${dashboard.id}`))} aria-label={`Open ${dashboard.name}`}>
              <div className="gl-card-viz"><LayoutPreview layout={dashboard.layout} /></div>
              <div className="template-info">
                <div className="gl-card-head"><h3>{dashboard.name}</h3><span className="gl-open" aria-hidden="true">Open →</span></div>
                <p>{count} chart{count === 1 ? '' : 's'}{dashboard.updatedAt ? ` · edited ${new Date(dashboard.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</p>
                <div className="tags"><span className="tag">Custom</span></div>
              </div>
            </div>
          );
        })}
        <div className="template-card gl-card gl-create gallery-empty-card" {...pressable(newDashboard)} aria-label="New dashboard">
          <span className="gl-create-plus" aria-hidden="true">+</span>
          <div className="template-info">
            <h3>Assemble your own</h3>
            <p>Pick a dataset, build charts, and arrange them on a grid — no blank canvas, the fields suggest themselves.</p>
          </div>
        </div>
      </div>

      <div className="gallery-header">
        <h2>Dashboard Templates</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="gl-count">{TEMPLATES.length} available</span>
          <button className="btn-primary" onClick={() => navigate('/data-sources')}>Connect data</button>
        </div>
      </div>

      <div className={`template-grid gl-grid${live ? ' is-in' : ''}`}>
        {TEMPLATES.map((t, i) => {
          const hue = hueFor(t.name);
          return (
            <div key={t.id} className="template-card gl-card" style={{ '--accent': `hsl(${hue} 84% 58%)`, '--i': i }}
              {...pressable(() => navigate(`/dashboard/${t.id}`))} aria-label={`Open ${t.name}`}>
              <div className="gl-card-viz"><MiniViz kind={VIZ_BY_TEMPLATE[t.id] || 'bars'} /></div>
              {/* A registry entry is only guaranteed to carry an id and a name.
                  useTemplates renders a FALLBACK of exactly that shape until
                  /api/templates lands - and keeps it if the request fails - so
                  anything richer has to be optional here. This read `t.tags.map`
                  bare, which threw on the very first paint, every time, and took
                  the whole gallery to the error boundary. */}
              <div className="template-info">
                <div className="gl-card-head"><h3>{t.name}</h3><span className="gl-open" aria-hidden="true">Open →</span></div>
                {t.description && <p>{t.description}</p>}
                <div className="tags">
                  {(t.tags || []).map(tag => <span key={tag} className="tag">{tag}</span>)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

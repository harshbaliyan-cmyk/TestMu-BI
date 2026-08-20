import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import { useTemplates } from '../hooks/useTemplates';

// The gallery renders whatever the server registers. It used to keep its own
// copy of this list, which meant a new dashboard had to be added in two places
// and silently went missing from one of them.

export default function Gallery({ user }) {
  const { templates: TEMPLATES } = useTemplates();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  return (
    <div className="wrap">
      <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
        <div className="brand">
          <img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI" />
          <span>TestMu BI</span>
        </div>
        <div className="user-pill">
          <ThemeToggle />
          {user?.role === 'admin' && <button className="btn-secondary" onClick={() => navigate('/admin/logs')}>Logs</button>}
          <button className="btn-secondary" onClick={() => navigate('/account')}>Account</button>
          <span>{user?.name || 'User'}</span>
          <button className="btn-secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="gallery-header">
        <h2>Dashboard Templates</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--txt-3)', fontSize: 13 }}>
            {TEMPLATES.length} available
          </span>
          <button className="btn-primary" onClick={() => navigate('/data-sources')}>
            Connect data
          </button>
        </div>
      </div>

      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <div key={t.id} className="template-card" onClick={() => navigate(`/dashboard/${t.id}`)}>
            <div className="template-preview">
              <div className="mini-kpi">
                <div className="mini-dot" style={{ background: 'var(--teal)' }} />
                <div className="mini-bar"><div className="mini-fill" style={{ width: '78%', background: 'var(--teal)' }} /></div>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', width: 32, textAlign: 'right' }}>78%</span>
              </div>
              <div className="mini-kpi">
                <div className="mini-dot" style={{ background: 'var(--blue)' }} />
                <div className="mini-bar"><div className="mini-fill" style={{ width: '56%', background: 'var(--blue)' }} /></div>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', width: 32, textAlign: 'right' }}>56%</span>
              </div>
              <div className="mini-kpi">
                <div className="mini-dot" style={{ background: 'var(--amber)' }} />
                <div className="mini-bar"><div className="mini-fill" style={{ width: '34%', background: 'var(--amber)' }} /></div>
                <span style={{ fontSize: 11, color: 'var(--txt-3)', width: 32, textAlign: 'right' }}>34%</span>
              </div>
            </div>
            {/* A registry entry is only guaranteed to carry an id and a name.
                useTemplates renders a FALLBACK of exactly that shape until
                /api/templates lands - and keeps it if the request fails - so
                anything richer has to be optional here. This read `t.tags.map`
                bare, which threw on the very first paint, every time, and took
                the whole gallery to the error boundary. */}
            <div className="template-info">
              <h3>{t.name}</h3>
              {t.description && <p>{t.description}</p>}
              <div className="tags">
                {(t.tags || []).map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

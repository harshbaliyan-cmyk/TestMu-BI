import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';

const TEMPLATES = [
  {
    id: 'opportunity-analytics',
    name: 'Opportunity Analytics',
    description: 'Revenue Command Center with funnel, win rates, and rep performance.',
    tags: ['Salesforce', '6 views'],
  },
  {
    id: 'event-analytics',
    name: 'Event Analytics',
    description: 'Tenant onboarding, feature adoption, and churn signals.',
    tags: ['Segment', '4 views'],
  },
  {
    id: 'tenant-health',
    name: 'Tenant Health',
    description: 'Account whitespace, expansion candidates, and NRR tracking.',
    tags: ['HubSpot', '5 views'],
  },
  {
    id: 'win-board',
    name: 'Win Board',
    description: 'Won ARR contribution, ARR win rate, and sales-team performance.',
    tags: ['Tableau', 'Won ARR'],
  },
  {
    id: 'loss-board',
    name: 'Loss Board',
    description: 'Loss ARR contribution, loss reasons, and lost-after-trial rate.',
    tags: ['Tableau', 'Lost ARR'],
  },
  {
    id: 'ae-performance',
    name: 'AE Performance',
    description: 'AE rep ranking by share of closed ARR, with period comparison.',
    tags: ['Tableau', 'ARR Contribution'],
  },
];

export default function Gallery({ user }) {
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
            <div className="template-info">
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="tags">
                {t.tags.map((tag) => (
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

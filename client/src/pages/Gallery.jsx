import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hueFor } from '../lib/dashboardColor';
import Icon from '../components/WorkspaceIcon';
import MiniViz, { VIZ_BY_TEMPLATE } from '../components/MiniViz';
import { PageHeading, EmptyState } from '../components/WorkspaceUI';
import { useTemplates } from '../hooks/useTemplates';
import { useWorkspaceFavorites } from '../hooks/useWorkspaceFavorites';

export default function Gallery({ user }) {
  const { templates } = useTemplates();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('testmu-gallery-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const { favorites, toggleFavorite } = useWorkspaceFavorites(user.id);
  const changeView = next => { setView(next); try { localStorage.setItem('testmu-gallery-view', next); } catch { /* session preference */ } };
  const boards = templates.map(item => ({ ...item, to: '/dashboard/' + item.id }));
  const starredCount = boards.filter(item => favorites.includes(item.to)).length;
  const visible = boards.filter(item => {
    const text = [item.name, item.description || '', ...(item.tags || [])].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (category === 'all' || favorites.includes(item.to));
  });
  const reset = () => { setCategory('all'); setQuery(''); };
  return <div className={'wrap gallery ws-gallery ux-page ux-gallery ux-gallery-' + view}>
    <PageHeading title="Dashboards" description="Open a board, or star the dashboards you use most."><Link className="btn-primary" to="/data-sources?view=add"><Icon name="source" />Connect data</Link></PageHeading>
    <div className="ux-gallery-toolbar">
      <div className="ux-segments" role="group" aria-label="Filter dashboards">{[['all', 'All boards', boards.length], ['starred', 'Starred', starredCount]].map(([id, label, count]) => <button type="button" key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label}<span>{count}</span></button>)}</div>
      <div className="ux-toolbar-end"><label className="ux-search"><Icon name="search" /><input type="search" aria-label="Filter dashboard list" placeholder="Search dashboards" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="ux-view-toggle" role="group" aria-label="Dashboard display"><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => changeView('grid')}><Icon name="grid" /></button><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => changeView('list')}><Icon name="list" /></button></div></div>
    </div>
    {visible.length > 0 && <section aria-label="Dashboard templates" className="ux-board-section">
      <div className="ux-section-heading"><h2>Dashboard templates</h2><span>{visible.length} dashboard{visible.length === 1 ? '' : 's'}</span></div>
      <div className="template-grid gl-grid is-in">{visible.map(item => {
        const starred = favorites.includes(item.to);
        return <article key={item.to} className="ux-board-item">
          <Link to={item.to} className="template-card gl-card" style={{ '--accent': 'hsl(' + hueFor(item.name) + ' 42% 47%)' }} aria-label={'Open ' + item.name}>
            <div className="gl-card-viz"><MiniViz kind={VIZ_BY_TEMPLATE[item.id] || 'bars'} /></div>
            <div className="template-info"><div className="gl-card-head"><h3>{item.name}</h3><span className="gl-open" aria-hidden="true"><Icon name="arrow" /></span></div>
              <p>{item.description || 'Open this dashboard to explore your connected data.'}</p>
              <div className="tags">{(item.tags || []).map(tag => <span key={tag} className="tag">{tag}</span>)}</div>
            </div>
          </Link>
          <button type="button" className="ux-favorite" aria-label={(starred ? 'Unstar ' : 'Star ') + item.name} aria-pressed={starred} onClick={() => toggleFavorite(item.to)} title={starred ? 'Remove from starred' : 'Add to starred'}><Icon name="star" /></button>
        </article>;
      })}</div>
    </section>}
    {!visible.length && <EmptyState icon={category === 'starred' ? 'star' : 'search'} title={category === 'starred' && !query ? 'Keep your go-to dashboards here' : 'No dashboards found'} action={<button className="btn-secondary" onClick={reset}>Show all dashboards</button>}>
      {category === 'starred' && !query ? 'Select the star on any dashboard to keep it close in your sidebar.' : 'Try a different name or clear your filters.'}
    </EmptyState>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTemplates } from '../hooks/useTemplates';
import { useWorkspaceFavorites } from '../hooks/useWorkspaceFavorites';
import ThemeToggle from './ThemeToggle';
import Icon, { iconForBoard } from './WorkspaceIcon';
import './WorkspaceShell.css';

function BoardLink({ to, name, icon, onNavigate }) {
  return <NavLink to={to} end className={({ isActive }) => `ws-nav-link${isActive ? ' is-active' : ''}`} title={name} onClick={onNavigate}>
    <Icon name={icon} /><span className="ws-link-label">{name}</span><i className="ws-active-dot" aria-hidden="true" />
  </NavLink>;
}

function WorkspaceShell({ user, onSignOut, children }) {
  const { pathname } = useLocation();
  const { templates } = useTemplates();
  const { favorites } = useWorkspaceFavorites(user.id);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('testmu-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const drawerRef = useRef(null);
  const contentRef = useRef(null);
  const previousPath = useRef(pathname);
  const searchInputRef = useRef(null);
  const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    searchRef.current?.close();
    drawerRef.current?.close();
    contentRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  const openSearch = () => {
    drawerRef.current?.close();
    setQuery('');
    searchRef.current?.showModal();
    searchInputRef.current?.focus();
  };
  useEffect(() => {
    const shortcut = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        // Leave keyboard input inside an existing dashboard dialog alone.
        if (document.querySelector('dialog[open]:not(.ws-search-dialog):not(.ws-drawer)')) return;
        event.preventDefault();
        openSearch();
      }
    };
    const media = matchMedia('(min-width: 1101px)');
    const closeDrawer = () => { if (media.matches) drawerRef.current?.close(); };
    window.addEventListener('keydown', shortcut);
    media.addEventListener('change', closeDrawer);
    return () => { window.removeEventListener('keydown', shortcut); media.removeEventListener('change', closeDrawer); };
  }, []);

  const boards = [
    ...templates.map(t => ({ name: t.name, to: `/dashboard/${t.id}`, icon: iconForBoard(t.id), type: 'Dashboard template' })),
  ];
  const utilities = [
    { name: 'All dashboards', to: '/gallery', icon: 'grid' },
    { name: 'Data sources', to: '/data-sources', icon: 'source' },
    { name: 'Account', to: '/account', icon: 'account' },
    ...(user?.role === 'admin' ? [{ name: 'Activity logs', to: '/admin/logs', icon: 'logs' }] : []),
  ];
  const current = [...boards, ...utilities].find(item => item.to === pathname)?.name
    || 'Dashboard';
  const matches = [...boards, ...utilities].filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const initials = String(user?.name || 'User').trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  const closeNavigation = () => { drawerRef.current?.close(); searchRef.current?.close(); };
  const toggleSidebar = () => setCollapsed(value => {
    try { localStorage.setItem('testmu-sidebar-collapsed', String(!value)); } catch { /* session-only preference */ }
    return !value;
  });
  const navigation = mobile => <>
    <div className="ws-brand-row">
      <Link className="ws-brand" to="/gallery" aria-label="TestMu BI workspace" onClick={closeNavigation}>
        <span className="ws-mark" aria-hidden="true"><i /><i /><i /></span>
        <span className="ws-link-label">Your workspace<small>TestMu BI</small></span>
      </Link>
      {mobile && <button className="ws-icon-button" onClick={() => drawerRef.current?.close()} aria-label="Close navigation"><Icon name="close" /></button>}
    </div>
    <button className="ws-find" onClick={openSearch} title="Find a dashboard (Ctrl or Command K)" aria-keyshortcuts="Control+K Meta+K"><Icon name="search" /><span className="ws-link-label">Find a dashboard</span><kbd className="ws-link-label">{shortcutLabel}</kbd></button>
    <nav className="ws-navigation" aria-label={mobile ? 'Mobile workspace navigation' : 'Workspace navigation'}>
      <BoardLink to="/gallery" name="All dashboards" icon="grid" onNavigate={closeNavigation} />
      {boards.some(item => favorites.includes(item.to)) && <div className="ws-nav-group"><p className="ws-group-label">Starred</p>{boards.filter(item => favorites.includes(item.to)).map(item => <BoardLink key={item.to} {...item} icon="star" onNavigate={closeNavigation} />)}</div>}
      <div className="ws-nav-group"><p className="ws-group-label">Dashboards <span>{templates.length}</span></p>
        {templates.map(t => <BoardLink key={t.id} to={`/dashboard/${t.id}`} name={t.name} icon={iconForBoard(t.id)} onNavigate={closeNavigation} />)}
      </div>
    </nav>
      <nav className="ws-nav-group ws-tools" aria-label={mobile ? 'Mobile workspace tools' : 'Workspace tools'}><p className="ws-group-label">Workspace</p>
        {utilities.filter(item => !['/gallery', '/account'].includes(item.to)).map(item => <BoardLink key={item.to} {...item} onNavigate={closeNavigation} />)}
      </nav>
    <footer className="ws-sidebar-footer">
      <Link className="ws-profile" to="/account" title="Account settings" onClick={closeNavigation}><span className="ws-avatar">{initials}</span><span className="ws-link-label"><b>{user?.name || 'Your account'}</b><small>Account settings</small></span></Link>
      <button className="ws-icon-button ws-signout" onClick={onSignOut} title="Sign out" aria-label="Sign out of workspace"><Icon name="logout" /></button>
    </footer>
  </>;

  return <div className={`workspace-shell${collapsed ? ' ws-collapsed' : ''}`}>
    <a className="ws-skip" href="#workspace-content">Skip to content</a>
    <aside className="ws-sidebar">{navigation(false)}</aside>
    <div className="ws-main">
      <header className="ws-topbar">
        <button className="ws-icon-button ws-collapse-toggle" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}><Icon name="panel" /></button>
        <button className="ws-icon-button ws-mobile-toggle" onClick={() => drawerRef.current?.showModal()} aria-label="Open workspace navigation" aria-haspopup="dialog"><Icon name="menu" /></button>
        <nav className="ws-breadcrumb" aria-label="Breadcrumb"><Link to="/gallery">Workspace</Link><span aria-hidden="true">/</span><span aria-current="page">{current}</span></nav>
        <div className="ws-topbar-actions"><button className="ws-icon-button ws-mobile-search" onClick={openSearch} aria-label="Find a dashboard"><Icon name="search" /></button><ThemeToggle /></div>
      </header>
      <div id="workspace-content" ref={contentRef} className="ws-content" tabIndex={-1}>{children}</div>
    </div>
    <dialog ref={drawerRef} className="ws-drawer" aria-label="Workspace navigation" onClick={event => { if (event.target === drawerRef.current) drawerRef.current.close(); }}>
      <div className="ws-drawer-inner">{navigation(true)}</div>
    </dialog>
    <dialog ref={searchRef} className="ws-search-dialog" aria-labelledby="ws-search-title" onClick={event => { if (event.target === searchRef.current) searchRef.current.close(); }}>
      <div className="ws-search-inner">
        <div className="ws-search-heading"><h2 id="ws-search-title">Where would you like to go?</h2><button className="ws-icon-button" aria-label="Close dashboard search" onClick={() => searchRef.current?.close()}><Icon name="close" /></button></div>
        <label className="ws-search-field"><Icon name="search" /><input ref={searchInputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search dashboards and pages…" aria-label="Search dashboards and pages" onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); searchRef.current?.querySelector('.ws-search-results a')?.focus(); }
          if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.querySelector('.ws-search-results a')?.click(); }
        }} /></label>
        <div className="ws-search-results" onKeyDown={e => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const links = [...e.currentTarget.querySelectorAll('a')];
          const index = links.indexOf(document.activeElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : index + (e.key === 'ArrowDown' ? 1 : -1);
          if (next < 0) searchInputRef.current?.focus(); else links[Math.min(next, links.length - 1)]?.focus();
        }}>
          {matches.map(item => <Link key={item.to} to={item.to} onClick={closeNavigation}><Icon name={item.icon} /><span>{item.name}<small>{item.type || 'Workspace'}</small></span><Icon name="arrow" /></Link>)}
          {!matches.length && <p className="ws-search-empty" role="status">No matches for “{query}”. Try a dashboard name.</p>}
        </div>
        <p className="ws-search-hint">↑ ↓ to move <span>Enter to open · Esc to close</span></p>
      </div>
    </dialog>
  </div>;
}

// Keep the existing route tree, auth guards and full-screen experiences intact.
export default function WorkspaceFrame({ user, onSignOut, children }) {
  const { pathname } = useLocation();
  if (!user || pathname === '/' || pathname === '/login' || pathname.startsWith('/present/') || pathname.startsWith('/tv/')) return children;
  return <WorkspaceShell user={user} onSignOut={onSignOut}>{children}</WorkspaceShell>;
}

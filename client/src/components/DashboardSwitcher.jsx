import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTemplates } from '../hooks/useTemplates';
import { listCustomDashboards } from '../lib/api';

// Deterministic tile colour: the same dashboard always gets the same hue, so
// the launcher stays visually stable across sessions without storing anything.
const TILE_HUES = [212, 262, 158, 24, 340, 190, 48, 288];
const hueFor = name => {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_HUES[hash % TILE_HUES.length];
};
const initialsFor = name => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  // A leading acronym ("AE Performance", "AM Performance") is the
  // distinguishing part — first-letter-of-each-word would collapse both
  // to the same "AP" badge.
  if (/^[A-Z0-9]{2,3}$/.test(words[0] || '')) return words[0];
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '?';
};

function Tile({ item, active, onGo }) {
  const hue = hueFor(item.label);
  return <button type="button" role="menuitem" className={`waffle-tile${active ? ' active' : ''}`}
    aria-current={active ? 'page' : undefined} onClick={() => onGo(item.to)}>
    <span className="waffle-tile-badge" style={{
      background: `hsl(${hue} 80% 94%)`, color: `hsl(${hue} 60% 34%)`, borderColor: `hsl(${hue} 55% 82%)`,
    }} aria-hidden="true">{item.glyph || initialsFor(item.label)}</span>
    <span className="waffle-tile-label">{item.label}</span>
  </button>;
}

// One jump-anywhere control for every board's top nav: a 9-dot "waffle"
// launcher (the pattern people already know from Google/Microsoft app grids)
// opening a grid of the template boards, the user's custom dashboards, and
// the utility pages. Replaces the old <select> — a dropdown hid the options
// behind a generic "Go to…" and gave no sense of place.
export default function DashboardSwitcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { templates } = useTemplates();
  const [custom, setCustom] = useState([]);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // Fetch on open (refreshed each time — a just-saved dashboard must appear),
  // not on mount: eight pages render this control and the list rarely changes.
  // Hovering the trigger prefetches once so the panel usually opens complete.
  const prefetched = useRef(false);
  const loadCustom = () => listCustomDashboards().then(setCustom).catch(() => {});
  const prefetch = () => { if (!prefetched.current) { prefetched.current = true; loadCustom(); } };
  useEffect(() => { if (open) loadCustom(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(316, window.innerWidth - 24);
      setRect({
        width,
        left: Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12)),
        top: Math.min(box.bottom + 8, window.innerHeight - 200),
      });
    };
    const close = event => {
      if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    measure();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  const go = to => { setOpen(false); if (to !== pathname) navigate(to); };

  const groups = [
    ['Boards', templates.map(t => ({ to: `/dashboard/${t.id}`, label: t.name }))],
    ['My dashboards', custom.map(d => ({ to: `/dashboards/custom/${d.id}`, label: d.name }))],
    ['More', [
      { to: '/gallery', label: 'Gallery', glyph: '▦' },
      { to: '/charts/new', label: 'Chart builder', glyph: '+' },
      { to: '/data-sources', label: 'Data sources', glyph: '⛁' },
    ]],
  ].filter(([, items]) => items.length > 0);

  return <>
    <button ref={triggerRef} type="button" className={`waffle-trigger${open ? ' on' : ''}`}
      aria-label="Open dashboard menu" aria-haspopup="menu" aria-expanded={open}
      title="Dashboards" onPointerEnter={prefetch} onFocus={prefetch}
      onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
        {[2, 9, 16].flatMap(y => [2, 9, 16].map(x =>
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="currentColor" />))}
      </svg>
    </button>
    {open && rect && createPortal(<nav ref={panelRef} className="waffle-panel" style={rect}
      role="menu" aria-label="Dashboards">
      {groups.map(([heading, items]) => <section key={heading}>
        <h4>{heading}</h4>
        <div className="waffle-grid">
          {items.map(item => <Tile key={item.to} item={item} active={item.to === pathname} onGo={go} />)}
        </div>
      </section>)}
    </nav>, document.body)}
  </>;
}

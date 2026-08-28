import { cloneElement, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getDashboardState, saveDashboardState } from '../lib/api';

// Curate what a wall shows by double-clicking it away.
//
// Double-clicking a wrapped chart or KPI on a presentation page hides it —
// it collapses to a small "hidden" chip that a single click restores. The
// hidden set persists in the board's presentation_settings, which the TV
// share-token route already reads, so a tile hidden at the desk disappears
// from the wall too (walls re-read on their liveness tick). On the wall
// itself the interaction is off and hidden tiles render as nothing: a public
// screen should neither advertise what it is not showing nor let a stray
// touch rearrange it.
//
// Components shared with the interactive boards can wrap their tiles
// unconditionally: without a provider, Hideable renders children untouched.

const HideContext = createContext(null);

export function useHiddenTiles(templateId, { share = false, refreshTick = 0 } = {}) {
  const [hidden, setHidden] = useState(() => new Set());
  // The last state row we saw, kept so a toggle can write in ONE roundtrip.
  // The state PUT replaces the whole row, so writing blind would wipe the
  // board's saved filters — but a read-then-write per toggle doubles the
  // window in which closing the tab loses the click. Merging over this cache
  // (refreshed from every PUT's response) keeps both properties.
  const baseRef = useRef(null);

  useEffect(() => {
    // Owner mode loads once; refetching on the liveness tick there would race
    // a just-clicked toggle with a stale read. A wall has nobody clicking, so
    // it follows the owner's changes tick by tick.
    getDashboardState(templateId)
      .then(state => {
        baseRef.current = state;
        setHidden(new Set(state?.presentationSettings?.hiddenTiles || []));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, share ? refreshTick : 0]);

  const toggle = useCallback(key => {
    if (share) return;
    setHidden(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      const base = baseRef.current || {};
      saveDashboardState(templateId, {
        ...base,
        presentationSettings: { ...(base.presentationSettings || {}), hiddenTiles: [...next] },
      }).then(saved => { baseRef.current = saved; }).catch(() => {});
      return next;
    });
  }, [templateId, share]);

  return { share, hidden, toggle };
}

export function HideableProvider({ value, children }) {
  return <HideContext.Provider value={value}>{children}</HideContext.Provider>;
}

export function Hideable({ k, label, children }) {
  const ctx = useContext(HideContext);
  if (!ctx) return children;
  const { share, hidden, toggle } = ctx;
  if (hidden.has(k)) {
    if (share) return null;
    return <button type="button" className="hidden-tile-ghost" onClick={() => toggle(k)}
      title="Hidden from the TV — click to show it again">
      {label || k} · hidden
    </button>;
  }
  if (share) return children;
  // The double-click handler is grafted onto the child itself rather than a
  // wrapper element. A display:contents wrapper was tried first and broke the
  // TV layouts: it keeps the LAYOUT tree intact but changes the DOM tree, so
  // every child-combinator rule (.win-board-tv-chart-grid > .present-card and
  // friends — exactly where the card sizing lives) stopped matching and the
  // presentation collapsed. cloneElement leaves the DOM identical.
  return cloneElement(children, {
    onDoubleClick: event => { event.stopPropagation(); toggle(k); },
  });
}

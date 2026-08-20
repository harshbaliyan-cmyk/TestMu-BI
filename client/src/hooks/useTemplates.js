import { useEffect, useState } from 'react';
import { getTemplates } from '../lib/api';

// The dashboard registry, served from /api/templates.
//
// This replaces four hand-kept lists: the server's own registry, the mapping
// page's destination picker, the gallery, and the per-dashboard field
// allowlist. Nothing checked those against each other, and three separate bugs
// came from a dashboard being present in some and missing from others - most
// recently AM Performance, which existed and worked but could not be bound to
// a source because the picker had never heard of it.
//
// FALLBACK is not the same data, deliberately. It carries only what is needed
// to render something sane before the request lands (or if it fails): ids and
// names. The field sets are NOT duplicated here, because a stale copy of those
// is what silently hid the quota fields. A page that has no fields yet shows
// its loading state instead of a wrong one.
const FALLBACK = [
  { id: 'opportunity-analytics', name: 'Opportunity Analytics' },
  { id: 'event-analytics', name: 'Event Analytics' },
  { id: 'tenant-health', name: 'Tenant Health' },
  { id: 'win-board', name: 'Win Board' },
  { id: 'loss-board', name: 'Loss Board' },
  { id: 'am-performance', name: 'AM Performance' },
  { id: 'ae-performance', name: 'AE Performance' },
];

export function useTemplates() {
  const [templates, setTemplates] = useState(FALLBACK);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getTemplates()
      .then(list => { if (!cancelled && Array.isArray(list) && list.length) setTemplates(list); })
      .catch(() => {})           // the fallback already renders; a failed fetch must not blank the page
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  return { templates, ready };
}

// Field keys a dashboard needs, keyed by template id. Empty until the registry
// arrives, which callers must treat as "not known yet" rather than "none".
export function fieldsByTemplate(templates) {
  return Object.fromEntries(templates.map(t => [t.id, t.fields || []]));
}

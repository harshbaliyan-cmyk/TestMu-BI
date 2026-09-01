import { useEffect, useRef, useState } from 'react';
import { listDataSources, refreshDataSource } from '../lib/api';

// Header control: re-pull the board's live Tableau sources on demand, then
// tell the page to reload its metrics — so seeing fresh numbers no longer
// requires a detour through the Data sources page. Uploaded files have
// nothing to re-pull; for a board fed only by uploads the button still
// reloads the metrics from the server.
export default function RefreshDataButton({ templateId, onRefreshed }) {
  const [state, setState] = useState('idle'); // idle | busy | done | error
  const [note, setNote] = useState('');
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const run = async () => {
    if (state === 'busy') return;
    clearTimeout(resetTimer.current);
    setState('busy'); setNote('');
    let failed = 0, refreshed = 0;
    try {
      const sources = (await listDataSources()).filter(source =>
        (source.dashboards || []).includes(templateId) && String(source.sourceType).startsWith('tableau'));
      // Sequential on purpose: sources usually share one PAT, and a second
      // Tableau sign-in invalidates the first one's session mid-pull.
      for (const source of sources) {
        try { await refreshDataSource(source.id); refreshed += 1; }
        catch { failed += 1; }
      }
      setState(failed ? 'error' : 'done');
      setNote(failed ? `${failed} source${failed > 1 ? 's' : ''} failed to refresh`
        : refreshed ? `Re-pulled ${refreshed} Tableau source${refreshed > 1 ? 's' : ''}`
        : 'No live source connected — reloaded the saved rows');
    } catch (error) {
      setState('error');
      setNote(error.response?.data?.error || 'Could not reach the server');
    }
    // Reload even after a failure: a partial refresh has already changed the
    // rows behind the board, and stale charts over fresh data would lie.
    onRefreshed?.();
    resetTimer.current = setTimeout(() => { setState('idle'); setNote(''); }, 5000);
  };

  const label = state === 'busy' ? 'Refreshing…' : state === 'done' ? 'Refreshed ✓' : state === 'error' ? 'Refresh failed' : 'Refresh data';
  return <button type="button" className={`btn-secondary refresh-data-button ${state}`}
    onClick={run} disabled={state === 'busy'} title={note || 'Re-pull this board’s connected sources and reload'}>
    <span className="refresh-data-icon" aria-hidden="true">⟳</span>{label}
  </button>;
}

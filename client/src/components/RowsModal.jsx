import { useEffect, useState } from 'react';

// "The rows behind this" — opened by clicking a chart element. The fetcher is
// supplied by the caller (builder preview and saved dashboard tiles hit
// different endpoints); this component only knows how to show the answer.
export default function RowsModal({ title, fetcher, onClose, onFilterTo }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then(data => { if (!cancelled) setState({ status: 'ok', ...data }); })
      .catch(error => { if (!cancelled) setState({ status: 'error', message: error.response?.data?.error || 'Could not load the rows' }); });
    return () => { cancelled = true; };
    // The fetcher identity changes with every parent render; the modal loads
    // once per open, which is what a modal should do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-card card" role="dialog" aria-label={title} onClick={event => event.stopPropagation()}>
      <header className="modal-head">
        <b>{title}</b>
        <span className="modal-head-actions">
          {onFilterTo && <button type="button" className="btn-secondary" onClick={onFilterTo}>Filter chart to this</button>}
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </span>
      </header>
      {state.status === 'loading' && <div className="builder-chart-empty">Loading rows…</div>}
      {state.status === 'error' && <div className="builder-chart-empty" style={{ color: 'var(--red)' }}>{state.message}</div>}
      {state.status === 'ok' && <>
        <div className="modal-table scroll">
          <table>
            <thead><tr>{state.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {state.rows.map((row, i) => <tr key={i}>
                {state.columns.map(column => <td key={column}>{String(row[column] ?? '')}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        <footer className="hint">
          {state.totalRows > state.rows.length
            ? `Showing the first ${state.rows.length} of ${state.totalRows.toLocaleString()} matching rows`
            : `${state.totalRows.toLocaleString()} matching row${state.totalRows === 1 ? '' : 's'}`}
        </footer>
      </>}
    </div>
  </div>;
}

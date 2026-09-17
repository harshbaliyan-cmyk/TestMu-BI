import { useEffect, useState } from 'react';
import api from '../lib/api';
import Icon from '../components/WorkspaceIcon';
import { PageHeading, EmptyState, Notice, useConfirmDialog } from '../components/WorkspaceUI';

export default function AdminLogs() {
  const [type, setType] = useState('audit');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('newest');
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  const [notice, setNotice] = useState('');
  const { confirm, dialog } = useConfirmDialog();
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get('/admin/logs', { params: { type, limit: 200 } }).then(({ data }) => { if (active) setItems(data.items || []); })
      .catch(e => { if (active) setError(e.response?.data?.error || e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [type, reload]);
  const filtered = items.filter(item => [item.email, item.route, item.action, item.errorCode, item.entityType, item.message].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (order === 'newest' ? -1 : 1) * (new Date(a.createdAt) - new Date(b.createdAt)));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const rows = filtered.slice(currentPage * 20, currentPage * 20 + 20);
  const changeType = value => { setType(value); setPage(0); setQuery(''); };
  const cleanup = async () => {
    if (!await confirm({ title: 'Clear records older than 90 days?', description: 'Older audit and error records will be removed. Recent records and dashboard data are kept.', label: 'Clear older records', danger: true })) return;
    setCleaning(true); setError(''); setNotice('');
    try { await api.post('/admin/retention-cleanup', { days: 90 }); setNotice('Older records cleared.'); setReload(tick => tick + 1); }
    catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setCleaning(false); }
  };
  return <div className="wrap ux-page ux-logs">
    <PageHeading title="Activity logs" description="Review workspace activity and investigate application errors."><button className="btn-secondary" onClick={() => setReload(value => value + 1)} disabled={loading}>Refresh logs</button><button className="btn-danger" disabled={cleaning} onClick={cleanup}>{cleaning ? 'Clearing…' : 'Clear older records'}</button></PageHeading>
    <div className="ux-gallery-toolbar"><div className="ux-segments" role="group" aria-label="Log type"><button aria-pressed={type === 'audit'} onClick={() => changeType('audit')}>Audit trail</button><button aria-pressed={type === 'errors'} onClick={() => changeType('errors')}>Errors</button></div><div className="ux-toolbar-end"><label className="ux-search"><Icon name="search" /><input type="search" placeholder="Search these records" aria-label="Search logs" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><select aria-label="Log order" value={order} onChange={event => { setOrder(event.target.value); setPage(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div></div>
    {notice && <Notice>{notice}</Notice>}
    {error && <Notice error action={<button className="btn-secondary" onClick={() => setReload(value => value + 1)}>Try again</button>}>{error}</Notice>}
    {loading ? <p className="ux-loading" role="status">Loading records…</p> : error ? null : !rows.length ? <EmptyState icon="logs" title={query ? 'No matching records' : 'No records yet'}>{query ? 'Try a name, action or route from the records in this view.' : 'Workspace activity will appear here as it happens.'}</EmptyState> : <>
      <div className="card ux-log-table"><div className="scroll" role="region" aria-label="Activity records" tabIndex={0}><table><thead><tr><th>Time</th><th>Person or route</th><th>{type === 'audit' ? 'Action' : 'Error'}</th><th>Details</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></td><td>{item.email || item.route || 'System'}</td><td><span className="ux-badge">{item.action || item.errorCode || 'Error'}</span></td><td className="ux-log-detail">{item.entityType || item.message || '—'}</td></tr>)}</tbody></table></div></div>
      <div className="ux-pagination"><span>{currentPage * 20 + 1}–{Math.min((currentPage + 1) * 20, filtered.length)} of {filtered.length} matching records <small>From the latest 200 records</small></span><div><button className="btn-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn-secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
    </>}
    {dialog}
  </div>;
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBdrFunnelSnapshot } from '../lib/api';
import { Th, useTableSort } from '../components/charts';
import RefreshDataButton from '../components/RefreshDataButton';
import AppLoader from '../components/AppLoader';
import { isoDate } from '../components/AdvancedDateRange';

// A port of the Tableau "Dashboard : BDR Funnel" crosstab: one row per
// rostered BDR, thirteen measures, no filters. Every number comes from
// services/bdrFunnelMetrics.js on the server; this page owns exactly one
// control, the as-of date, because Weeks Measured and Avg Leads per Week
// depend on it and the Tableau original drifted with TODAY().
export const TEMPLATE = 'bdr-funnel';

const DASH = '—';
// M/D/YYYY, as the Tableau crosstab shows it.
const fmtDate = iso => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}` : DASH);
const fmtInt = n => (n === null || n === undefined ? DASH : Math.round(n).toLocaleString('en-US'));
// One decimal, not the whole number Tableau rounds to: 109.6 and 110.4 are
// different weeks of work.
const fmtAvg = n => (n === null || n === undefined ? DASH : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

const COLUMNS = [
  { key: 'name', label: 'BDR Name', format: value => value ?? DASH },
  { key: 'floorHitDate', label: 'Floor Hit Date', format: fmtDate, numeric: true },
  { key: 'firstMeetingDate', label: 'First Meeting Date', format: fmtDate, numeric: true },
  { key: 'firstQualifiedMeetingDate', label: 'First Qualified Meeting Date', format: fmtDate, numeric: true },
  { key: 'weeksMeasured', label: 'Weeks Measured', format: fmtInt, numeric: true },
  { key: 'accountsAssigned', label: 'Accounts Assigned to BDR', format: fmtInt, numeric: true },
  { key: 'uniqueLeadsCalled', label: 'Unique Leads Called', format: fmtInt, numeric: true },
  { key: 'meetingsGenerated', label: 'Meetings Generated', format: fmtInt, numeric: true },
  { key: 'meetingsRated', label: 'Meetings Rated', format: fmtInt, numeric: true },
  { key: 'qualifiedTotal', label: 'Qualified Total', format: fmtInt, numeric: true },
  { key: 'avgLeadsPerWeek', label: 'Avg Leads per Week', format: fmtAvg, numeric: true },
  { key: 'leadsByDay30', label: 'Leads by Day 30', format: fmtInt, numeric: true },
  { key: 'leadsByDay60', label: 'Leads by Day 60', format: fmtInt, numeric: true },
  { key: 'leadsByDay90', label: 'Leads by Day 90', format: fmtInt, numeric: true },
  { key: 'qualifiedByDay30', label: 'Qualified by Day 30', format: fmtInt, numeric: true },
  { key: 'qualifiedByDay60', label: 'Qualified by Day 60', format: fmtInt, numeric: true },
  { key: 'qualifiedByDay90', label: 'Qualified by Day 90', format: fmtInt, numeric: true },
];

// Dates sort as strings (ISO order is date order); useTableSort treats a
// string column with localeCompare, so a null date must become '' not
// undefined for the comparison to hold.
const sortable = row => ({
  ...row,
  floorHitDate: row.floorHitDate ?? '',
  firstMeetingDate: row.firstMeetingDate ?? '',
  firstQualifiedMeetingDate: row.firstQualifiedMeetingDate ?? '',
});

const EMPTY = { asOf: null, rows: [], summary: { rowsScanned: 0, bdrCount: 0, rosterSize: null, unresolvedNames: [], totalUniqueLeadsCalled: 0 } };

export default function BdrFunnel() {
  const navigate = useNavigate();
  const today = isoDate(new Date());
  const [asOf, setAsOf] = useState(today);
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const { sort, onSort, apply } = useTableSort('name', 'asc', 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    getBdrFunnelSnapshot(asOf).then(data => {
      if (cancelled) return;
      setSnapshot({ ...EMPTY, ...data, summary: { ...EMPTY.summary, ...(data?.summary || {}) }, rows: Array.isArray(data?.rows) ? data.rows : [] });
    }).catch(error => {
      if (cancelled) return;
      setSnapshot(EMPTY);
      setLoadError(error.response?.data?.error || error.message || 'Could not load the BDR Funnel');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asOf, reloadTick]);

  const { rows, summary } = snapshot;
  const sorted = apply(rows.map(sortable));
  const noSource = !loading && !loadError && summary.rowsScanned === 0;
  const noMatch = !loading && !loadError && summary.rowsScanned > 0 && rows.length === 0;

  if (loading && !rows.length && !loadError) return <AppLoader fullscreen label="Loading BDR Funnel…" />;

  return <div className="wrap win-board-wrap db-page db-bdr"><header className="top"><div className="top-row"><div>
      <h1>BDR Funnel</h1>
      <div className="sub">One row per BDR: dials, meetings, qualification and the 30/60/90-day windows from each rep's <strong>first logged call</strong>.</div>
      <div className="board-scope-note">Rostered BDRs only · every count is distinct, never a row count · windows nest: day 60 contains day 30</div>
    </div>
    <div className="db-header-actions">
      <label className="fg bdr-asof" title="Weeks Measured and Avg Leads per Week are counted up to this date. Pin it to reproduce a number.">
        <span>As of</span>
        <input type="date" value={asOf} max={today} onChange={event => { if (event.target.value) setAsOf(event.target.value); }} />
      </label>
      {asOf !== today && <button type="button" className="btn-secondary" onClick={() => setAsOf(today)}>Today</button>}
      <RefreshDataButton templateId={TEMPLATE} onRefreshed={() => setReloadTick(tick => tick + 1)} />
    </div></div></header>

    {loadError && <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>BDR Funnel could not load</h3><p>{loadError}</p></div>
      <button type="button" className="btn-secondary" onClick={() => setReloadTick(tick => tick + 1)}>Try again</button>
    </div>}

    {noSource && <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>No BDR Funnel data is loaded</h3>
        <p>Connect the <b>BDR -Req</b> Tableau data source to BDR Funnel from Data Sources. The mapping needs the Task, Meeting and Account column families (T., E., A.) plus the joined Lead, Account and User columns.</p></div>
      <button type="button" className="btn-primary" onClick={() => navigate('/data-sources')}>Open data sources</button>
    </div>}

    {noMatch && <div className="card win-board-empty">
      <div className="win-board-empty-icon">▦</div><div><h3>No rostered BDR found in the loaded rows</h3>
        <p>{fmtInt(summary.rowsScanned)} rows are loaded but none belongs to a BDR on the roster. Check the roster's user ids and names against the source's user columns.</p></div>
    </div>}

    {rows.length > 0 && <>
      <p className="bdr-summary" data-testid="bdr-summary">
        <b>{summary.bdrCount}</b>{summary.rosterSize ? ` of ${summary.rosterSize} rostered` : ''} BDR{summary.bdrCount === 1 ? '' : 's'} as of <b>{fmtDate(snapshot.asOf)}</b>
        {' · '}{fmtInt(summary.totalUniqueLeadsCalled)} unique leads called in total (a lead worked by two BDRs counts for both)
        {summary.unresolvedNames?.length > 0 && <> · <span className="bdr-unresolved" title="On the roster but with no task, meeting or account row in the data — the dataset cannot produce a row for them.">no data for {summary.unresolvedNames.join(', ')}</span></>}
      </p>
      <div className="card bdr-funnel-card"><div className="bdr-scroll"><table className="bdr-table">
        <thead><tr>{COLUMNS.map(column => <Th key={column.key} label={column.label} sortKey={column.key} sort={sort} onSort={onSort} numeric={column.numeric} />)}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.userId}>
          {COLUMNS.map(column => <td key={column.key} className={column.numeric ? 'n' : ''}>{column.format(row[column.key] === '' ? null : row[column.key])}</td>)}
        </tr>)}</tbody>
      </table></div></div>
      <p className="bdr-footnote">A dash means not measurable: a BDR with no logged call has no floor date, so no weeks and no per-week average, while their meetings still count. Day-window counts start on the floor date itself and ignore anything dated before it.</p>
    </>}
  </div>;
}

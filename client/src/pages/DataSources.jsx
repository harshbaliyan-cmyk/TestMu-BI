// client/src/pages/DataSources.jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplates, fieldsByTemplate } from '../hooks/useTemplates';
import api from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';

// Registry and field sets both come from /api/templates now. They were
// duplicated here, and a dashboard missing from either copy was invisible with
// no error anywhere - that is how AM Performance came to exist and work while
// being unbindable.
// Falls back to the raw key while the registry is loading, which reads as an
// id rather than as a wrong name.
const labelFor = (templates, key) => (templates.find(t => t.id === key) || {}).name || key;

// Relative for anything recent (where the exact minute matters most), an
// absolute date once it's old enough that "N hours ago" stops being useful.
function formatRefreshTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Keep the mapper focused on fields that the selected dashboards actually
// consume. Optional schema fields remain available behind an explicit toggle.



// ownerRole scopes the board to AE-owned rows (STARTSWITH([Role Name],"AE"));
// pod is what the POD ranking groups by, the same field the Win and Loss
// boards use. Omitting pod here is what left the POD ranking grouping by raw
// Role Name and showing a fraction of the real PODs.

// AM Performance maps the identical field set: same formulas, same quota, only
// the row scope differs (POD contains AM rather than an AE-prefixed role).


export default function DataSources() {
  const navigate = useNavigate();
  const { templates } = useTemplates();
  const [tab, setTab] = useState('upload');
  const [preview, setPreview] = useState(null);
  const [workflowStep, setWorkflowStep] = useState('preview');
  const [selectedDashboards, setSelectedDashboards] = useState(['opportunity-analytics']);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [stagedInfo, setStagedInfo] = useState(null);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [savedSources, setSavedSources] = useState([]);
  const [syncRuns, setSyncRuns] = useState([]);
  const [refreshingSource, setRefreshingSource] = useState(null);
  const [deletingSource, setDeletingSource] = useState(null);
  const [webhookBusySource, setWebhookBusySource] = useState(null);
  const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);

  const loadSavedSources = () => api.get('/datasources')
    .then(({ data }) => setSavedSources(data.sources || [])).catch(() => {});
  const loadSyncRuns = () => api.get('/datasources/sync-history')
    .then(({data})=>setSyncRuns(data.runs||[])).catch(()=>{});

  // If something was staged earlier (even before a reload), offer to reopen it.
  useEffect(() => {
    api.get('/datasources/staged')
      .then(({ data }) => { if (data.staged) setStagedInfo(data); })
      .catch(() => {});
  }, []);

  useEffect(() => { loadSavedSources(); loadSyncRuns(); }, []);

  // Re-committing a source rewrites its bindings, so the dashboard tick-boxes
  // are destructive: any dashboard left unticked is unbound. They used to open
  // on a hardcoded default regardless of what the source was already serving,
  // so fixing one field's mapping silently detached every other dashboard.
  // Seed the selection from the live bindings instead.
  function boundDashboards(info) {
    if (!info) return null;
    const keys = [info.sourceId, info.datasourceId, info.externalId, info.id].filter(Boolean).map(String);
    const name = info.sourceName || info.datasourceName || info.name;
    const match = savedSources.find(source =>
      keys.includes(String(source.id)) || (name && source.name === name));
    const bound = match?.dashboards || [];
    return bound.length ? bound : null;
  }

  function seedDashboardSelection(info) {
    const bound = boundDashboards(info);
    if (bound) setSelectedDashboards(bound);
  }

  function stage(data) {
    if (data.items?.length) {
      const [first, ...rest] = data.items;
      setUploadQueue(rest);
      setPreview(first);
      setMapping(first.fieldMapping || {});
      setResult(null); setError(null); setStagedInfo(first);
      seedDashboardSelection(first);
      setWorkflowStep('preview');
      return;
    }
    setPreview(data);
    setMapping(data.fieldMapping || {});
    setResult(null);
    setError(null);
    setStagedInfo(data);
    seedDashboardSelection(data);
    setWorkflowStep('preview');
  }

  function committed(res) {
    setResult(res);
    loadSavedSources();
    loadSyncRuns();
    if (uploadQueue.length) {
      const [next, ...rest] = uploadQueue;
      setUploadQueue(rest); setPreview(next);
      setMapping(next.fieldMapping || {}); setStagedInfo(next);
      setWorkflowStep('preview');
    } else setPreview(null);
  }

  // Re-map a connected source: the server stages its own in-memory rows and
  // the ordinary mapping panel opens on them, pre-filled with the saved
  // mapping and the dashboards it already feeds.
  const [remapSource, setRemapSource] = useState(null);
  async function openMapping(source) {
    setRemapSource(source.id); setError(null); setResult(null);
    try {
      const { data } = await api.post(`/datasources/${source.id}/remap`);
      setPreview(data); setMapping(data.fieldMapping || {}); setStagedInfo(data);
      setSelectedDashboards(data.dashboards?.length ? data.dashboards : ['opportunity-analytics']);
      setWorkflowStep('mapping');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setError(error.response?.data?.error || error.message);
    } finally { setRemapSource(null); }
  }

  function reopen() {
    if (!stagedInfo) return;
    setPreview(stagedInfo);
    setMapping(stagedInfo.fieldMapping || {});
    setResult(null);
    setError(null);
    seedDashboardSelection(stagedInfo);
    setWorkflowStep('mapping');
  }

  return (
    <div className="wrap">
      <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
        <div className="brand"><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" /><span>TestMu BI</span></div>
        <div className="user-pill"><ThemeToggle /><button className="btn-secondary" onClick={() => navigate('/gallery')}>
          Back to templates
        </button></div>
      </div>

      <div className="gallery-header"><h2>Data Sources</h2></div>

      {!preview && (
        <>
          <nav className="tabs" style={{ marginBottom: 16 }}>
            <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
              Upload file
            </button>
            <button className={tab === 'tableau' ? 'on' : ''} onClick={() => setTab('tableau')}>
              Connect Tableau
            </button>
          </nav>

          {tab === 'upload'
            ? <UploadPanel onPreview={stage} setError={setError} setBusy={setBusy} busy={busy} />
            : <TableauPanel onPreview={stage} setError={setError} setBusy={setBusy} busy={busy} />}
        </>
      )}

      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--red)', marginTop: 16 }}>
          <b style={{ color: 'var(--red)' }}>Error</b>
          <p style={{ fontSize: 13, marginTop: 4 }}>{error}</p>
        </div>
      )}

      {preview && workflowStep === 'preview' && (
        <SourcePreview preview={preview}
          onMap={() => { setError(null); setWorkflowStep('mapping'); }}
          onCancel={() => { setPreview(null); setError(null); }} />
      )}

      {preview && workflowStep === 'mapping' && (
        <MappingPanel
          preview={preview} mapping={mapping} setMapping={setMapping}
          templateIds={selectedDashboards} setTemplateIds={setSelectedDashboards}
          alreadyBound={boundDashboards(stagedInfo) || []}
          busy={busy} setBusy={setBusy} setError={setError}
          onCancel={() => { setError(null); setWorkflowStep('preview'); }}
          onCommitted={committed}
        />
      )}

      {result && (
        <div className="card" style={{ borderLeft: '3px solid var(--teal)', marginTop: 16 }}>
          <b style={{ color: 'var(--teal)' }}>Loaded {result.rowCount.toLocaleString()} rows</b>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--txt-2)' }}>From {result.source}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={() => navigate(`/dashboard/${result.templateId}`)}>
              Open dashboard
            </button>
            <button className="btn-secondary" onClick={reopen}>
              Adjust mapping
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 8 }}>
            The source stays staged, so you can remap and reload without uploading again.
          </div>
        </div>
      )}

      {!preview && !result && stagedInfo && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <b style={{ fontSize: 13 }}>Still staged: {stagedInfo.filename}</b>
              <div className="hint">
                {stagedInfo.rowCount?.toLocaleString()} rows · mapping can be revised without re-uploading
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={reopen}>Open mapping</button>
              <button className="btn-secondary" onClick={async () => {
                await api.post('/datasources/staged/clear');
                setStagedInfo(null);
              }}>Discard</button>
            </div>
          </div>
        </div>
      )}

      {!preview && savedSources.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Connected data sources</h3>
          <div className="hint">Metadata and mappings are stored in Neon; uploaded business rows remain in runtime memory.</div>
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Source</th><th>Type</th><th>Rows</th><th>Dashboards</th><th>Status</th><th>Last refreshed</th><th /></tr></thead>
              <tbody>{savedSources.map(source => <tr key={source.id}>
                <td><b>{source.name}</b></td>
                <td>{String(source.sourceType || '').replaceAll('_', ' ')}</td>
                <td>{Number(source.rowCount || 0).toLocaleString()}</td>
                <td>{(source.dashboards || []).length
                  ? <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{source.dashboards.map(key =>
                      <button key={key} type="button" className="pill pill-link"
                        title={`Open ${labelFor(templates, key)}`} onClick={()=>navigate(`/dashboard/${key}`)}>
                        {labelFor(templates, key)} ↗
                      </button>)}</div>
                  : 'Not assigned'}</td>
                <td><span className="pill">{source.status}</span></td>
                <td>{formatRefreshTime(source.lastSync)}</td>
                <td style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button className="btn-secondary"
                    title="Change which source column feeds each dashboard field, and which dashboards this source serves — no re-upload or re-pull"
                    disabled={remapSource===source.id||refreshingSource===source.id||deletingSource===source.id}
                    onClick={()=>openMapping(source)}>{remapSource===source.id?'Opening…':'Edit mapping'}</button>
                  {source.sourceType?.startsWith('tableau') && <button className="btn-secondary"
                    disabled={refreshingSource===source.id||deletingSource===source.id} onClick={async()=>{
                      setRefreshingSource(source.id);setError(null);
                      try{await api.post(`/datasources/${source.id}/refresh`);await loadSavedSources();await loadSyncRuns();}
                      catch(error){setError(error.response?.data?.error||error.message);}
                      finally{setRefreshingSource(null);}
                    }}>{refreshingSource===source.id?'Refreshing…':'Refresh'}</button>}
                  {source.sourceType?.startsWith('tableau') && <button className="btn-secondary"
                    title={source.webhookEnabled
                      ? 'Tableau pushes an update to this app the moment the source refreshes. Click to turn off.'
                      : 'Ask Tableau to push an update to this app the moment the source refreshes, instead of waiting for the next scheduled sync.'}
                    style={source.webhookEnabled?{color:'var(--teal)',borderColor:'var(--teal)'}:undefined}
                    disabled={webhookBusySource===source.id} onClick={async()=>{
                      setWebhookBusySource(source.id);setError(null);
                      try{
                        await api.post(`/datasources/${source.id}/webhook/${source.webhookEnabled?'disable':'enable'}`);
                        await loadSavedSources();
                      }
                      catch(error){setError(error.response?.data?.error||error.message);}
                      finally{setWebhookBusySource(null);}
                    }}>{webhookBusySource===source.id?'Working…':source.webhookEnabled?'Auto-refresh: On':'Enable auto-refresh'}</button>}
                  <button className="btn-secondary" style={{color:'var(--red)'}}
                    disabled={refreshingSource===source.id||deletingSource===source.id} onClick={async()=>{
                      if(!window.confirm(`Delete "${source.name}"? This removes it from every dashboard it's bound to.`))return;
                      setDeletingSource(source.id);setError(null);
                      try{await api.delete(`/datasources/${source.id}`);await loadSavedSources();}
                      catch(error){setError(error.response?.data?.error||error.message);}
                      finally{setDeletingSource(null);}
                    }}>{deletingSource===source.id?'Deleting…':'Delete'}</button>
                </td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      {!preview && syncRuns.length>0 && <div className="card" style={{marginTop:16}}>
        <button type="button" className="btn-secondary" onClick={()=>setSyncHistoryOpen(open=>!open)}
          style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%'}}>
          <span>Sync history ({syncRuns.length})</span><span>{syncHistoryOpen?'▲':'▼'}</span>
        </button>
        {syncHistoryOpen && <div className="scroll" style={{marginTop:12,maxHeight:320}}><table>
          <thead><tr><th>Source</th><th>Status</th><th>Rows</th><th>Started</th><th>Error</th></tr></thead>
          <tbody>{syncRuns.map(run=><tr key={run.id}><td>{run.sourceName}</td><td>{run.status}</td>
            <td>{Number(run.rowsRead||0).toLocaleString()}</td><td>{new Date(run.startedAt).toLocaleString()}</td>
            <td>{run.error||'—'}</td></tr>)}</tbody></table></div>}
      </div>}
    </div>
  );
}

/* ================= Dedicated source preview ================= */

function SourcePreview({ preview, onMap, onCancel }) {
  const rows = useMemo(() => {
    if (preview.previewRows?.length) return preview.previewRows;
    const count = Math.max(0, ...preview.headers.map(header => preview.samples?.[header]?.length || 0));
    return Array.from({ length: count }, (_, index) => Object.fromEntries(
      preview.headers.map(header => [header, preview.samples?.[header]?.[index] ?? ''])
    ));
  }, [preview]);

  return <section className="source-workflow">
    <div className="workflow-steps" aria-label="Import progress">
      <span className="done">1 Upload</span><span className="active">2 Preview</span><span>3 Map fields</span><span>4 Load</span>
    </div>
    <div className="card source-preview-card">
      <div className="source-workflow-head">
        <div><div className="eyebrow">Data preview</div><h3>{preview.filename}</h3>
          <p>{preview.rowCount.toLocaleString()} rows · {preview.headers.length} source columns · showing the first {rows.length}</p></div>
        <div className="source-workflow-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Choose another source</button>
          <button type="button" className="btn-primary" onClick={onMap}>Map fields →</button>
        </div>
      </div>
      <div className="source-preview-table" role="region" aria-label="Uploaded source preview" tabIndex={0}>
        <table><thead><tr>{preview.headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map((row,index)=><tr key={index}>{preview.headers.map(header=><td key={header}
            title={String(row?.[header] ?? '')}>{String(row?.[header] ?? '') || '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="source-preview-foot"><span>Review column names and sample values before mapping.</span>
        <button type="button" className="btn-primary" onClick={onMap}>Map fields →</button></div>
    </div>
  </section>;
}

/* ================= Searchable column picker ================= */

function ColumnPicker({ value, options, usedHeaders, samples, placeholder, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [query, options]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) {
        const spaceBelow = window.innerHeight - r.bottom;
        const spaceAbove = r.top;
        const above = spaceBelow < 220 && spaceAbove > spaceBelow;
        setRect({ above, available: above ? spaceAbove : spaceBelow });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active + 1]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function start() {
    setOpen(true); setQuery('');
    setActive(Math.max(0, options.indexOf(value)));
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function close() { setOpen(false); setQuery(''); }
  function pick(option) { onChange(option); close(); }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  const menuHeight = Math.min(300, Math.max(120, (rect?.available ?? 300) - 16));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {!open ? (
        <button type="button" onClick={start} style={{
          ...controlStyle, textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: value ? 'var(--txt)' : 'var(--txt-3)',
          }}>{value || placeholder}</span>
          <span style={{ color: 'var(--txt-3)', fontSize: 10 }}>▼</span>
        </button>
      ) : (
        <input ref={inputRef} value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown} placeholder="Type to search columns…"
          style={{ ...controlStyle, outline: '2px solid var(--teal)', outlineOffset: -1 }} />
      )}

      {open && rect && (
        <div ref={listRef} style={{
          position: 'absolute', left: 0, width: '100%',
          top: rect.above ? 'auto' : 'calc(100% + 2px)',
          bottom: rect.above ? 'calc(100% + 2px)' : 'auto',
          maxHeight: menuHeight, overflowY: 'auto', zIndex: 1000,
          background: 'var(--card)', border: '1px solid var(--line)',
          borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
        }}>
          <Option label={placeholder} muted onSelect={() => pick('')} />
          {filtered.map((o, i) => (
            <Option key={o} label={o} active={i === active}
              used={usedHeaders.has(o) && o !== value}
              sample={(samples?.[o] || [])[0]}
              onSelect={() => pick(o)} onHover={() => setActive(i)} />
          ))}
          {!filtered.length && (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--txt-3)' }}>
              No column matches “{query}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ label, sample, used, active, muted, onSelect, onHover }) {
  return (
    <div onMouseDown={(e) => { e.preventDefault(); onSelect(); }} onMouseEnter={onHover}
      style={{
        padding: '7px 10px', cursor: 'pointer', fontSize: 12.5,
        background: active ? 'var(--line-2)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--teal)' : 'transparent'}`,
      }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        color: muted ? 'var(--txt-3)' : 'var(--txt)', fontStyle: muted ? 'italic' : 'normal',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {used && <span style={{ color: 'var(--txt-3)', fontSize: 11, flexShrink: 0 }}>used</span>}
      </div>
      {sample && (
        <div style={{
          fontSize: 11, color: 'var(--txt-3)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sample}</div>
      )}
    </div>
  );
}

/* ================= Upload ================= */

function UploadPanel({ onPreview, setError, setBusy, busy }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  async function send(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      files.forEach(file => form.append('files', file));
      const { data } = await api.post('/datasources/upload/batch-preview', form);
      onPreview(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>Upload files</h3>
      <div className="hint">Select up to 10 CSV, TSV, Excel or JSON files. Max 25 MB each.</div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--line)'}`,
          background: dragging ? 'rgba(14,147,132,0.05)' : 'transparent',
          borderRadius: 'var(--r)', padding: '40px 20px', textAlign: 'center',
          cursor: 'pointer', transition: 'all .15s', marginTop: 12,
        }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {busy ? 'Reading file…' : 'Drop a file here, or click to browse'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 4 }}>
          You'll see a preview of the mapped data before anything loads.
        </div>
      </div>

      <input ref={inputRef} type="file" multiple accept=".csv,.tsv,.xlsx,.xls,.json"
        style={{ display: 'none' }}
        onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/* ================= Tableau ================= */

function TableauPanel({ onPreview, setError, setBusy, busy }) {
  const [form, setForm] = useState({ server: '', siteId: '', patName: '', patSecret: '' });
  const [status, setStatus] = useState({ connected: false });
  const [kind, setKind] = useState('datasources');
  const [views, setViews] = useState(null);
  const [sources, setSources] = useState(null);
  const [filter, setFilter] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [importing, setImporting] = useState(null);
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    api.get('/datasources/tableau/status').then(({ data }) => setStatus(data)).catch(() => {});
  }, []);

  useEffect(() => { if (status.connected) load(kind); setSelected([]); }, [kind, status.connected]);

  async function load(which) {
    if (which === 'views' && views) return;
    if (which === 'datasources' && sources) return;
    setLoadingList(true); setError(null);
    try {
      if (which === 'views') {
        const { data } = await api.get('/datasources/tableau/views');
        setViews(data.views);
      } else {
        const { data } = await api.get('/datasources/tableau/datasources');
        setSources(data.datasources);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setLoadingList(false); }
  }

  async function connect() {
    setBusy(true); setError(null);
    try {
      const { data } = await api.post('/datasources/tableau/connect', form);
      setStatus({ connected: true, server: data.server, site: data.site });
      setForm(f => ({ ...f, patSecret: '' }));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  }

  async function importItem(item) {
    setImporting(item.id); setError(null);
    try {
      const { data } = kind === 'views'
        ? await api.post('/datasources/tableau/preview', {
            viewId: item.id, viewName: `${item.workbook} · ${item.name}` })
        : await api.post('/datasources/tableau/datasource-preview', {
            datasourceId: item.id, datasourceName: `${item.project} · ${item.name}` });
      onPreview(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setImporting(null); }
  }

  async function importSelected() {
    const items = shown.filter(item => selected.includes(item.id));
    if (!items.length) return;
    setImporting('batch'); setError(null);
    const previews = [];
    try {
      for (const item of items) {
        const { data } = kind === 'views'
          ? await api.post('/datasources/tableau/preview', {
              viewId: item.id, viewName: `${item.workbook} · ${item.name}` })
          : await api.post('/datasources/tableau/datasource-preview', {
              datasourceId: item.id, datasourceName: `${item.project} · ${item.name}` });
        previews.push(data);
      }
      onPreview({ items: previews });
    } catch (err) {
      setError(`${previews.length} of ${items.length} imported. ${err.response?.data?.error || err.message}`);
      if (previews.length) onPreview({ items: previews });
    } finally { setImporting(null); }
  }

  if (!status.connected) {
    return (
      <div className="card">
        <h3>Connect to Tableau Cloud</h3>
        <div className="hint">
          Credentials go only to this app's server. The token secret is encrypted before it is saved
          and is never returned to the browser.
        </div>

        <Field label="Server URL" value={form.server} onChange={v => setForm({ ...form, server: v })}
          placeholder="https://prod-apsoutheast-b.online.tableau.com"
          note="Host only — no /#/site/... path." />
        <Field label="Site ID" value={form.siteId} onChange={v => setForm({ ...form, siteId: v })}
          placeholder="lambdatest"
          note="The part after /site/ in your Tableau URL. Blank for the default site." />
        <Field label="Token name" value={form.patName} onChange={v => setForm({ ...form, patName: v })}
          placeholder="command-center" />
        <Field label="Token secret" type="password" value={form.patSecret}
          onChange={v => setForm({ ...form, patSecret: v })} placeholder="••••••••••••"
          note="My Account Settings → Personal Access Tokens. Shown only once." />

        <button className="btn-primary" style={{ marginTop: 14 }}
          disabled={busy || !form.server || !form.patName || !form.patSecret} onClick={connect}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    );
  }

  const list = kind === 'views' ? views : sources;
  const shown = (list || []).filter(v => {
    const hay = kind === 'views' ? `${v.workbook} ${v.name}` : `${v.project} ${v.name}`;
    return hay.toLowerCase().includes(filter.toLowerCase());
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3>Connected</h3>
          <div className="hint">{status.server} · site: {status.site || 'default'}</div>
        </div>
        <button className="btn-secondary" onClick={async () => {
          await api.post('/datasources/tableau/disconnect');
          setStatus({ connected: false }); setViews(null); setSources(null);
        }}>Disconnect</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        <Toggle on={kind === 'datasources'} onClick={() => setKind('datasources')}>
          Published data sources
        </Toggle>
        <Toggle on={kind === 'views'} onClick={() => setKind('views')}>
          Worksheets in workbooks
        </Toggle>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 6 }}>
        {kind === 'datasources'
          ? 'Extracts and live connections published to your site — including anything produced by a Prep flow.'
          : 'Individual sheets inside published workbooks.'}
      </div>

      <input placeholder={list ? `Filter ${list.length} items…` : 'Loading…'}
        value={filter} onChange={(e) => setFilter(e.target.value)} style={inputStyle} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button className="btn-primary" disabled={!selected.length || Boolean(importing)} onClick={importSelected}>
          {importing === 'batch' ? `Importing ${selected.length}…` : `Import selected (${selected.length})`}
        </button>
        <span className="hint">Each source gets its own mapping before it is connected to a dashboard.</span>
      </div>

      <div className="scroll" style={{ maxHeight: 420, marginTop: 10 }}>
        <table>
          <thead><tr><th style={{ width: 34 }}><input type="checkbox"
            checked={Boolean(shown.length) && shown.every(item => selected.includes(item.id))}
            onChange={event => setSelected(event.target.checked
              ? [...new Set([...selected, ...shown.map(item => item.id)])]
              : selected.filter(id => !shown.some(item => item.id === id)))} /></th>
            <th>{kind === 'views' ? 'Workbook' : 'Project'}</th><th>Name</th><th /></tr></thead>
          <tbody>
            {loadingList && <tr><td colSpan={4} style={{ color: 'var(--txt-3)' }}>Loading…</td></tr>}
            {!loadingList && shown.map(v => (
              <tr key={v.id}>
                <td><input type="checkbox" checked={selected.includes(v.id)}
                  onChange={() => setSelected(current => current.includes(v.id)
                    ? current.filter(id => id !== v.id) : [...current, v.id])} /></td>
                <td style={{ color: 'var(--txt-2)' }}>{kind === 'views' ? v.workbook : v.project}</td>
                <td><b>{v.name}</b></td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn-secondary" disabled={Boolean(importing)} onClick={() => importItem(v)}>
                    {importing === v.id ? 'Importing…' : 'Import'}
                  </button>
                </td>
              </tr>
            ))}
            {!loadingList && list && !shown.length && (
              <tr><td colSpan={4} style={{ color: 'var(--txt-3)' }}>Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      borderRadius: 6, fontFamily: 'inherit',
      border: `1px solid ${on ? 'var(--txt)' : 'var(--line)'}`,
      background: on ? 'var(--txt)' : 'transparent',
      color: on ? 'var(--card)' : 'var(--txt-2)',
    }}>{children}</button>
  );
}

/* ================= Mapping ================= */

function DashboardPicker({ value, onChange }) {
  const { templates: TEMPLATES } = useTemplates();
  const DASHBOARD_FIELDS = fieldsByTemplate(TEMPLATES);
  const [open, setOpen] = useState(false);
  const selected = TEMPLATES.filter(template => value.includes(template.id));
  const toggle = id => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  return <div className={`dashboard-picker${open ? ' open' : ''}`}>
    <label style={labelStyle}>Connect to dashboards</label>
    <button type="button" className="dashboard-picker-trigger" onClick={() => setOpen(current => !current)}
      aria-expanded={open}>
      <span><b>{selected.length ? `${selected.length} dashboard${selected.length === 1 ? '' : 's'} selected` : 'Select dashboards'}</b>
        <small>{selected.map(template => template.name).join(', ') || 'Choose at least one destination'}</small></span>
      <span className="dashboard-picker-caret">{open ? '▲' : '▼'}</span>
    </button>
    {open && <div className="dashboard-picker-options">
      <div className="dashboard-picker-options-head"><b>Dashboard destinations</b>
        <button type="button" onClick={() => onChange(value.length === TEMPLATES.length ? [] : TEMPLATES.map(template => template.id))}>
          {value.length === TEMPLATES.length ? 'Clear all' : 'Select all'}
        </button></div>
      <div className="dashboard-picker-grid">{TEMPLATES.map(template => <label key={template.id}
        className={value.includes(template.id) ? 'selected' : ''}>
        <input type="checkbox" checked={value.includes(template.id)} onChange={() => toggle(template.id)} />
        <span><b>{template.name}</b><small>{(DASHBOARD_FIELDS[template.id] || []).length} mapped fields</small></span>
      </label>)}</div>
      <button type="button" className="dashboard-picker-done" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </div>;
}

function MappingPanel({ preview, mapping, setMapping, templateIds, setTemplateIds, busy, setBusy, setError, onCancel, onCommitted, alreadyBound = [] }) {
  const [search, setSearch] = useState('');
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [fill, setFill] = useState({});

  const status = useMemo(() => {
    const s = {};
    for (const f of preview.fields) {
      if (mapping[f.key]) s[f.key] = preview.confidence?.[f.key] === 'exact' ? 'exact' : 'mapped';
      else if (f.derivable && mapping[f.derivable]) s[f.key] = 'derived';
      else s[f.key] = 'unmapped';
    }
    return s;
  }, [mapping, preview]);

  // Recalculate fill rates whenever mapping changes (debounced).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post('/datasources/preview/rows', { stagingId: preview.stagingId, fieldMapping: mapping, limit: 25 });
        if (!cancelled) setFill(data.fillRates || {});
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || err.message);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mapping, preview.stagingId]);

  // Committing rewrites this source's bindings, so anything currently bound
  // and now unticked is about to be detached. Naming them is the difference
  // between a reversible mistake and a dashboard that silently stops loading.
  const aboutToUnbind = (alreadyBound || []).filter(key => !templateIds.includes(key));

  const { templates } = useTemplates();
  // Empty until the registry arrives. Callers must read that as "not known
  // yet", never as "this dashboard needs no fields" - showing a field list
  // built from a stale copy is exactly the bug this refactor removes.
  const relevantKeys = useMemo(
    () => new Set(templateIds.flatMap(id => (templates.find(t => t.id === id) || {}).fields || [])),
    [templateIds, templates]);
  const relevantFields = preview.fields.filter(field => relevantKeys.has(field.key));
  const mappedCount = relevantFields.filter(f => status[f.key] !== 'unmapped').length;
  const essentialGaps = relevantFields.filter(f => f.group === 'essential' && status[f.key] === 'unmapped');
  const identityGaps = relevantFields.filter(f => ['id','accountId'].includes(f.key) && status[f.key] === 'unmapped');
  const usedHeaders = new Set(relevantFields.map(field => mapping[field.key]).filter(Boolean));

  // A mapped field that is almost entirely blank usually means the wrong column.
  const suspect = relevantFields.filter(f => mapping[f.key] && (fill[f.key] ?? 100) < 15);

  async function commit() {
    if (!templateIds.length) {
      setError('Select at least one dashboard before loading.');
      return;
    }

    // A staged preview can outlive a schema update. Recover exact identity
    // headers at click time so a valid upload is not blocked by stale mapping
    // metadata, while still refusing ambiguous name-based counts.
    const normalizeHeader = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const identityAliases = {
      id: new Set(['opportunityid','oppid','recordid','sfid']),
      accountId: new Set(['accountid','accountidentifier','acctid','salesforceaccountid']),
    };
    const resolvedMapping = { ...mapping };
    for (const field of identityGaps) {
      const header = preview.headers.find(value => identityAliases[field.key]?.has(normalizeHeader(value)));
      if (header) resolvedMapping[field.key] = header;
    }
    const unresolved = identityGaps.filter(field => !resolvedMapping[field.key]);
    if (unresolved.length) {
      const labels = unresolved.map(field => field.label).join(' and ');
      setOnlyUnmatched(true);
      setSearch(unresolved[0].label);
      setError(`${labels} must be mapped before loading so distinct counts remain accurate.`);
      return;
    }

    if (Object.keys(resolvedMapping).some(key => resolvedMapping[key] !== mapping[key])) setMapping(resolvedMapping);
    setBusy(true); setError(null);
    try {
      // Persist every column that actually matched, NOT just the fields the
      // currently-selected dashboards happen to use. The saved mapping is
      // what every later refresh re-applies (datasources.js refreshSource),
      // so filtering it to relevantKeys permanently discarded real matches:
      // a source committed while only Win Board was ticked lost Cycle days,
      // Is stalled, Days in stage, Deal health, Owner and more — they were
      // auto-matched on screen, then stripped before saving, leaving those
      // columns null forever for Opportunity Analytics. Nulls are still
      // dropped so a field with no match today can inherit an automatic one
      // if the source later gains that column.
      const fieldMapping = Object.fromEntries(Object.entries(resolvedMapping).filter(([, header]) => header));
      const { data } = await api.post('/datasources/upload/commit', {
        stagingId: preview.stagingId,
        templateId: templateIds[0], // compatibility with an already-running legacy server
        templateIds,
        fieldMapping,
      });
      onCommitted(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  }

  return (
    <section className="source-workflow">
      <div className="workflow-steps" aria-label="Import progress">
        <span className="done">1 Upload</span><span className="done">2 Preview</span><span className="active">3 Map fields</span><span>4 Load</span>
      </div>
    <div className="card mapping-card">
      <div className="source-workflow-head">
        <div>
          <div className="eyebrow">Field mapping</div><h3>Match dashboard fields to source columns</h3>
          <div className="hint">
            {preview.filename} · {preview.rowCount.toLocaleString()} rows · {preview.headers.length} columns
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: essentialGaps.length ? 'var(--amber)' : 'var(--teal)' }}>
            {mappedCount} of {relevantFields.length} relevant fields ready
          </div>
          <button type="button" className="btn-secondary" onClick={onCancel}>← Back to preview</button>
        </div>
      </div>

      <div style={{ height: 4, background: 'var(--line-2)', borderRadius: 2, margin: '12px 0 4px' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${relevantFields.length ? (mappedCount / relevantFields.length) * 100 : 0}%`,
          background: essentialGaps.length ? 'var(--amber)' : 'var(--teal)',
          transition: 'width .2s',
        }} />
      </div>

      {essentialGaps.length > 0 && (
        <div style={noticeStyle}>
          <b style={{ color: 'var(--amber)' }}>
            {essentialGaps.length} essential field{essentialGaps.length > 1 ? 's' : ''} unmatched:
          </b>{' '}
          {essentialGaps.map(f => f.label).join(', ')}.
        </div>
      )}

      {suspect.length > 0 && (
        <div style={noticeStyle}>
          <b style={{ color: 'var(--amber)' }}>Mostly blank after mapping:</b>{' '}
          {suspect.map(f => `${f.label} (${fill[f.key]}%)`).join(', ')}.
          <div style={{ color: 'var(--txt-2)', marginTop: 3 }}>
            Usually means the wrong column, or one whose type doesn't convert.
          </div>
        </div>
      )}

      {aboutToUnbind.length > 0 && (
        <div className="unbind-warning" role="alert">
          <b>This will unbind {aboutToUnbind.length} dashboard{aboutToUnbind.length===1?'':'s'}</b>
          <p>Committing rewrites this source&rsquo;s bindings. <b>{aboutToUnbind.join(', ')}</b> {aboutToUnbind.length===1?'is':'are'} bound
            to it now and will stop loading data unless {aboutToUnbind.length===1?'it is':'they are'} ticked below.</p>
          <button type="button" className="btn-secondary"
            onClick={() => setTemplateIds([...new Set([...templateIds, ...aboutToUnbind])])}>
            Keep {aboutToUnbind.length===1?'it':'them'} bound
          </button>
        </div>
      )}

      {/* ---- Controls ---- */}
      <div className="mapping-controls">
        <DashboardPicker value={templateIds} onChange={setTemplateIds} />
        <div style={{ flex: '2 1 260px' }}>
          <label style={labelStyle}>Find a dashboard field</label>
          <input placeholder="e.g. region, owner, ARR" value={search}
            onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearch(''); }}
            style={inputStyle} autoComplete="off" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, paddingBottom: 9 }}>
          <input type="checkbox" checked={onlyUnmatched}
            onChange={e => setOnlyUnmatched(e.target.checked)} />
          Only unmatched
        </label>
      </div>

      {/* ---- Field groups ---- */}
      <div style={{ marginTop: 6 }}>
        {preview.groups.map(group => {
          const fields = relevantFields.filter(f => {
            if (f.group !== group.key) return false;
            const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const haystack = `${f.label} ${f.key} ${f.hint || ''} ${mapping[f.key] || ''}`.toLowerCase();
            if (terms.length && !terms.every(term => haystack.includes(term))) return false;
            if (onlyUnmatched && status[f.key] !== 'unmapped') return false;
            return true;
          });
          if (!fields.length) return null;

          return (
            <div key={group.key} className="mapping-group">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase' }}>
                  {group.label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--txt-3)' }}>{group.note}</div>
              </div>

              <div className="mapping-field-list">
                {fields.map((f, i) => (
                  <FieldRow key={f.key} field={f} state={status[f.key]}
                    value={mapping[f.key] || ''} headers={preview.headers}
                    usedHeaders={usedHeaders} samples={preview.samples}
                    fill={fill[f.key]} striped={i % 2 === 1}
                    onChange={(header) => setMapping({ ...mapping, [f.key]: header || null })} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mapping-footer">
        <button type="button" className="btn-primary" disabled={busy} onClick={commit}>
          {busy ? 'Loading…' : `Load ${preview.rowCount.toLocaleString()} rows`}
        </button>
        {identityGaps.length > 0 && <span style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>
          Required before loading: {identityGaps.map(field => field.label).join(', ')}
        </span>}
        <span style={{ fontSize: 12, color: 'var(--txt-3)' }}>
          You can come back and remap without re-uploading.
        </span>
      </div>
    </div>
    </section>
  );
}

function FieldRow({ field, state, value, headers, usedHeaders, samples, fill, striped, onChange }) {
  const low = value && fill !== undefined && fill < 15;
  return (
    <div className="mapping-field-row" style={{
      display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(220px,1.2fr) minmax(0,1fr)',
      gap: 12, alignItems: 'center', padding: '10px 12px',
      background: striped ? 'var(--line-2)' : 'transparent',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot state={state} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{field.label}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt-3)', marginLeft: 14 }}>{field.hint}</div>
      </div>

      <ColumnPicker value={value} options={headers} usedHeaders={usedHeaders} samples={samples}
        placeholder={state === 'derived' ? `derived from ${field.derivable}` : 'not mapped'}
        onChange={onChange} />

      <div style={{ fontSize: 11.5, color: low ? 'var(--amber)' : 'var(--txt-3)' }}>
        {value && fill !== undefined
          ? `${fill}% populated`
          : state === 'derived' ? 'auto' : ''}
      </div>
    </div>
  );
}

function StatusDot({ state }) {
  const color = { exact: 'var(--teal)', mapped: 'var(--blue)', derived: 'var(--violet)', unmapped: 'var(--line)' }[state];
  const title = { exact: 'Matched automatically', mapped: 'Matched', derived: 'Derived from another field', unmapped: 'Not mapped' }[state];
  return <span title={title} style={{
    width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
    border: state === 'unmapped' ? '1px solid var(--txt-3)' : 'none',
  }} />;
}

/* ================= bits ================= */

const labelStyle = {
  display: 'block', fontSize: 10.5, textTransform: 'uppercase',
  letterSpacing: '0.6px', color: 'var(--txt-3)', fontWeight: 650,
};

const controlStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
  background: 'var(--card)', color: 'var(--txt)',
};

const inputStyle = { ...controlStyle, marginTop: 4 };

const noticeStyle = {
  background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.25)',
  borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginTop: 10,
};

function Field({ label, note, type = 'text', value, onChange, placeholder }) {
  return (
    <div style={{ marginTop: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} style={inputStyle}
        autoComplete={type === 'password' ? 'new-password' : 'off'} />
      {note && <div style={{ fontSize: 11.5, color: 'var(--txt-3)', marginTop: 3 }}>{note}</div>}
    </div>
  );
}

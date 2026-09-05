import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  listDataSources, getChartOptions, previewChart, createChart, getChart, updateChart, inspectChart,
  listCustomDashboards, getCustomDashboard, updateCustomDashboard, createCustomDashboard,
} from '../lib/api';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import BuilderChart from '../components/BuilderChart';
import RowsModal from '../components/RowsModal';
import AppLoader from '../components/AppLoader';

// From "I have a dataset" to "a chart on a dashboard" in under a minute:
// pick a source, pick a chart type (impossible ones are greyed with the
// reason), and the field slots arrive pre-filled from the source's column
// profiles. Every slot stays overridable; the preview re-renders as you go.
// Saving stores the CONFIG — dataset id, type, bindings, filters, display
// options — never the data, so the chart follows every future sync.
//
// The "Add to" destination is what makes multi-chart canvases one loop:
// save lands the chart on the chosen dashboard and returns you there, and a
// dashboard's own "New chart" button arrives here with ?dashboard= preset.

const AGG_LABELS = { sum: 'Sum', avg: 'Average', count: 'Count of rows', min: 'Minimum', max: 'Maximum' };
const SORTS = [['value_desc', 'Largest first'], ['value_asc', 'Smallest first'], ['label', 'A → Z']];
const LIMITS = [5, 10, 25, 50, 100];
const FORMATS = [['number', 'Number'], ['currency', 'Currency ($)'], ['percent', 'Percent (%)']];
const NEW_DASHBOARD = '__new__';

export default function ChartBuilder() {
  const navigate = useNavigate();
  const { chartId } = useParams();               // present in edit mode
  const [searchParams] = useSearchParams();
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState(searchParams.get('source') || '');
  const [options, setOptions] = useState(null);  // {source, columns, types}
  const [typeKey, setTypeKey] = useState('');
  const [slots, setSlots] = useState({});
  const [filters, setFilters] = useState([]);
  const [display, setDisplay] = useState({ sort: 'value_desc', limit: 25, format: 'number', horizontal: false, stacked: false, showValues: null });
  const [drill, setDrill] = useState(null);      // {where} from a clicked element
  const [name, setName] = useState('');
  const [dashboards, setDashboards] = useState([]);
  const [destination, setDestination] = useState(searchParams.get('dashboard') || '');
  const [preview, setPreview] = useState({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => { listDataSources().then(setSources).catch(() => setSources([])); }, []);
  useEffect(() => { listCustomDashboards().then(setDashboards).catch(() => {}); }, []);

  // Edit mode: hydrate everything from the saved chart before the first paint
  // of the slot panel, so the user edits what is actually saved.
  useEffect(() => {
    if (!chartId) return;
    getChart(chartId).then(chart => {
      setSourceId(chart.sourceId);
      setTypeKey(chart.config.type);
      setSlots(chart.config.slots || {});
      setFilters(chart.config.filters || []);
      setDisplay(current => ({ ...current,
        sort: chart.config.sort || 'value_desc',
        limit: chart.config.limit || 25,
        ...(chart.config.options || {}) }));
      setName(chart.name);
    }).catch(e => setError(e.response?.data?.error || 'Could not load the chart'));
  }, [chartId]);

  useEffect(() => {
    if (!sourceId) { setOptions(null); return; }
    setOptions(null);
    getChartOptions(sourceId)
      .then(data => { setOptions(data); setError(''); })
      .catch(e => setError(e.response?.data?.error || 'Could not load the source schema'));
  }, [sourceId]);

  const activeType = useMemo(() => options?.types.find(type => type.key === typeKey) || null, [options, typeKey]);

  const pickType = type => {
    if (!type.available) return;
    setTypeKey(type.key);
    // Fresh suggestion on every type switch — but never blow away bindings the
    // user made for the SAME type in edit mode.
    if (type.key !== typeKey) setSlots(type.suggestion || {});
  };

  const config = useMemo(() => (typeKey && options
    ? {
        version: options.configVersion, type: typeKey, slots, filters,
        sort: display.sort, limit: display.limit,
        options: {
          format: display.format,
          horizontal: display.horizontal,
          stacked: display.stacked,
          ...(display.showValues === null ? {} : { showValues: display.showValues }),
        },
      }
    : null), [typeKey, slots, filters, display, options]);

  useEffect(() => {
    if (!config || !sourceId) { setPreview({ state: 'idle' }); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreview(current => ({ ...current, state: 'loading' }));
      previewChart(sourceId, config)
        // forType makes the payload self-identifying: each chart type's data
        // has a different shape, and rendering type A with type B's data (the
        // debounce window after switching types) crashed the renderer.
        .then(({ data }) => setPreview({ state: 'ok', data, forType: config.type }))
        .catch(e => setPreview({ state: 'error', message: e.response?.data?.error || 'Preview failed' }));
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [config, sourceId]);

  const bindSlot = (slot, columnName) => {
    setSlots(current => ({
      ...current,
      [slot.key]: slot.multi
        ? (columnName?.length ? { columns: columnName } : null) // multi passes the array directly
        : columnName
          ? { ...current[slot.key], column: columnName,
              ...(slot.aggregations && !current[slot.key]?.aggregation ? { aggregation: slot.aggregations[0] } : {}) }
          : null,
    }));
  };

  // Append the chart to a dashboard's layout as a half-width tile below
  // everything else; the grid's edit mode is where it gets rearranged.
  const placeOnDashboard = async (dashboardId, id) => {
    const dashboard = await getCustomDashboard(dashboardId);
    if ((dashboard.layout || []).some(tile => tile.chartId === id)) return; // already there
    const maxY = Math.max(0, ...(dashboard.layout || []).map(tile => Number(tile.y) + Number(tile.h)));
    await updateCustomDashboard(dashboardId, {
      layout: [...(dashboard.layout || []), { chartId: id, x: 0, y: maxY, w: 6, h: 6 }],
    });
  };

  const save = async () => {
    if (!name.trim()) return setError('Give the chart a name first');
    setSaving(true); setError('');
    try {
      const saved = chartId
        ? await updateChart(chartId, { name: name.trim(), config })
        : await createChart({ sourceId, name: name.trim(), config });
      let target = destination;
      if (target === NEW_DASHBOARD) {
        const dashboardName = window.prompt('Name the new dashboard', name.trim());
        if (dashboardName?.trim()) target = (await createCustomDashboard(dashboardName.trim())).id;
        else target = '';
      }
      if (target) {
        await placeOnDashboard(target, saved.id);
        navigate(`/dashboards/custom/${target}`);
      } else {
        navigate('/gallery');
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save the chart');
      setSaving(false);
    }
  };

  if (sources === null) return <AppLoader fullscreen label="Loading sources…" />;

  const showDisplayCard = activeType && ['bar', 'line', 'donut', 'kpi', 'scatter', 'table'].includes(typeKey);

  return <div className="wrap builder-wrap">
    <div className="top-nav" style={{ margin: '-18px -18px 18px' }}>
      <div className="brand"><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI" /><span>Chart builder</span></div>
      <div className="user-pill"><ThemeToggle />
        <DashboardSwitcher />
        <button className="btn-secondary" onClick={() => navigate(destination && destination !== NEW_DASHBOARD ? `/dashboards/custom/${destination}` : '/gallery')}>Back</button></div>
    </div>

    <div className="builder-toolbar card">
      <label><span>Data source</span>
        <select value={sourceId} onChange={e => { setSourceId(e.target.value); setTypeKey(''); setSlots({}); setFilters([]); }} disabled={Boolean(chartId)}>
          <option value="">Choose a source…</option>
          {sources.map(source => <option key={source.id} value={source.id}>
            {source.name} · {source.rowCount ?? '?'} rows{source.status !== 'loaded' ? ` (${source.status})` : ''}
          </option>)}
        </select>
      </label>
      <label style={{ flex: 1 }}><span>Chart name</span>
        <input value={name} placeholder="e.g. ARR by region" maxLength={120} onChange={e => setName(e.target.value)} />
      </label>
      <label><span>Add to</span>
        <select value={destination} onChange={e => setDestination(e.target.value)}>
          <option value="">No dashboard (just save)</option>
          {dashboards.map(dashboard => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
          <option value={NEW_DASHBOARD}>+ New dashboard…</option>
        </select>
      </label>
      <button className="btn-primary" disabled={!config || saving || preview.state === 'error'} onClick={save}>
        {saving ? 'Saving…' : chartId ? 'Save changes' : destination ? 'Save & place' : 'Save chart'}
      </button>
    </div>
    {error && <div className="card" style={{ color: 'var(--red)' }}>{error}</div>}
    {options && !options.source.live && <div className="card hint">
      This source&rsquo;s rows are not loaded right now (the server restarted since its last sync).
      Field suggestions still work from the stored schema, but the preview needs a refresh from the Data Sources page.
    </div>}

    {options && <div className="builder-layout">
      <aside className="builder-rail">
        <section className="card">
          <h3>Chart type</h3>
          <div className="builder-type-list">
            {options.types.map(type => <button key={type.key} type="button"
              className={`builder-type${type.key === typeKey ? ' is-active' : ''}${type.available ? '' : ' is-unavailable'}`}
              title={type.available ? type.description : type.reason}
              onClick={() => pickType(type)}>
              <b>{type.label}</b>
              <span>{type.available ? type.description : type.reason}</span>
            </button>)}
          </div>
        </section>
      </aside>

      <aside className="builder-side">
        {activeType && <section className="card">
          <h3>Fields</h3>
          {activeType.slots.map(slot => {
            const bound = slots[slot.key];
            const candidates = options.columns.filter(column => slot.accepts.includes(column.type)
              && (!slot.maxDistinct || (!column.distinctCapped && column.distinct <= slot.maxDistinct)));
            if (slot.multi) {
              const picked = bound?.columns || [];
              return <label key={slot.key} className="builder-slot"><span>{slot.label}</span>
                <select multiple size={Math.min(8, options.columns.length)} value={picked}
                  onChange={e => bindSlot(slot, [...e.target.selectedOptions].map(o => o.value))}>
                  {options.columns.map(column => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}
                </select>
              </label>;
            }
            return <div key={slot.key} className="builder-slot">
              <label><span>{slot.label}{slot.required ? '' : ' (optional)'}</span>
                <select value={bound?.column || ''} onChange={e => bindSlot(slot, e.target.value)}>
                  <option value="">{slot.required ? 'Choose a column…' : '— none —'}</option>
                  {candidates.map(column => <option key={column.name} value={column.name}>
                    {column.name} · {column.type}{column.fillRate < 100 ? ` · ${column.fillRate}% filled` : ''}
                  </option>)}
                </select>
              </label>
              {slot.aggregations && bound?.column && <label><span>Aggregation</span>
                <select value={bound.aggregation || slot.aggregations[0]}
                  onChange={e => setSlots(current => ({ ...current, [slot.key]: { ...current[slot.key], aggregation: e.target.value } }))}>
                  {slot.aggregations.map(agg => <option key={agg} value={agg}>{AGG_LABELS[agg] || agg}</option>)}
                </select>
              </label>}
              {slot.key === 'x' && activeType.options?.grains && bound?.column && <label><span>Group by</span>
                <select value={bound.grain || activeType.options.defaultGrain}
                  onChange={e => setSlots(current => ({ ...current, x: { ...current.x, grain: e.target.value } }))}>
                  {activeType.options.grains.map(grain => <option key={grain} value={grain}>{grain}</option>)}
                </select>
              </label>}
            </div>;
          })}
        </section>}

        {showDisplayCard && <section className="card">
          <h3>Display</h3>
          {['bar', 'donut'].includes(typeKey) && <label className="builder-slot"><span>Sort</span>
            <select value={display.sort} onChange={e => setDisplay({ ...display, sort: e.target.value })}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>}
          {['bar', 'donut', 'table'].includes(typeKey) && <label className="builder-slot"><span>Show top</span>
            <select value={display.limit} onChange={e => setDisplay({ ...display, limit: Number(e.target.value) })}>
              {LIMITS.map(limit => <option key={limit} value={limit}>{typeKey === 'table' ? `${limit * 4} rows` : `${limit} categories`}</option>)}
            </select>
          </label>}
          {typeKey !== 'table' && <label className="builder-slot"><span>Value format</span>
            <select value={display.format} onChange={e => setDisplay({ ...display, format: e.target.value })}>
              {FORMATS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>}
          {typeKey === 'bar' && <label className="builder-check">
            <input type="checkbox" checked={display.horizontal}
              onChange={e => setDisplay({ ...display, horizontal: e.target.checked })} />
            <span>Horizontal bars</span>
          </label>}
          {typeKey === 'bar' && slots.series?.column && <label className="builder-check">
            <input type="checkbox" checked={display.stacked}
              onChange={e => setDisplay({ ...display, stacked: e.target.checked })} />
            <span>Stack the series</span>
          </label>}
          {['bar', 'line'].includes(typeKey) && <label className="builder-check">
            <input type="checkbox"
              checked={display.showValues ?? (typeKey === 'bar' && !display.horizontal)}
              onChange={e => setDisplay({ ...display, showValues: e.target.checked })} />
            <span>Values on the marks</span>
          </label>}
        </section>}

        {activeType && <section className="card">
          <h3>Filters</h3>
          <p className="hint">Applied before aggregation — the chart only ever sees rows that pass.</p>
          {filters.map((filter, index) => {
            const column = options.columns.find(c => c.name === filter.column);
            const update = patch => setFilters(current => current.map((f, i) => i === index ? { ...f, ...patch } : f));
            return <div key={index} className="builder-filter">
              <div className="builder-filter-head">
                <b>{filter.column}</b>
                <button type="button" title="Remove filter"
                  onClick={() => setFilters(current => current.filter((_, i) => i !== index))}>✕</button>
              </div>
              {filter.op === 'in'
                ? <input placeholder="Values, comma separated — e.g. AMER, EMEA"
                    value={(filter.values || []).join(', ')}
                    onChange={e => update({ values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} />
                : <div className="builder-filter-range">
                    <input type={column?.type === 'date' ? 'date' : 'number'} value={filter.from ?? ''}
                      placeholder="from" onChange={e => update({ from: e.target.value })} />
                    <span>to</span>
                    <input type={column?.type === 'date' ? 'date' : 'number'} value={filter.to ?? ''}
                      placeholder="to" onChange={e => update({ to: e.target.value })} />
                  </div>}
            </div>;
          })}
          <select value="" onChange={e => {
            const column = options.columns.find(c => c.name === e.target.value);
            if (!column) return;
            setFilters(current => [...current, column.type === 'number' || column.type === 'date'
              ? { column: column.name, op: 'range', kind: column.type === 'date' ? 'date' : 'number', from: '', to: '' }
              : { column: column.name, op: 'in', values: [] }]);
          }}>
            <option value="">Add a filter…</option>
            {options.columns.map(column => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}
          </select>
        </section>}
      </aside>

      <section className="card builder-preview">
        <h3>Preview{typeKey && ['bar', 'line', 'donut'].includes(typeKey) ? ' · click an element to see its rows' : ''}</h3>
        {preview.state === 'idle' && <div className="builder-chart-empty">Pick a chart type to see a live preview.</div>}
        {preview.state === 'error' && <div className="builder-chart-empty" style={{ color: 'var(--red)' }}>{preview.message}</div>}
        {(preview.state === 'ok' || preview.state === 'loading') && (
          preview.data && preview.forType === typeKey
            ? <BuilderChart type={typeKey} data={preview.data} options={config?.options}
                onElementClick={where => setDrill({ where })} />
            : <div className="builder-chart-empty">Updating preview…</div>)}
      </section>
    </div>}

    {drill && config && <RowsModal
      title={Object.values(drill.where).join(' · ') || 'Matching rows'}
      fetcher={() => inspectChart({ sourceId, config, where: drill.where })}
      onClose={() => setDrill(null)}
      onFilterTo={(drill.where.category !== undefined || drill.where.series !== undefined) ? () => {
        // "Filter chart to this" pins the clicked element as an in-filter on
        // the column that produced it. The time axis stays unpinned — a date
        // range filter is the honest tool there, one click away above.
        const additions = [];
        if (drill.where.category !== undefined && slots.category?.column) {
          additions.push({ column: slots.category.column, op: 'in', values: [drill.where.category] });
        }
        if (drill.where.series !== undefined && slots.series?.column) {
          additions.push({ column: slots.series.column, op: 'in', values: [drill.where.series] });
        }
        setFilters(current => [...current, ...additions]);
        setDrill(null);
      } : undefined} />}
  </div>;
}

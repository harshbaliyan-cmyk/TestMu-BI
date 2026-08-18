import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const pad = value => String(value).padStart(2, '0');
export const isoDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const atDate = (year, month, day) => new Date(year, month, day, 12);
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, date.getDate(), 12);
const startOfWeek = date => addDays(date, -((date.getDay() + 6) % 7));
const endBefore = date => addDays(date, -1);

const LABELS = {
  all: 'All dates', currentWeek: 'Current week', previousWeek: 'Previous week',
  currentQuarter: 'Current quarter', previousQuarter: 'Previous quarter',
  currentYear: 'Current year', previousYear: 'Previous year',
  last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days',
  previousN: 'Previous periods', custom: 'Custom range',
};

export function rangeFor(key, count = 1, unit = 'quarter') {
  const now = new Date();
  const today = atDate(now.getFullYear(), now.getMonth(), now.getDate());
  const year = today.getFullYear();
  const quarterStart = atDate(year, Math.floor(today.getMonth() / 3) * 3, 1);
  const weekStart = startOfWeek(today);

  switch (key) {
    case 'currentWeek': return [weekStart, today];
    case 'previousWeek': return [addDays(weekStart, -7), endBefore(weekStart)];
    case 'currentQuarter': return [quarterStart, today];
    case 'previousQuarter': return [addMonths(quarterStart, -3), endBefore(quarterStart)];
    case 'currentYear': return [atDate(year, 0, 1), today];
    case 'previousYear': return [atDate(year - 1, 0, 1), atDate(year - 1, 11, 31)];
    case 'last7': return [addDays(today, -6), today];
    case 'last30': return [addDays(today, -29), today];
    case 'last90': return [addDays(today, -89), today];
    case 'previousN': {
      const n = Math.max(1, Math.min(52, Number(count) || 1));
      if (unit === 'week') return [addDays(weekStart, -7 * n), endBefore(weekStart)];
      if (unit === 'year') return [atDate(year - n, 0, 1), atDate(year - 1, 11, 31)];
      return [addMonths(quarterStart, -3 * n), endBefore(quarterStart)];
    }
    default: return [null, null];
  }
}

function shortDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]} ${year}`;
}

// Which date the range applies to is a per-dashboard choice: Win Board and
// Loss Board rank on the Opportunity Created Date, AE Performance on the Opp
// Close Date (a rep's Won ARR belongs to the period the deal closed in, not
// the period it was first raised). Defaults keep created-date behaviour, so
// the boards that want it pass nothing.
export default function AdvancedDateRange({
  filters, setFilters, fromKey = 'createdFrom', toKey = 'createdTo',
  label = 'Opportunity created date', title = 'Opportunity Created Date', emptyLabel = 'All created dates',
}) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [count, setCount] = useState(filters.dateCount || 4);
  const [unit, setUnit] = useState(filters.dateUnit || 'quarter');
  const from = filters[fromKey], to = filters[toKey];
  const [customFrom, setCustomFrom] = useState(from || '');
  const [customTo, setCustomTo] = useState(to || '');

  useEffect(() => {
    setCustomFrom(from || '');
    setCustomTo(to || '');
  }, [from, to]);

  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(520, window.innerWidth - 24);
      setRect({
        width,
        left: Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(box.bottom + 8, window.innerHeight - 580)),
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

  const summary = useMemo(() => {
    if (!from && !to) return emptyLabel;
    const preset = LABELS[filters.datePreset];
    const range = `${shortDate(from) || 'Start'} – ${shortDate(to) || 'Today'}`;
    if (filters.datePreset === 'previousN') {
      const word = filters.dateUnit === 'year' ? 'years' : filters.dateUnit === 'week' ? 'weeks' : 'quarters';
      return `Previous ${filters.dateCount || count} ${word} · ${range}`;
    }
    return `${preset && filters.datePreset !== 'custom' ? `${preset} · ` : ''}${range}`;
  }, [from, to, filters.datePreset, filters.dateCount, filters.dateUnit, count, emptyLabel]);

  const apply = (key, nextCount = count, nextUnit = unit) => {
    const [nextFrom, nextTo] = rangeFor(key, nextCount, nextUnit);
    setFilters(current => ({ ...current,
      [fromKey]: nextFrom ? isoDate(nextFrom) : '', [toKey]: nextTo ? isoDate(nextTo) : '',
      datePreset: key, dateCount: nextCount, dateUnit: nextUnit,
    }));
    setOpen(false);
  };

  const applyCustom = () => {
    setFilters(current => ({ ...current, [fromKey]: customFrom, [toKey]: customTo, datePreset: 'custom' }));
    setOpen(false);
  };

  const quickGroups = [
    ['Weeks', [['currentWeek','Current week'],['previousWeek','Previous week']]],
    ['Quarters', [['currentQuarter','Current quarter'],['previousQuarter','Previous quarter']]],
    ['Years', [['currentYear','Current year'],['previousYear','Previous year']]],
    ['Rolling', [['last7','Last 7 days'],['last30','Last 30 days'],['last90','Last 90 days']]],
  ];

  return <div className="fg advanced-date-field">
    <label>{label}</label>
    <button ref={triggerRef} type="button" className={`date-range-trigger advanced-date-trigger${open ? ' on' : ''}`}
      onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="date-range-icon" aria-hidden="true">▣</span><span>{summary}</span><span className="ms-caret">▼</span>
    </button>
    {open && rect && createPortal(<div ref={panelRef} className="advanced-date-panel" style={rect}>
      <div className="advanced-date-head"><div><b>{title}</b><span>Choose a relative period or enter exact dates.</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
      <div className="advanced-date-groups">
        {quickGroups.map(([heading, choices]) => <section key={heading}><h4>{heading}</h4><div>{choices.map(([key,label]) =>
          <button key={key} type="button" className={filters.datePreset === key ? 'selected' : ''} onClick={() => apply(key)}>{label}</button>)}</div></section>)}
      </div>
      <section className="advanced-date-n"><h4>Previous N completed periods</h4><div className="advanced-date-n-controls">
        <input type="number" min="1" max="52" value={count} onChange={event => setCount(Math.max(1, Math.min(52, Number(event.target.value) || 1)))} aria-label="Number of periods"/>
        <select value={unit} onChange={event => setUnit(event.target.value)} aria-label="Period unit"><option value="week">Weeks</option><option value="quarter">Quarters</option><option value="year">Years</option></select>
        <button type="button" className="btn-primary" onClick={() => apply('previousN')}>Apply</button>
      </div><p>Uses completed periods and excludes the current incomplete period.</p></section>
      <section className="advanced-date-custom"><h4>Custom date range</h4><div>
        <label><span>From</span><input type="date" value={customFrom} max={customTo || undefined} onChange={event => setCustomFrom(event.target.value)}/></label>
        <span className="date-range-arrow">→</span>
        <label><span>To</span><input type="date" value={customTo} min={customFrom || undefined} onChange={event => setCustomTo(event.target.value)}/></label>
        <button type="button" className="btn-primary" onClick={applyCustom} disabled={!customFrom && !customTo}>Apply custom</button>
      </div></section>
      <div className="advanced-date-foot"><button type="button" onClick={() => apply('all')}>Clear date filter</button><span>Relative ranges use your local calendar.</span></div>
    </div>, document.body)}
  </div>;
}

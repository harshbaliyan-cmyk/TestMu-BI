import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { baseOptions, seriesColor, valueLabels, fmtCurrency, fmtNumber, fmtPercent } from './charts';

// Renders whatever the chart engine hands back ({type, data}) plus the saved
// display options — the one renderer behind the builder preview, dashboard
// tiles, and TV walls, so a chart can never look different in two places.
// Chart.js types get a canvas; KPI and table are plain DOM.
//
// Display options (config.options, all optional):
//   format      'number' | 'currency' | 'percent' — ticks, tooltips, labels, KPI
//   horizontal  bar only: category axis on the left, value axis labelled below
//   stacked     bar-with-series only
//   showValues  draw values on the marks (fixed-board style). Defaults ON for
//               bar, OFF for line (a dense line under labels is noise). When
//               values are off — or the bar is horizontal — the value AXIS
//               shows instead, so the numbers are always readable somewhere.

const FORMATTERS = { number: fmtNumber, currency: fmtCurrency, percent: v => fmtPercent(v, 1) };
const withAlpha = (hex, alpha) => `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;

function chartSpec(type, rawData, options = {}) {
  // Each chart type's payload has a different shape, and the caller may hand
  // us a stale one for a beat (type switched, new data still in flight).
  // Defaulting every field means the worst case is an empty chart, never a
  // crash into the error boundary.
  const data = {
    labels: rawData.labels || [],
    datasets: rawData.datasets || [],
    points: rawData.points || [],
  };
  const fmt = FORMATTERS[options.format] || fmtNumber;
  const base = baseOptions({ stacked: Boolean(options.stacked) });
  const legendOn = count => ({ ...base.plugins.legend, display: count > 1 });
  const tooltipFmt = {
    ...base.plugins.tooltip,
    callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmt(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed)}` },
  };

  if (type === 'bar') {
    const horizontal = Boolean(options.horizontal);
    const showValues = !horizontal && (options.showValues ?? true);
    const valueScale = { beginAtZero: true, grace: '12%',
      display: !showValues,
      grid: { display: false }, border: { display: false },
      ticks: { callback: value => fmt(value), maxTicksLimit: 6, font: { size: 12 } } };
    const categoryScale = base.scales.x;
    return {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: data.datasets.map((dataset, i) => ({
          ...dataset,
          backgroundColor: withAlpha(seriesColor(i), 0.85),
          borderColor: seriesColor(i),
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 48,
          valueFormat: fmt,
          hideValues: !showValues,
        })),
      },
      options: {
        ...base, maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: { ...base.plugins, legend: legendOn(data.datasets.length),
          tooltip: { ...tooltipFmt,
            callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } } },
        scales: horizontal
          ? { x: { ...valueScale, stacked: Boolean(options.stacked), display: true },
              y: { ...categoryScale, stacked: Boolean(options.stacked) } }
          : { x: categoryScale, y: { ...valueScale, stacked: Boolean(options.stacked) } },
      },
      plugins: showValues ? [valueLabels] : [],
    };
  }
  if (type === 'line') {
    const showValues = options.showValues ?? false;
    return {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: data.datasets.map((dataset, i) => ({
          ...dataset,
          borderColor: seriesColor(i),
          backgroundColor: withAlpha(seriesColor(i), 0.15),
          tension: 0.3,
          pointRadius: 2.5,
          spanGaps: true,
          fill: data.datasets.length === 1,
          valueFormat: fmt,
          hideValues: !showValues,
        })),
      },
      options: {
        ...base, maintainAspectRatio: false,
        plugins: { ...base.plugins, legend: legendOn(data.datasets.length), tooltip: tooltipFmt },
        scales: { ...base.scales,
          y: { ...base.scales.y, display: !showValues, grid: { display: false }, border: { display: false },
            ticks: { callback: value => fmt(value), maxTicksLimit: 6, font: { size: 12 } } } },
      },
      plugins: showValues ? [valueLabels] : [],
    };
  }
  if (type === 'donut') {
    const values = data.datasets[0]?.data || [];
    const total = values.reduce((sum, v) => sum + (v || 0), 0);
    return {
      type: 'doughnut',
      data: {
        labels: data.labels,
        datasets: [{ data: values, backgroundColor: data.labels.map((_, i) => seriesColor(i)), borderWidth: 0 }],
      },
      options: { ...base, maintainAspectRatio: false, cutout: '62%',
        plugins: { ...base.plugins,
          legend: { ...base.plugins.legend, display: true },
          tooltip: { ...base.plugins.tooltip,
            callbacks: { label: ctx => ` ${fmt(ctx.parsed)}${total ? ` · ${((ctx.parsed / total) * 100).toFixed(1)}% of total` : ''}` } } } },
    };
  }
  if (type === 'scatter') {
    return {
      type: 'scatter',
      data: { datasets: [{ data: data.points, backgroundColor: withAlpha(seriesColor(0), 0.7), pointRadius: 3.5 }] },
      options: { ...base, maintainAspectRatio: false,
        plugins: { ...base.plugins,
          legend: { display: false },
          tooltip: { ...base.plugins.tooltip,
            callbacks: { label: ctx => `${ctx.raw.label ? ctx.raw.label + ': ' : ''}(${fmt(ctx.raw.x)}, ${fmt(ctx.raw.y)})` } } },
        scales: {
          x: { ...base.scales.x, grid: { display: false },
            ticks: { ...base.scales.x.ticks, callback: value => fmt(value), maxTicksLimit: 8 } },
          y: { beginAtZero: false, grace: '8%', display: true, grid: { display: false }, border: { display: false },
            ticks: { callback: value => fmt(value), maxTicksLimit: 6, font: { size: 12 } } },
        } },
    };
  }
  return null;
}

export default function BuilderChart({ type, data, options, onElementClick }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const clickRef = useRef(onElementClick);
  clickRef.current = onElementClick;

  useEffect(() => {
    chartRef.current?.destroy();
    chartRef.current = null;
    if (!data || !canvasRef.current) return;
    const spec = chartSpec(type, data, options || {});
    if (!spec) return;
    if (clickRef.current && ['bar', 'line', 'donut'].includes(type)) {
      spec.options.onClick = (event, elements, chart) => {
        if (!clickRef.current || !elements?.length) return;
        const element = elements[0];
        const where = type === 'line'
          ? { bucket: chart.data.labels[element.index] }
          : { category: chart.data.labels[element.index] };
        const dataset = chart.data.datasets[element.datasetIndex];
        if (type !== 'donut' && chart.data.datasets.length > 1 && dataset?.label) where.series = dataset.label;
        clickRef.current(where);
      };
      spec.options.onHover = (event, elements) => {
        event.native.target.style.cursor = elements?.length ? 'pointer' : 'default';
      };
    }
    chartRef.current = new Chart(canvasRef.current, spec);
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [type, data, options]);

  if (!data) return <div className="builder-chart-empty">No data</div>;

  const fmt = FORMATTERS[options?.format] || fmtNumber;
  if (type === 'kpi') {
    return <div className="builder-kpi">
      <b>{fmt(data.value)}</b>
      <span>{fmtNumber(data.rowCount)} rows</span>
    </div>;
  }
  if (type === 'table') {
    const columns = data.columns || [];
    const tableRows = data.rows || [];
    return <div className="builder-table scroll">
      <table>
        <thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {tableRows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>)}
        </tbody>
      </table>
      {data.totalRows > tableRows.length && <div className="hint">Showing {tableRows.length} of {fmtNumber(data.totalRows)} rows</div>}
    </div>;
  }
  return <div className="builder-chart-canvas"><canvas ref={canvasRef} /></div>;
}

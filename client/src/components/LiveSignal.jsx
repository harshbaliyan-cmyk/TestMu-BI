import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Original data-flow illustration. The paths connect actual demo actions;
// their brief travelling strokes explain the direction of the data.
export default function LiveSignal({ region, onRegion, onExplore, onPresent, reduced }) {
  const surface = useRef(null);
  const frame = useRef(0);
  const [diagram, setDiagram] = useState({ width: 540, height: 420, paths: [] });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useLayoutEffect(() => {
    const root = surface.current;
    const nodes = ['source', 'hub', 'metric', 'screen'].map(name => root.querySelector(`.rv-signal-${name}`));
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const [source, hub, metric, screen] = nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left - bounds.left, top: rect.top - bounds.top, right: rect.right - bounds.left, bottom: rect.bottom - bounds.top, x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2 };
      });
      const topBend = (source.bottom + hub.top) / 2;
      const rightBend = (hub.right + metric.left) / 2;
      const bottomBend = (hub.bottom + screen.top) / 2;
      setDiagram({ width: bounds.width, height: bounds.height, paths: [
        `M ${source.x} ${source.bottom} C ${source.x} ${topBend}, ${hub.x} ${topBend}, ${hub.x} ${hub.top}`,
        `M ${hub.right} ${hub.y} C ${rightBend} ${hub.y}, ${rightBend} ${metric.y}, ${metric.left} ${metric.y}`,
        `M ${hub.x} ${hub.bottom} C ${hub.x} ${bottomBend}, ${screen.x} ${bottomBend}, ${screen.x} ${screen.top}`,
      ] });
    };
    const observer = new ResizeObserver(measure);
    [root, ...nodes].forEach(node => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, []);
  const move = event => {
    if (reduced || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      surface.current?.style.setProperty('--signal-x', `${x * 9}px`);
      surface.current?.style.setProperty('--signal-y', `${y * 9}px`);
    });
  };
  const reset = () => {
    cancelAnimationFrame(frame.current);
    surface.current?.style.setProperty('--signal-x', '0px');
    surface.current?.style.setProperty('--signal-y', '0px');
  };
  return (
    <div className="rv-signal" ref={surface} onPointerMove={move} onPointerLeave={reset} role="group" aria-label="Follow the signal: an interactive sample data flow">
      <div className="rv-signal-coordinate"><span>LIVE SIGNAL</span><span>01 — 03</span></div>
      <div className="rv-signal-rings" aria-hidden="true"><i /><i /><i /><span>+</span><span>+</span></div>
      <svg className="rv-signal-paths" viewBox={`0 0 ${diagram.width} ${diagram.height}`} fill="none" aria-hidden="true">
        {diagram.paths.map((d, i) => <g key={i}><path className="rv-signal-track" d={d} /><path className="rv-signal-beam" d={d} pathLength="1" style={{ '--beam-delay': `${i * .9}s` }} /></g>)}
      </svg>
      <button type="button" className="rv-signal-source" onClick={() => onRegion(region === 'AMER' ? 'All regions' : 'AMER')} aria-label={region === 'AMER' ? 'Show revenue for all regions' : 'See AMER revenue'}>
        <span className="rv-tableau-symbol" aria-hidden="true">✳</span><span><small>YOUR SOURCE</small><strong>Tableau</strong></span><i className="rv-live-dot" />
      </button>
      <button type="button" className="rv-signal-hub" onClick={onExplore} aria-label="Explore the live revenue board"><span className="rv-hub-face"><i /><i /><i /></span><span className="rv-hub-caption">THE SIGNAL ENGINE</span></button>
      <button type="button" className="rv-signal-metric" onClick={() => onRegion(region === 'EMEA' ? 'All regions' : 'EMEA')} aria-label={region === 'EMEA' ? 'Show revenue for all regions' : 'See EMEA revenue'}>
        <span><small>WON ARR</small><i>↗ 18.6%</i></span><strong>{region === 'AMER' ? '$2.1' : region === 'EMEA' ? '$1.3' : '$4.2'}<em>M</em></strong><div className="rv-signal-spark" aria-hidden="true">{[24, 39, 30, 50, 43, 67, 56, 77, 67, 98].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div><span className="rv-signal-region">{region} · Sample data</span>
      </button>
      <button type="button" className="rv-signal-screen" onClick={onPresent} aria-label="Preview your board on a live screen"><span className="rv-screen-glyph" aria-hidden="true"><i /><i /><i /></span><span><small>READY FOR THE ROOM</small><strong>Every screen. <span>↗</span></strong></span></button>
      <div className="rv-signal-note"><i /> Data in. Clarity out.</div>
    </div>
  );
}
